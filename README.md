# Vox — Real-Time Multimodal Voice Assistant

A full-duplex streaming voice assistant built to explore what changes when a system has to respond *now* instead of in a batch job: tight latency budgets, partial failure mid-request, and pipelines where every stage is happening concurrently rather than sequentially-and-comfortably.

**🔴 Live demo:** [https://vox-a-real-time-multimodal-voice-assitant-mq3j-8qqktsif7.vercel.app/](https://vox-a-real-time-multimodal-voice-as-kappa.vercel.app/)
**⚙️ Backend:** https://vox-backend-n6fj.onrender.com

> First load may take 30-60s — the backend runs on a free-tier instance that sleeps after 15 minutes idle. This is intentional and explained in the [Resilience](#phase-3--engineering-for-failure) section below, not a bug.

---

## What this is

Hold a button, speak, and Vox transcribes you, reasons about what you said, and speaks a reply back — while streaming every stage, measuring its own latency down to the millisecond, and degrading gracefully instead of hanging when something upstream fails.

It was built in three deliberate phases, each adding a layer that matters in real production systems but rarely shows up in tutorial projects:

| Phase | Focus |
|---|---|
| 1 | Get a real streaming pipeline working end-to-end |
| 2 | Instrument it — measure exactly where every millisecond goes |
| 3 | Make it survive failure — timeouts, fallbacks, interruption, replay |

---

## Architecture

```
   Mic (push-to-talk)
          │ binary audio (webm)
          ▼
 ┌────────────────────┐
 │  FastAPI WebSocket  │  single persistent connection per session
 │   orchestrator      │  each request is a cancellable asyncio.Task
 └─────────┬───────────┘
          │
          ▼
   ASR — Groq Whisper large-v3-turbo
          │ transcript
          ▼
   LLM — Groq Llama (prod) / Ollama Mistral (dev) — streamed token-by-token
          │ sentence-chunked text, as soon as a sentence boundary is hit
          ▼
   TTS — Deepgram Aura-2 — synthesized per sentence, not per full reply
          │ audio bytes, streamed back over the same socket
          ▼
   Browser — plays audio chunks in order as they arrive
```

The key design decision: **nothing waits for the full pipeline to finish before the next stage starts.** The LLM begins speaking sentence 1 through TTS while it's still generating sentence 2. This is what makes "time to first audio" meaningfully smaller than total response time — and it's the number that actually determines how the assistant *feels* to talk to.

---

## Tech Stack

| Layer | Technology | Why this, specifically |
|---|---|---|
| Backend | FastAPI + native WebSockets | Needs a persistent bidirectional connection — REST can't stream both directions |
| ASR | Groq Whisper large-v3-turbo | Fastest hosted Whisper inference available; sub-second transcription |
| LLM (prod) | Groq (`openai/gpt-oss-20b`, low reasoning effort) | Groq's LPU hardware delivers ~150ms time-to-first-token — this is the backbone of the whole latency story |
| LLM (dev) | Ollama, local Mistral | Keeps Groq's free-tier rate limit untouched while iterating; swapped via one env var |
| TTS | Deepgram Aura-2 | Streaming-capable synthesis with a non-expiring free credit |
| Frontend | React + Vite + Three.js | A custom-shader 3D orb reflects pipeline state (listening / thinking / speaking) in real time, not just a static waveform |
| Orchestration | Python `asyncio` | Per-request cancellable tasks make barge-in (interrupting mid-response) possible |
| Deployment | Render (backend) + Vercel (frontend) | Render runs a real persistent process (required for WebSockets); Vercel is free, fast static hosting for the frontend |

---

## Phase 1 — Building the Streaming Pipeline

The goal: get audio flowing from a browser mic, through three different external AI APIs, and back out as audible speech — with **structured events**, not ad-hoc strings, so the system is debuggable and extensible.

What this involved:
- Push-to-talk audio capture via `MediaRecorder`, with live amplitude extracted from the Web Audio API to drive the orb's visual reactivity
- A FastAPI WebSocket endpoint that branches on binary (audio) vs text (control) frames
- A JSON event protocol (`transcript`, `reply_chunk`, `metrics`, `degraded`, `error`, `cancelled`) instead of magic strings — every event has a `type` field the frontend switches on
- **Sentence-level TTS chunking**: the LLM's token stream is buffered until a sentence boundary (`. ! ?`) is detected, then that sentence alone is sent to TTS and played — instead of waiting for the entire reply

This last point is the single biggest latency win in the whole project: without it, time-to-first-audio would equal total LLM generation time. With it, the two numbers are decoupled.

---

## Phase 2 — Measuring What Actually Happens

A streaming pipeline is only as good as your ability to prove where time goes. Phase 2 wraps every external call in `time.perf_counter()` checkpoints and computes five numbers per request:

- **ASR latency** — speech in, transcript out
- **LLM time-to-first-token (TTFT)** — how long until the model starts generating, after it has the transcript
- **TTS time-to-first-byte (TTFB)** — how long from the first LLM token until audio is ready to play
- **Time to first audio** — the number that matters most: from end-of-speech to first sound out of the speaker
- **Total** — full round trip

Every request streams its own breakdown live to the UI as a bar chart. A rolling log of the last 50 requests powers a `/metrics` endpoint with **avg / p50 / p95** for each stage — because a single request can be a fluke, but a distribution tells the truth.

### Real production numbers (live deployment, Groq + Deepgram, n=15)

| Stage | Avg | p50 | p95 |
|---|---|---|---|
| ASR | 265.6ms | 274.8ms | 324.1ms |
| LLM TTFT | **159.0ms** | 156.8ms | 259.6ms |
| TTS TTFB | 1926.2ms | 1356.2ms | 6131.9ms |
| **Time to first audio** | **2085.2ms** | **1596.5ms** | 6242.3ms |
| Total | 5147.3ms | 3700.5ms | 13544.3ms |

Reading this data the way an engineer would: **Groq's LLM TTFT (159ms avg) is essentially free** — the bottleneck is TTS synthesis time, which dominates time-to-first-audio. That's a real, evidence-backed finding about where this system's latency budget actually goes, not a guess — and it's exactly the kind of profiling insight that matters when optimizing a production voice pipeline.

---

## Phase 3 — Engineering for Failure

Anyone can build a pipeline that works when every API call succeeds in under a second. Production systems don't get that luxury — networks stall, free-tier models cold-start, third-party APIs time out. Phase 3 is about treating failure as a first-class case the system is *designed* for, not an afterthought.

### Timeout handling
Every external call — ASR, LLM, TTS — is wrapped in `asyncio.wait_for()` with an explicit ceiling (8s / 12s / 8s respectively). Nothing in this system can hang indefinitely waiting on a third-party API that never responds. This sounds obvious until you've seen what happens without it: one slow Deepgram call would otherwise freeze the entire WebSocket session.

### Graceful degradation, not silent failure
When a stage times out or errors, the system doesn't go quiet — it degrades visibly and predictably:

| Failure | What happens |
|---|---|
| ASR times out | Fallback transcript shown ("Sorry, I didn't catch that"), pipeline stops cleanly, user sees exactly what happened |
| LLM times out | A short fallback reply is spoken instead of nothing — the conversation doesn't just die |
| TTS times out | The reply text still appears; only that sentence's audio is skipped — partial degradation, not total failure |
| User interrupts mid-response (barge-in) | The in-flight request is cancelled server-side via `asyncio.Task.cancel()`, the audio queue clears instantly client-side, and the new request starts with zero leftover state |
| Backend cold start (Render free tier sleeps after 15 min idle) | Surfaced in the UI as a connecting state instead of a dead socket the user has to guess about |

A red "degraded" banner appears in the UI any time a fallback fires, so failure is something you can *see and demo*, not something buried in a server log.

### Barge-in / interruption handling
This was the hardest concurrency problem in the project. The backend processes each WebSocket session in a loop, but holds a reference to the currently-running request as an `asyncio.Task`. If new audio arrives while a previous response is still generating or speaking, that task is cancelled mid-flight — mid-LLM-generation, mid-TTS-call, doesn't matter — and a fresh task starts immediately. The frontend mirrors this: it clears its audio playback queue and resets all UI state the instant you press the mic button again, without waiting for the backend to confirm. This is what makes the assistant feel responsive rather than like you're talking over a queued recording.

### Replay mode
The last 20 transcripts are kept in memory server-side. A replay control re-runs any of them through the LLM+TTS stages again — without needing a working microphone or re-speaking — which made debugging the latency and degradation logic dramatically faster during development, and doubles as a clean way to demo specific behavior on demand.

### Real production bugs hit and fixed along the way

These weren't hypothetical — they happened during this build, and fixing them is part of the evidence this project is meant to provide:

- **Cold-model latency spike**: local Ollama unloads its model after 5 minutes idle by default; the next request then pays a ~16-second reload cost. Fixed by pinning `keep_alive="30m"` on every chat call and adding a server-startup warmup request, so the model is never cold when a real user arrives.
- **CORS blocking cross-origin requests silently**: a debug feature (replay) appeared to "do nothing" when clicked — actually a blocked `fetch()` failing silently in a swallowed `catch`. Root-caused by checking the browser network tab, fixed with explicit `CORSMiddleware`, and stopped silently swallowing errors going forward.
- **Cross-platform case-sensitivity break**: a component renamed on Windows (case-insensitive filesystem) looked unchanged to git locally, but broke the Vercel build (Linux, case-sensitive) with an unresolvable import. Fixed via a two-step `git mv` to force git to register the case change as two real renames.

Each of these is a class of bug that doesn't show up in local development on a single OS with everything warm — they only surface once a system actually goes through a real deploy-and-use cycle, which is exactly the kind of friction this project was built to expose.

---

## Beyond the Core Pipeline

Two additions built after the initial three phases, aimed at closing the gap with production-grade voice assistants:

- **Multi-turn memory**: the last 3 exchanges are kept in memory per session and passed to the LLM on every turn, so follow-up questions ("what did I just ask?") work correctly. Capped deliberately to bound latency/token cost — not unlimited context.
- **Live web search**: queries containing time-sensitive language ("latest", "current", "today", "weather", "news", etc.) route to Groq's built-in `compound-mini` system, which performs a real web search server-side before answering — no custom search API needed. A `SEARCH` node lights up in the pipeline strip when this fires.

**A real free-tier limit surfaced here, handled gracefully rather than patched around**: `compound-mini`'s internal search+reasoning consumes far more tokens per call than the standard model, and free-tier accounts hit Groq's tokens-per-minute cap on some queries. Rather than fail the request, the system catches this and falls back to answering directly with the standard fast model — the user still gets a real answer, with a visible "degraded" banner explaining live search wasn't available for that query. This is the same graceful-degradation philosophy from Phase 3, applied to a genuine constraint discovered after deployment rather than a theoretical one.

---

## Local Setup

**Backend**
```
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env         # fill in GROQ_API_KEY, DEEPGRAM_API_KEY
uvicorn main:app --reload --port 8000
```

**Frontend**
```
cd frontend
npm install
npm run dev
```

## Deployment

**Backend → Render** (`render.yaml` blueprint included)
1. Render → New → Blueprint → connect this repo
2. Set `GROQ_API_KEY` and `DEEPGRAM_API_KEY` in the Render dashboard
3. `LLM_PROVIDER=groq` is already pinned via `render.yaml`

**Frontend → Vercel**
1. New Project → import this repo → root directory `frontend`
2. Env var: `VITE_WS_URL=wss://<your-render-app>.onrender.com/ws`
3. Deploy — Vercel auto-detects the Vite build, no custom build commands needed

---

## What this project demonstrates

- Designing and reasoning about a real multi-stage streaming system, not a single-request API wrapper
- Decomposing end-to-end latency into a measured, evidence-backed budget rather than a vague "feels fast"
- Building genuine resilience: timeouts, graceful degradation, cancellable concurrent tasks, and a debugging/replay tool — not just a happy-path demo
- Operating entirely on free-tier infrastructure across four different providers (Groq, Deepgram, Render, Vercel) without compromising the production-readiness of the design
- Diagnosing and fixing real cross-environment bugs (cold-start latency, CORS, OS-dependent git behavior) that only appear once a system leaves a single developer's machine
- Extending a working system with real agentic features (memory, live tool use) and handling the free-tier constraints that come with them, rather than only demoing the happy path
