export default function DegradedBanner({ message }) {
  if (!message) return null;
  return (
    <div className="degraded-banner">
      <span className="degraded-dot" />
      {message}
    </div>
  );
}