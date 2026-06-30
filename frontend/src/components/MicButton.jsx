export default function MicButton({ isRecording, onStart, onStop }) {
  return (
    <button
      className={`mic-button ${isRecording ? "is-recording" : ""}`}
      onPointerDown={onStart}
      onPointerUp={onStop}
      onPointerLeave={() => isRecording && onStop()}
      onPointerCancel={onStop}
      aria-pressed={isRecording}
      aria-label="Hold to talk"
    >
      <span className="mic-button-label">{isRecording ? "LISTENING" : "HOLD TO TALK"}</span>
    </button>
  );
}