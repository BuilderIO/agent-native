/**
 * Static, decorative recreation of the real recording player's Share
 * button and popover, used as the art for the "Act on recorded feedback"
 * use-case card on the Clips landing page. Structure and copy are lifted
 * directly from the live components rather than invented:
 *
 * - Header row: title on the left, Share button on the right, above the
 *   player frame, mirroring `PageHeader` in
 *   `templates/clips/app/routes/_app.r.$recordingId.tsx:2372-2387`.
 * - Player frame: `aspect-video`, black background, `rounded-2xl`
 *   (`_app.r.$recordingId.tsx:2412-2473`,
 *   `templates/clips/app/components/player/video-player.tsx:1692-1762`).
 * - Controls bar: play/pause, scrubber with marker dots, elapsed/total time,
 *   speed, and fullscreen, recreating
 *   `templates/clips/app/components/player/player-controls.tsx:132-328`.
 * - Trigger: `ClipsShareTrigger` / `PageHeaderPrimaryAction`
 *   (templates/clips/app/components/player/clips-share-trigger.tsx:10-37) —
 *   a solid button with `IconUserPlus` and the label "Share".
 * - Popover: `Popover` + `PopoverContent` at `w-[360px]`
 *   (templates/clips/app/components/player/share-dialog.tsx:134-243).
 * - Tabs: "People" / "Agents" (share-dialog.tsx:295-380).
 * - Agents tab rows and dividers, including the exact copy, icons, and the
 *   real `ClaudeLogo` / `ClaudeCodeLogo` / `IconBrandOpenai` (Codex) icons
 *   (templates/clips/app/components/agent-destination-logos.tsx and
 *   share-dialog.tsx:827-871).
 *
 * Deliberately distinct from `ClipsInvestigateBugMock` (a chat transcript):
 * this shows the actual entry point for handing a clip to an agent.
 *
 * All CSS lives here, scoped under `.clips-cell-mock`, following the same
 * convention as `ClipsLibraryMock.tsx`. The left edge fades into the
 * section's background rather than having a hard edge, matching the
 * reference screenshot of the real player page.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it
 * is `aria-hidden`, so no assistive tech ever reads these strings; they are
 * the pixels of a product screenshot (a fake player page with its real share
 * popover open).
 */
import {
  IconBrandOpenai,
  IconLink,
  IconMaximize,
  IconPlayerPlayFilled,
  IconUserPlus,
} from "@tabler/icons-react";

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

const AGENT_ROWS = [
  { label: "Copy agent prompt", icon: <IconLink size={16} /> },
  { label: "Open in Claude", icon: <ClaudeLogo /> },
  { label: "Open in Claude Code", icon: <ClaudeCodeLogo /> },
  { label: "Open in Codex", icon: <IconBrandOpenai size={16} /> },
] as const;

