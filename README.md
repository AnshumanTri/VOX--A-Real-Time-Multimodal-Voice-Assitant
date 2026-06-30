# Vox — Real-Time Multimodal Voice Assistant

A streaming voice assistant built to explore the real engineering challenges of real-time systems: tight latency budgets, partial failure, and the messiness of pipelines that have to respond *now* instead of in a batch job.

**[Live Demo →](#)** *(link added after deployment)*

---

## Architecture

```
 Mic (push-to-talk)
        │  binary audio (webm)
        ▼
 ┌─────────────────┐
 │   FastAPI WS     │  orchestrator — single persistent connection
 │   orchestrator   │  per session, cancellable per-request tasks
 └──────┬───────────┘
        │
        ▼
   ASR (Groq Whisper large-v3-turbo)
        │ transcript
        ▼
   LLM (Groq Llama / local Ollama in dev) — streamed token by token
        │ sentence-chunked text
        ▼
   TTS (Deepgram Aura-2) — synthesized per sentence, streamed back
        │ audio bytes
        ▼
   Browser plays audio as it arrives (queued, in order)
```

Every stage streams. The reply starts being spoken before the LLM has finished generating the full answer — audio for sentence 1 plays while sentence 2 is still being written.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI + WebSockets | persistent connection needed for streaming both directions |
| ASR | Groq Whisper large-v3-turbo | fastest hosted Whisper inference available |
| LLM | Groq (prod) / Ollama (dev) | Groq's LPU hardware gives sub-second TTFT; Ollama avoids burning Groq's free-tier quota while iterating |
| TTS | Deepgram Aura-2 | streaming-capable, generous free credit |
| Frontend | React + Vite + Three.js | reactive 3D orb reflects pipeline state in real time |
| Deployment | Render (backend) + Vercel (frontend) | both have functional free tiers; Render supports persistent WebSocket processes |

## The Three Phases

**Phase 1 — Streaming pipeline.** Mic → ASR → LLM → TTS working end-to-end over a single WebSocket, with structured JSON events instead of ad-hoc strings.

**Phase 2 — Latency instrumentation.** Every request is timed stage-by-stage: ASR duration, LLM time-to-first-token, TTS time-to-first-byte, time-to-first-audio (what the user actually feels), and total. Shown live as a bar chart per request, and aggregated (avg/p50/p95) at `/metrics`.

**Phase 3 — Resilience.** Every external call (ASR/LLM/TTS) is wrapped in a timeout. If a stage fails or times out, the system degrades instead of hanging: cached fallback text, audio skipped if TTS fails, a visible "degraded" banner instead of silence. A replay feature re-runs the last transcript through the pipeline without needing to speak again — useful for debugging and demos.

## Measured Latency (production, Groq)

> Fill in after deployment — call `GET /metrics` after ~10 real exchanges.

| Stage | Avg | p50 | p95 |
|---|---|---|---|
| ASR | | | |
| LLM TTFT | | | |
| TTS TTFB | | | |
| Time to first audio | | | |
| Total | | | |

## Failure Modes Handled

| Failure | Behavior |
|---|---|
| ASR timeout/error | Fallback transcript shown, banner displayed, pipeline stops cleanly (no hang) |
| LLM timeout/error | Short apology response spoken instead, banner displayed |
| TTS timeout/error | Reply text still shown, audio skipped for that sentence only |
| User interrupts mid-response | In-flight request cancelled server-side (`asyncio.Task.cancel()`), new request starts immediately |
| Backend cold start (Render free tier) | Surfaced as a connecting state in the UI rather than a silent dead socket |

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

**Backend (Render)**
1. Push this repo to GitHub
2. Render → New → Blueprint → point at the repo (uses `render.yaml`)
3. Set `GROQ_API_KEY` and `DEEPGRAM_API_KEY` in the Render dashboard (not committed)
4. `LLM_PROVIDER=groq` is already set via `render.yaml`

**Frontend (Vercel)**
1. Vercel → New Project → import the repo, set root directory to `frontend`
2. Add env var `VITE_WS_URL=wss://<your-render-app>.onrender.com/ws`
3. Deploy

Note: Render's free tier spins down after 15 minutes idle; the first request after that takes ~30-60s to wake up. This is surfaced in the UI as a connecting state rather than hidden.