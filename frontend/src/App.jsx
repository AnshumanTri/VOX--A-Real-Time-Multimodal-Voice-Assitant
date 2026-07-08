import { useCallback, useEffect, useRef, useState } from "react";
import Orb from "./components/Orb.jsx";
import MicButton from "./components/MicButton.jsx";
import EchoLog from "./components/EchoLog.jsx";
import PipelineStrip from "./components/PipelineStrip.jsx";
import CursorGlow from "./components/CursorGlow.jsx";
import ConversationPanel from "./components/ConversationPanel.jsx";
import LatencyChart from "./components/LatencyChart.jsx";
import DegradedBanner from "./components/DegradedBanner.jsx";
import ReplayPanel from "./components/ReplayPanel.jsx";
import { useSocket } from "./hooks/useSocket.js";
import { useMic } from "./hooks/useMic.js";
import { useAudioQueue } from "./hooks/useAudioQueue.js";

const STAGE_BY_PHASE = { listening: "mic", asr: "asr", searching: "search", llm: "llm", speaking: "tts" };
const ORB_STATE_BY_PHASE = { listening: "listening", asr: "thinking", searching: "thinking", llm: "thinking", speaking: "speaking" };

export default function App() {
  const [phase, setPhase] = useState("idle"); // idle | listening | asr | llm | speaking
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [log, setLog] = useState([]);
  const [chunkCount, setChunkCount] = useState(0);
  const [lastBytes, setLastBytes] = useState(0);
  const [glowSuppressed, setGlowSuppressed] = useState(false);
  const [latestMetrics, setLatestMetrics] = useState(null);
  const [degradedMessage, setDegradedMessage] = useState(null);

  const pendingTextRef = useRef([]);

  const appendLog = useCallback((line) => {
    setLog((prev) => [...prev.slice(-19), line]);
  }, []);

  const handleSentenceStart = useCallback((text) => {
    setReply((prev) => (prev ? `${prev} ${text}` : text));
  }, []);

  const { enqueue, reset: resetAudio, isSpeaking } = useAudioQueue(handleSentenceStart);

  const handleMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case "transcript":
          setTranscript(msg.text);
          setReply("");
          setDegradedMessage(null);
          pendingTextRef.current = [];
          setPhase("llm");
          appendLog(`transcript: ${msg.text}`);
          break;
        case "degraded":
          setDegradedMessage(msg.message);
          appendLog(`degraded (${msg.stage}): ${msg.message}`);
          break;
        case "searching":
          setPhase("searching");
          appendLog("searching web...");
          break;
        case "reply_chunk":
          pendingTextRef.current.push(msg.text);
          break;
        case "metrics":
          setLatestMetrics(msg);
          break;
        case "llm_done":
          appendLog("llm_done");
          break;
        case "cancelled":
          appendLog("cancelled (barge-in)");
          break;
        case "error":
          appendLog(`error (${msg.stage}): ${msg.message}`);
          setPhase("idle");
          break;
        case "echo":
          appendLog(`echo: ${msg.text}`);
          break;
        default:
          break;
      }
    },
    [appendLog]
  );

  const handleAudio = useCallback(
    (blob) => {
      const text = pendingTextRef.current.shift() || "";
      enqueue({ text, blob });
      setPhase("speaking");
    },
    [enqueue]
  );

  const { status, sendText, sendBinary } = useSocket(handleMessage, handleAudio);

  const handleAudioReady = useCallback(
    (blob) => {
      sendBinary(blob);
      setChunkCount((c) => c + 1);
      setLastBytes(blob.size);
    },
    [sendBinary]
  );
  const { amplitude, start, stop } = useMic(handleAudioReady);

  const handleStart = () => {
    // Barge-in: clear any in-flight response immediately, don't wait for backend ack
    resetAudio();
    pendingTextRef.current = [];
    setTranscript("");
    setReply("");
    setLatestMetrics(null);
    setPhase("listening");
    start();
  };
  const handleStop = () => {
    stop();
    setPhase("asr");
  };

  const triggerReplay = (id) => {
    resetAudio();
    pendingTextRef.current = [];
    setTranscript("");
    setReply("");
    setDegradedMessage(null);
    setLatestMetrics(null);
    setPhase("llm");
    sendText(JSON.stringify({ type: "replay", id }));
  };

  useEffect(() => {
    if (phase === "speaking" && !isSpeaking) {
      setPhase("idle");
    }
  }, [phase, isSpeaking]);

  const orbState = ORB_STATE_BY_PHASE[phase] || "idle";
  const activeStage = STAGE_BY_PHASE[phase] || null;
  const levelPercent = Math.min(amplitude * 250, 100);

  const suppressGlow = () => setGlowSuppressed(true);
  const restoreGlow = () => setGlowSuppressed(false);

  return (
    <div className="app">
      <CursorGlow suppressed={glowSuppressed} />

      <header className="app-header">
        <span className="app-title">VOX</span>
        <span className="app-subtitle">REAL-TIME VOICE PIPELINE</span>
        <span className={`status-dot status-${status}`} />
        <span className="status-label">{status}</span>
      </header>

      <PipelineStrip activeStage={activeStage} />
      <DegradedBanner message={degradedMessage} />

      <main className="app-main">
        <div onMouseEnter={suppressGlow} onMouseLeave={restoreGlow}>
          <Orb state={orbState} amplitude={amplitude} />
        </div>
        <div className="state-label">{phase.toUpperCase()}</div>

        <ConversationPanel transcript={transcript} reply={reply} />
        <LatencyChart metrics={latestMetrics} />

        <div className="level-meter-wrap">
          <span className="level-meter-caption">INPUT LEVEL</span>
          <div className="level-meter">
            <div className="level-meter-fill" style={{ width: `${levelPercent}%` }} />
          </div>
        </div>

        <div onMouseEnter={suppressGlow} onMouseLeave={restoreGlow}>
          <MicButton isRecording={phase === "listening"} onStart={handleStart} onStop={handleStop} />
        </div>

        <ReplayPanel onReplay={triggerReplay} />
      </main>

      <EchoLog lines={log} chunkCount={chunkCount} lastBytes={lastBytes} />
    </div>
  );
}