const ROWS = [
  { key: "asr_ms", label: "ASR" },
  { key: "llm_ttft_ms", label: "LLM TTFT" },
  { key: "tts_ttfb_ms", label: "TTS TTFB" },
  { key: "time_to_first_audio_ms", label: "FIRST AUDIO" },
  { key: "total_ms", label: "TOTAL" },
];

export default function LatencyChart({ metrics }) {
  if (!metrics) return null;
  const maxValue = Math.max(...ROWS.map((r) => metrics[r.key] || 0), 1);

  return (
    <div className="latency-chart">
      <div className="latency-chart-title">LATENCY BREAKDOWN</div>
      {ROWS.map((row) => {
        const value = metrics[row.key];
        if (value === undefined) return null;
        const pct = Math.max((value / maxValue) * 100, 2);
        return (
          <div className="latency-row" key={row.key}>
            <span className="latency-label">{row.label}</span>
            <div className="latency-bar-track">
              <div
                className={`latency-bar-fill ${row.key === "total_ms" ? "is-total" : ""}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="latency-value">{Math.round(value)}ms</span>
          </div>
        );
      })}
    </div>
  );
}