/**
 * Static, decorative recreation of an agent chat exchange: a prompt with a
 * clip share link asking the agent to investigate a reported bug, followed
 * by the agent's confirmation that it found and fixed the issues, citing the
 * recording evidence (screenshot, console log, network log) it used — used
 * as the art for the "Investigate a reported bug" use-case card on the Clips
 * landing page.
 *
 * All CSS lives here, scoped under `.clips-cell-mock`, following the same
 * convention as `ClipsLibraryMock.tsx`. The chat renders inside its own
 * floating window card (background, rounded corners, shadow) so it reads as
 * an app screenshot even though the section behind it has no panel of its
 * own.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it
 * is `aria-hidden`, so no assistive tech ever reads these strings; they are
 * the pixels of a product screenshot (a fake chat transcript).
 */
import { IconArrowUp, IconChevronRight, IconPaperclip } from "@tabler/icons-react";

const FIXED_ITEMS = [
  "Sidebar nav didn't collapse on mobile. I saw it clipped in your screenshot at 0:42.",
  "Search results reset on every keystroke. The console log showed the list re-rendering from scratch.",
  "Save stayed disabled after editing a field. The network log showed the update request never fired.",
];

const CLIPS_CELL_MOCK_CSS = [
  ".clips-cell-mock { position: relative; width: 100%; }",
  ".clips-cell-mock, .clips-cell-mock * { box-sizing: border-box; }",
  ".clips-cell-mock-frame { display: flex; flex-direction: column; gap: 24px; padding: 36px; border-radius: 12px; background: var(--cell-window-bg); border: 1px solid var(--cell-window-border); box-shadow: 0 28px 56px rgba(0, 0, 0, 0.35); font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }",

  ".clips-cell-mock { --cell-window-bg: #1c1c1c; --cell-window-border: #2c2c2c; --cell-prompt-bg: #2c2c2c; --cell-prompt-border: #3d3d3d; --cell-prompt-fg: #e6e6e6; --cell-fg: #e6e6e6; --cell-fg-muted: #999999; --cell-fg-subtle: #808080; --cell-composer-bg: #262626; --cell-composer-border: #383838; }",

  ".clips-cell-mock-prompt { padding: 16px 18px; border-radius: 8px; background: var(--cell-prompt-bg); border: 1px solid var(--cell-prompt-border); color: var(--cell-prompt-fg); font-size: 16px; line-height: 1.5; }",
  ".clips-cell-mock-prompt-link { color: var(--cell-fg-muted); }",

  ".clips-cell-mock-response { display: flex; flex-direction: column; gap: 11px; }",
  ".clips-cell-mock-searched { display: flex; align-items: center; gap: 2px; color: var(--cell-fg-subtle); font-size: 14px; }",
  ".clips-cell-mock-heading { color: var(--cell-fg); font-size: 15.5px; font-weight: 500; }",
  ".clips-cell-mock-list { display: flex; flex-direction: column; gap: 8px; padding: 0; margin: 0; list-style: none; }",
  ".clips-cell-mock-list-item { display: flex; align-items: flex-start; gap: 9px; color: var(--cell-fg-muted); font-size: 15.5px; line-height: 1.5; }",
  ".clips-cell-mock-list-index { flex-shrink: 0; color: var(--cell-fg-subtle); }",

  ".clips-cell-mock-composer { display: flex; align-items: center; gap: 12px; padding: 13px 18px; border-radius: 8px; background: var(--cell-composer-bg); border: 1px solid var(--cell-composer-border); color: var(--cell-fg-subtle); }",
  ".clips-cell-mock-composer-label { flex: 1 1 auto; font-size: 15.5px; }",
  ".clips-cell-mock-composer-send { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 999px; background: var(--cell-fg); color: #191919; flex-shrink: 0; }",

  "html.light .clips-cell-mock { --cell-window-bg: #fdfdfb; --cell-window-border: #e3e0d8; --cell-prompt-bg: #f1f0ea; --cell-prompt-border: #e3e0d8; --cell-prompt-fg: #22201c; --cell-fg: #22201c; --cell-fg-muted: #56534d; --cell-fg-subtle: #827e76; --cell-composer-bg: #f1f0ea; --cell-composer-border: #e3e0d8; }",
  "html.light .clips-cell-mock-frame { box-shadow: 0 24px 48px rgba(50, 48, 38, 0.14); }",
  "html.light .clips-cell-mock-composer-send { color: #f1f0ea; }",
].join("\n");

export function ClipsInvestigateBugMock({
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
        <div className="clips-cell-mock-prompt">
          Watch{" "}
          <span className="clips-cell-mock-prompt-link">
            clips.example.com/api/agent-context.json?id=kL9wQ2t7
          </span>{" "}
          and fix the bugs I found in the dashboard.
        </div>
        <div className="clips-cell-mock-response">
          <div className="clips-cell-mock-searched">
            Watched the recording <IconChevronRight size={14} />
          </div>
          <div className="clips-cell-mock-heading">
            Fixed the three issues from your recording:
          </div>
          <ol className="clips-cell-mock-list">
            {FIXED_ITEMS.map((item, index) => (
              <li key={item} className="clips-cell-mock-list-item">
                <span className="clips-cell-mock-list-index">
                  {index + 1}.
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="clips-cell-mock-composer">
          <IconPaperclip size={16} />
          <span className="clips-cell-mock-composer-label">
            Ask a follow-up
          </span>
          <span className="clips-cell-mock-composer-send">
            <IconArrowUp size={15} />
          </span>
        </div>
      </div>
    </div>
  );
}
