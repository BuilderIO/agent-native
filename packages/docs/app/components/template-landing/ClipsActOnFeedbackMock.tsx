/**
 * Static, decorative recreation of the recording player page with its Share
 * button open, showing the real "share to agent" panel
 * (templates/clips/app/components/player/share-dialog.tsx:827-871) dropped
 * down beneath it — used as the art for the "Act on recorded feedback"
 * use-case card on the Clips landing page.
 *
 * Deliberately distinct from `ClipsInvestigateBugMock` (a chat transcript):
 * this shows the actual entry point for handing a clip to an agent, not an
 * imagined conversation.
 *
 * All CSS lives here, scoped under `.clips-cell-mock`, following the same
 * convention as `ClipsLibraryMock.tsx`. The left edge fades into the
 * section's background (rather than having a hard edge) to match the
 * reference screenshot of the real player page.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it
 * is `aria-hidden`, so no assistive tech ever reads these strings; they are
 * the pixels of a product screenshot (a fake player page with its share menu
 * open).
 */
import { IconLink, IconMaximizeOff, IconShare2 } from "@tabler/icons-react";

function ClaudeLogo() {
  return (
    <svg
      className="clips-cell-mock-agent-icon"
      fill="currentColor"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  );
}

function ClaudeCodeLogo() {
  return (
    <svg
      className="clips-cell-mock-agent-icon"
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      >
        <path d="m13.75 13.5 3.5-3.5-3.5-3.5" />
        <path d="M9 16 11 4" />
        <path d="m6.25 13.5-3.5-3.5 3.5-3.5" />
      </g>
    </svg>
  );
}

function CodexLogo() {
  return (
    <svg
      className="clips-cell-mock-agent-icon"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2 2 7v10l10 5 10-5V7L12 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 8v8M8.5 10v4l3.5 2 3.5-2v-4l-3.5-2-3.5 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const AGENT_ROWS = [
  { label: "Copy agent prompt", icon: <IconLink size={18} /> },
  { label: "Open in Claude", icon: <ClaudeLogo /> },
  { label: "Open in Claude Code", icon: <ClaudeCodeLogo /> },
  { label: "Open in Codex", icon: <CodexLogo /> },
] as const;

const CLIPS_CELL_MOCK_CSS = [
  ".clips-cell-mock { position: relative; width: 100%; }",
  ".clips-cell-mock, .clips-cell-mock * { box-sizing: border-box; }",
  ".clips-cell-mock-frame { position: relative; aspect-ratio: 16 / 11; border-radius: 14px; overflow: hidden; background: linear-gradient(135deg, #1c1c1c, #101010); border: 1px solid #262626; box-shadow: 0 28px 56px rgba(0, 0, 0, 0.35); font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }",
  // Fades the player's left edge into the dark section background instead of
  // a hard card edge, matching the reference screenshot of the real page.
  ".clips-cell-mock-fade { position: absolute; inset: 0; background: linear-gradient(to right, #0a0a0a 0%, rgba(10, 10, 10, 0) 38%); pointer-events: none; }",

  ".clips-cell-mock-share-btn { position: absolute; top: 23px; right: 23px; display: flex; align-items: center; gap: 8px; padding: 11px 19px; border-radius: 8px; background: #f5f5f5; color: #151515; font-size: 16px; font-weight: 600; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35); }",

  ".clips-cell-mock-menu { position: absolute; top: 82px; right: 23px; width: 280px; display: flex; flex-direction: column; gap: 3px; padding: 10px; border-radius: 12px; background: #212121; border: 1px solid #333333; box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5); }",
  ".clips-cell-mock-menu-row { display: flex; align-items: center; gap: 11px; padding: 11px 12px; border-radius: 8px; color: #e6e6e6; font-size: 16px; font-weight: 500; }",
  ".clips-cell-mock-menu-row:first-child { background: rgba(255, 255, 255, 0.07); }",
  ".clips-cell-mock-menu-divider { margin: 4px 5px; border-top: 1px solid #333333; }",
  ".clips-cell-mock-agent-icon { width: 18px; height: 18px; color: #a3a3a3; flex-shrink: 0; }",

  ".clips-cell-mock-controls { position: absolute; left: 23px; bottom: 20px; right: 23px; display: flex; align-items: center; gap: 12px; color: rgba(255, 255, 255, 0.55); }",
  ".clips-cell-mock-controls-track { flex: 1 1 auto; height: 3px; border-radius: 999px; background: rgba(255, 255, 255, 0.18); overflow: hidden; }",
  ".clips-cell-mock-controls-fill { width: 42%; height: 100%; background: rgba(255, 255, 255, 0.55); }",
  ".clips-cell-mock-controls-speed { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }",
].join("\n");

export function ClipsActOnFeedbackMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={`clips-cell-mock ${className}`} role="img" aria-label={label}>
      <style>{CLIPS_CELL_MOCK_CSS}</style>
      <div className="clips-cell-mock-frame" aria-hidden="true">
        <div className="clips-cell-mock-fade" />

        <div className="clips-cell-mock-share-btn">
          <IconShare2 size={18} />
          Share
        </div>

        <div className="clips-cell-mock-menu">
          {AGENT_ROWS.map((row, index) => (
            <div key={row.label}>
              {index === 1 ? <div className="clips-cell-mock-menu-divider" /> : null}
              <div className="clips-cell-mock-menu-row">
                <span className="clips-cell-mock-agent-icon">{row.icon}</span>
                <span>{row.label}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="clips-cell-mock-controls">
          <span className="clips-cell-mock-controls-speed">1.2x</span>
          <div className="clips-cell-mock-controls-track">
            <div className="clips-cell-mock-controls-fill" />
          </div>
          <IconMaximizeOff size={16} />
        </div>
      </div>
    </div>
  );
}
