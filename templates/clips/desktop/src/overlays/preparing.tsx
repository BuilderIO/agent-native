/** Visible readiness state shown while the shared Rewind Clip writer and
 * resumable upload session are prepared. The numeric countdown replaces it
 * only after zero can be an immediate media boundary. */
export function Preparing() {
  return (
    <div className="preparing-root">
      <div className="preparing-card" role="status" aria-live="polite">
        <div className="preparing-spinner" aria-hidden="true" />
        <span>Preparing recording…</span>
      </div>
    </div>
  );
}
