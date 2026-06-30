from collections import deque

ASR_TIMEOUT_S = 8
LLM_TIMEOUT_S = 12
TTS_TIMEOUT_S = 8

ASR_FALLBACK_TEXT = "Sorry, I didn't catch that."
LLM_FALLBACK_TEXT = "Sorry, I'm having trouble responding right now."

_replay_log = deque(maxlen=20)
_next_id = 0


def record_session(transcript: str):
    global _next_id
    entry = {"id": _next_id, "transcript": transcript}
    _next_id += 1
    _replay_log.append(entry)
    return entry["id"]


def list_sessions():
    return list(_replay_log)


def get_session(session_id: int):
    for entry in _replay_log:
        if entry["id"] == session_id:
            return entry
    return None