const CLIPS_CELL_MOCK_CSS = [
  ".clips-cell-mock { position: relative; width: 100%; }",
  ".clips-cell-mock, .clips-cell-mock * { box-sizing: border-box; }",
  ".clips-cell-mock-inner { position: relative; }",

  // Mirrors the real page's PageHeader row: breadcrumb/title on the left,
  // Share button on the right, sitting above the player frame
  // (_app.r.$recordingId.tsx:2372-2387).
  ".clips-cell-mock-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px 14px; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }",
  ".clips-cell-mock-title { font-size: 14px; font-weight: 600; color: #e6e6e6; }",

  // Real player frame: aspect-video, black background, rounded-2xl
  // (_app.r.$recordingId.tsx:2412-2473, video-player.tsx:1692-1762).
  ".clips-cell-mock-frame { position: relative; aspect-ratio: 16 / 9; border-radius: 16px; overflow: hidden; background: linear-gradient(135deg, #1c1c1c, #101010); border: 1px solid #262626; box-shadow: 0 28px 56px rgba(0, 0, 0, 0.35); font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }",
  // Fades the player's left edge into the dark section background instead of
  // a hard card edge, matching the reference screenshot of the real page.
  ".clips-cell-mock-fade { position: absolute; inset: 0; background: linear-gradient(to right, #0a0a0a 0%, rgba(10, 10, 10, 0) 38%); pointer-events: none; }",

  // Real trigger: PageHeaderPrimaryAction, a solid size="sm" Button with
  // IconUserPlus + "Share" (clips-share-trigger.tsx:10-37).
  ".clips-cell-mock-share-btn { display: flex; align-items: center; gap: 8px; padding: 9px 16px; border-radius: 8px; background: #f5f5f5; color: #151515; font-size: 14px; font-weight: 600; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35); }",

  // Real popover: PopoverContent className="w-[360px] ... p-0" (share-dialog.tsx:170-176).
  // Positioned to drop down from the header's Share button, over the frame.
  ".clips-cell-mock-popover { position: absolute; top: 48px; right: 0; width: 360px; border-radius: 10px; overflow: hidden; background: #1c1c1c; border: 1px solid #333333; box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5); z-index: 1; }",

  // Real Tabs header: TabsList variant="line" h-8, "People" | "Agents" (share-dialog.tsx:320-345).
  ".clips-cell-mock-tabs { display: flex; align-items: center; gap: 14px; height: 32px; padding: 0 12px; border-bottom: 1px solid #2c2c2c; }",
  ".clips-cell-mock-tab { position: relative; height: 100%; display: flex; align-items: center; font-size: 13px; color: #808080; }",
  ".clips-cell-mock-tab.is-active { color: #e6e6e6; font-weight: 500; }",
  ".clips-cell-mock-tab.is-active::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: #e6e6e6; border-radius: 2px 2px 0 0; }",

  // Real Agents tab content: "-mx-1.5 flex flex-col gap-0.5", rows are ghost
  // Button h-9 with size-4 icons and text-sm labels (share-dialog.tsx:827-871).
  ".clips-cell-mock-agent-list { display: flex; flex-direction: column; gap: 2px; padding: 8px; }",
  ".clips-cell-mock-agent-row { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 6px; border-radius: 6px; color: #e6e6e6; font-size: 14px; font-weight: 400; }",
  ".clips-cell-mock-agent-divider { margin: 4px 6px; border-top: 1px solid #333333; }",
  ".clips-cell-mock-agent-icon { width: 16px; height: 16px; color: #999999; flex-shrink: 0; }",

  // Recreates player-controls.tsx's control bar: play/pause, scrubber with
  // marker dots, elapsed/total time, speed, and fullscreen
  // (player-controls.tsx:132-328).
  ".clips-cell-mock-controls { position: absolute; left: 14px; bottom: 12px; right: 14px; display: flex; align-items: center; gap: 10px; color: rgba(255, 255, 255, 0.85); }",
  ".clips-cell-mock-controls-icon { flex-shrink: 0; }",
  ".clips-cell-mock-controls-track { position: relative; flex: 1 1 auto; height: 3px; border-radius: 999px; background: rgba(255, 255, 255, 0.22); overflow: visible; }",
  ".clips-cell-mock-controls-fill { width: 42%; height: 100%; border-radius: 999px; background: rgba(255, 255, 255, 0.7); }",
  ".clips-cell-mock-controls-marker { position: absolute; top: 50%; width: 5px; height: 5px; border-radius: 50%; background: #ffffff; transform: translate(-50%, -50%); }",
  ".clips-cell-mock-controls-time { flex-shrink: 0; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }",
  ".clips-cell-mock-controls-time-total { color: rgba(255, 255, 255, 0.5); }",
  ".clips-cell-mock-controls-speed { flex-shrink: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }",
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
      <div className="clips-cell-mock-inner" aria-hidden="true">
        <div className="clips-cell-mock-header">
          <span className="clips-cell-mock-title">Fix cart bug on mobile</span>
          <div className="clips-cell-mock-share-btn">
            <IconUserPlus size={16} />
            Share
          </div>
        </div>

        <div className="clips-cell-mock-frame">
          <div className="clips-cell-mock-fade" />

          <div className="clips-cell-mock-controls">
            <IconPlayerPlayFilled
              className="clips-cell-mock-controls-icon"
              size={16}
            />
            <div className="clips-cell-mock-controls-track">
              <div className="clips-cell-mock-controls-fill" />
              <span
                className="clips-cell-mock-controls-marker"
                style={{ left: "28%" }}
              />
              <span
                className="clips-cell-mock-controls-marker"
                style={{ left: "61%" }}
              />
            </div>
            <span className="clips-cell-mock-controls-time">
              1:24
              <span className="clips-cell-mock-controls-time-total">
                /4:52
              </span>
            </span>
            <span className="clips-cell-mock-controls-speed">1.2x</span>
            <IconMaximize className="clips-cell-mock-controls-icon" size={16} />
          </div>
        </div>

        <div className="clips-cell-mock-popover">
          <div className="clips-cell-mock-tabs">
            <span className="clips-cell-mock-tab">People</span>
            <span className="clips-cell-mock-tab is-active">Agents</span>
          </div>
          <div className="clips-cell-mock-agent-list">
            {AGENT_ROWS.map((row, index) => (
              <div key={row.label}>
                {index === 1 ? (
                  <div className="clips-cell-mock-agent-divider" />
                ) : null}
                <div className="clips-cell-mock-agent-row">
                  <span className="clips-cell-mock-agent-icon">
                    {row.icon}
                  </span>
                  <span>{row.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
