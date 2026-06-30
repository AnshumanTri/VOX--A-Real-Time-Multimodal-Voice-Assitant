export default function ConversationPanel({ transcript, reply }) {
  if (!transcript) return null;
  return (
    <div className="conversation-panel">
      <p className="conversation-line conversation-user">
        <span className="conversation-tag">YOU</span> {transcript}
      </p>
      {reply && (
        <p className="conversation-line conversation-reply">
          <span className="conversation-tag">VOX</span> {reply}
        </p>
      )}
    </div>
  );
}