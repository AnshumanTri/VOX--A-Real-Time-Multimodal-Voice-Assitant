import asyncio
import json
import re
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import metrics
import resilience
from providers import generate_reply, synthesize_speech, transcribe_audio

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@app.on_event("startup")
async def warmup():
    try:
        async for _ in generate_reply("hi"):
            break
    except Exception:
        pass


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/metrics")
async def get_metrics():
    return metrics.summary()


@app.get("/replay")
async def list_replay():
    return resilience.list_sessions()


async def send_json(websocket: WebSocket, payload: dict):
    await websocket.send_text(json.dumps(payload))


async def speak_sentence(websocket: WebSocket, sentence: str, on_audio_ready=None):
    sentence = sentence.strip()
    if not sentence:
        return
    await send_json(websocket, {"type": "reply_chunk", "text": sentence})
    try:
        audio_bytes = await asyncio.wait_for(
            synthesize_speech(sentence), timeout=resilience.TTS_TIMEOUT_S
        )
        if on_audio_ready:
            on_audio_ready()
        await websocket.send_bytes(audio_bytes)
    except asyncio.TimeoutError:
        await send_json(
            websocket,
            {"type": "degraded", "stage": "tts", "message": "Voice unavailable, showing text only."},
        )
    except Exception as exc:
        await send_json(websocket, {"type": "error", "stage": "tts", "message": str(exc)})


async def process_query(websocket: WebSocket, transcript: str, asr_ms):
    t_start = time.perf_counter()
    timing = {}
    if asr_ms is not None:
        timing["asr_ms"] = asr_ms

    first_chunk_at = None
    first_audio_at = None

    def mark_first_audio():
        nonlocal first_audio_at
        if first_audio_at is None:
            first_audio_at = time.perf_counter()

    async def consume_llm():
        nonlocal first_chunk_at
        buffer = ""
        async for chunk in generate_reply(transcript):
            if first_chunk_at is None:
                first_chunk_at = time.perf_counter()
                timing["llm_ttft_ms"] = (first_chunk_at - t_start) * 1000
            buffer += chunk
            parts = SENTENCE_END.split(buffer)
            if len(parts) > 1:
                for sentence in parts[:-1]:
                    await speak_sentence(websocket, sentence, mark_first_audio)
                buffer = parts[-1]
        return buffer

    try:
        buffer = await asyncio.wait_for(consume_llm(), timeout=resilience.LLM_TIMEOUT_S)
        t_llm_done = time.perf_counter()
        timing["llm_total_ms"] = (t_llm_done - t_start) * 1000
        await speak_sentence(websocket, buffer, mark_first_audio)
    except asyncio.TimeoutError:
        await send_json(
            websocket,
            {"type": "degraded", "stage": "llm", "message": "Response is taking too long."},
        )
        await speak_sentence(websocket, resilience.LLM_FALLBACK_TEXT, mark_first_audio)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        await send_json(websocket, {"type": "error", "stage": "llm", "message": str(exc)})
        return

    t_end = time.perf_counter()
    if first_audio_at:
        timing["tts_ttfb_ms"] = (first_audio_at - (first_chunk_at or t_start)) * 1000
        timing["time_to_first_audio_ms"] = (first_audio_at - t_start) * 1000
    timing["total_ms"] = (t_end - t_start) * 1000

    await send_json(websocket, {"type": "metrics", **{k: round(v, 1) for k, v in timing.items()}})
    metrics.record(timing)
    await send_json(websocket, {"type": "llm_done"})


async def handle_audio(websocket: WebSocket, audio_bytes: bytes):
    t_start = time.perf_counter()
    try:
        transcript = await asyncio.wait_for(
            transcribe_audio(audio_bytes), timeout=resilience.ASR_TIMEOUT_S
        )
    except asyncio.TimeoutError:
        await send_json(
            websocket,
            {"type": "degraded", "stage": "asr", "message": "Transcription is taking too long."},
        )
        await send_json(websocket, {"type": "transcript", "text": resilience.ASR_FALLBACK_TEXT})
        return
    except Exception as exc:
        await send_json(websocket, {"type": "error", "stage": "asr", "message": str(exc)})
        return

    asr_ms = (time.perf_counter() - t_start) * 1000
    await send_json(websocket, {"type": "transcript", "text": transcript})
    resilience.record_session(transcript)
    await process_query(websocket, transcript, asr_ms)


async def handle_replay(websocket: WebSocket, session_id):
    entry = resilience.get_session(session_id)
    if not entry:
        await send_json(websocket, {"type": "error", "stage": "replay", "message": "Session not found."})
        return
    await send_json(websocket, {"type": "transcript", "text": entry["transcript"]})
    await process_query(websocket, entry["transcript"], asr_ms=None)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    current_task = None

    async def cancel_current():
        nonlocal current_task
        if current_task and not current_task.done():
            current_task.cancel()
            try:
                await current_task
            except asyncio.CancelledError:
                pass
            await send_json(websocket, {"type": "cancelled"})

    try:
        while True:
            message = await websocket.receive()
            if message.get("text") is not None:
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    payload = None

                if isinstance(payload, dict) and payload.get("type") == "replay":
                    await cancel_current()
                    current_task = asyncio.create_task(handle_replay(websocket, payload.get("id")))
                else:
                    await send_json(websocket, {"type": "echo", "text": message["text"]})
            elif message.get("bytes") is not None:
                await cancel_current()
                current_task = asyncio.create_task(handle_audio(websocket, message["bytes"]))
    except WebSocketDisconnect:
        if current_task and not current_task.done():
            current_task.cancel()