const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";
const HTTP_BASE = WS_URL.replace("ws://", "http://").replace("wss://", "https://").replace("/ws", "");

export default function ReplayPanel({ onReplay }) {
  const fetchAndReplay = async () => {
    try {
      const res = await fetch(`${HTTP_BASE}/replay`);
      const sessions = await res.json();
      if (sessions.length === 0) return;
      const last = sessions[sessions.length - 1];
      onReplay(last.id);
    } catch (err) {
      console.error("Replay fetch failed:", err);
    }
  };

  return (
    <button className="replay-button" onClick={fetchAndReplay} title="Replay last session">
      ↺ REPLAY LAST
    </button>
  );
}