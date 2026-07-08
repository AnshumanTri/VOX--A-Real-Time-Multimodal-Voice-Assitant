import os

from deepgram import DeepgramClient
from dotenv import load_dotenv
from groq import AsyncGroq
from ollama import AsyncClient as AsyncOllama

load_dotenv()

_groq_client = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY"))
_ollama_client = AsyncOllama()
_deepgram_client = DeepgramClient(api_key=os.environ.get("DEEPGRAM_API_KEY"))

ASR_MODEL = "whisper-large-v3-turbo"
GROQ_LLM_MODEL = "openai/gpt-oss-20b"
GROQ_SEARCH_MODEL = "groq/compound-mini"
TTS_MODEL = "aura-2-thalia-en"
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "groq")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "mistral:latest")

SEARCH_TRIGGERS = (
    "latest", "current", "today", "right now", "recent",
    "weather", "news", "score", "price of", "who is the",
    "what year is it", "what's the date", "search for", "look up",
)


def needs_search(transcript: str) -> bool:
    lowered = transcript.lower()
    return any(trigger in lowered for trigger in SEARCH_TRIGGERS)


async def transcribe_audio(audio_bytes: bytes) -> str:
    response = await _groq_client.audio.transcriptions.create(
        file=("audio.webm", audio_bytes),
        model=ASR_MODEL,
        language="en",
        temperature=0,
    )
    return response.text


SYSTEM_PROMPT = (
    "You are a concise voice assistant. Default to brief spoken answers, "
    "1-3 sentences. Only give a longer, detailed answer if the user explicitly "
    "asks for detail, depth, or a full explanation."
)


async def generate_reply(transcript: str, history: list | None = None):
    """Yields response text chunks as they stream in. history = prior [{role, content}, ...]."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": transcript})

    if LLM_PROVIDER == "ollama":
        stream = await _ollama_client.chat(
            model=OLLAMA_MODEL, messages=messages, stream=True, keep_alive="30m"
        )
        async for part in stream:
            content = part["message"]["content"]
            if content:
                yield content
    else:
        stream = await _groq_client.chat.completions.create(
            model=GROQ_LLM_MODEL,
            messages=messages,
            stream=True,
            reasoning_effort="low",
            include_reasoning=False,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


async def generate_search_reply(transcript: str, history: list | None = None) -> str:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": transcript})

    response = await _groq_client.chat.completions.create(
        model=GROQ_SEARCH_MODEL,
        messages=messages,
    )
    return response.choices[0].message.content


async def synthesize_speech(text: str) -> bytes:
    import asyncio

    def _generate():
        return b"".join(
            _deepgram_client.speak.v1.audio.generate(
                text=text, model=TTS_MODEL, encoding="mp3"
            )
        )

    return await asyncio.to_thread(_generate)