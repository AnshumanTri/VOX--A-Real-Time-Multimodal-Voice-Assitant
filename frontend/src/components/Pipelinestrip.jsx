const STAGES = [
  { key: "mic", label: "MIC" },
  { key: "asr", label: "ASR" },
  { key: "llm", label: "LLM" },
  { key: "tts", label: "TTS" },
];

export default function PipelineStrip({ activeStage }) {
  return (
    <div className="pipeline">
      {STAGES.map((stage) => (
        <div
          key={stage.key}
          className={`pipeline-node ${activeStage === stage.key ? "is-active" : ""}`}
        >
          <span className="pipeline-dot" />
          <span className="pipeline-label">{stage.label}</span>
        </div>
      ))}
    </div>
  );
}