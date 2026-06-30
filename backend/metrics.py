from collections import deque
from statistics import mean

_log = deque(maxlen=50)

FIELDS = ["asr_ms", "llm_ttft_ms", "llm_total_ms", "tts_ttfb_ms", "time_to_first_audio_ms", "total_ms"]


def record(entry: dict):
    _log.append(entry)


def _percentile(values, pct):
    if not values:
        return None
    s = sorted(values)
    idx = min(int(len(s) * pct), len(s) - 1)
    return s[idx]


def summary() -> dict:
    if not _log:
        return {"count": 0}
    out = {"count": len(_log)}
    for field in FIELDS:
        values = [e[field] for e in _log if field in e]
        if values:
            out[field] = {
                "avg": round(mean(values), 1),
                "p50": round(_percentile(values, 0.5), 1),
                "p95": round(_percentile(values, 0.95), 1),
            }
    return out