export default function EchoLog({ lines, chunkCount, lastBytes }) {
  return (
    <div className="echo-log" aria-live="polite">
      <div className="echo-log-title">SESSION</div>
      <div className="echo-log-stats">
        <span>clips sent: {chunkCount}</span>
        <span>last clip: {lastBytes ? `${(lastBytes / 1024).toFixed(1)} KB` : "—"}</span>
      </div>
      <div className="echo-log-divider" />
      {lines.length === 0 && <div className="echo-log-empty">no messages yet</div>}
      {lines.map((line, i) => (
        <div key={i} className="echo-log-line">
          &gt; {line}
        </div>
      ))}
    </div>
  );
}