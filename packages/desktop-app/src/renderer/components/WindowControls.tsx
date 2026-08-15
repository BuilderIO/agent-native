export default function WindowControls({
  className = "win-controls",
}: {
  className?: string;
}) {
  return (
    <div className={className}>
      <button
        className="win-btn win-btn--close"
        tabIndex={-1}
        onClick={() => window.electronAPI?.windowControls.close()}
        title="Close"
      />
      <button
        className="win-btn win-btn--minimize"
        tabIndex={-1}
        onClick={() => window.electronAPI?.windowControls.minimize()}
        title="Minimize"
      />
      <button
        className="win-btn win-btn--maximize"
        tabIndex={-1}
        onClick={() => window.electronAPI?.windowControls.maximize()}
        title="Maximize"
      />
    </div>
  );
}

export function CollapsedMacWindowControls() {
  return (
    <div
      className="collapsed-mac-window-controls"
      role="group"
      aria-label="Window controls"
    >
      <button
        type="button"
        className="win-btn win-btn--close"
        onClick={() => window.electronAPI?.windowControls.close()}
        aria-label="Close window"
        title="Close"
      />
      <button
        type="button"
        className="win-btn win-btn--minimize"
        onClick={() => window.electronAPI?.windowControls.minimize()}
        aria-label="Minimize window"
        title="Minimize"
      />
      <button
        type="button"
        className="win-btn win-btn--maximize"
        onClick={() => window.electronAPI?.windowControls.maximize()}
        aria-label="Zoom window"
        title="Zoom"
      />
    </div>
  );
}
