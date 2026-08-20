/** Visible readiness state shown before the numeric countdown takes over. */
export function Preparing() {
  return (
    <div className="preparing-root">
      <div className="preparing-content" role="status" aria-live="polite">
        <span className="preparing-label">Preparing recording</span>
        <div className="preparing-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
