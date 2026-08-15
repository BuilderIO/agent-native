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
