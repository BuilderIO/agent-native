/**
 * Static, decorative recreation of an agent chat exchange: a prompt with a
 * clip share link asking the agent to act on recorded feedback, followed by
 * the agent's confirmation that it made the requested changes — used as the
 * art for the "Act on recorded feedback" use-case card on the Clips landing
 * page.
 *
 * All CSS lives here, scoped under `.clips-cell-mock`, following the same
 * convention as `ClipsLibraryMock.tsx`.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the entire frame inside it
 * is `aria-hidden`, so no assistive tech ever reads these strings; they are
 * the pixels of a product screenshot (a fake chat transcript).
 */
import { IconArrowUp, IconChevronRight, IconPaperclip } from "@tabler/icons-react";

const FIXED_ITEMS = [
  "Cart total didn't update when the quantity changed",
  "Checkout button stayed disabled after applying a coupon",
  "Confirmation email was missing the order number",
];

const CLIPS_CELL_MOCK_CSS = [
  ".clips-cell-mock { position: relative; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; }",
  ".clips-cell-mock, .clips-cell-mock * { box-sizing: border-box; }",
  ".clips-cell-mock-frame { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 10px; padding: 20px; background: var(--cell-bg); font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }",

  ".clips-cell-mock { --cell-bg: #191919; --cell-prompt-bg: #262626; --cell-prompt-border: #383838; --cell-prompt-fg: #e6e6e6; --cell-fg: #e6e6e6; --cell-fg-muted: #999999; --cell-fg-subtle: #808080; --cell-check: #6bc47a; --cell-composer-bg: #212121; --cell-composer-border: #333333; }",

  ".clips-cell-mock-prompt { flex: 0 0 auto; padding: 10px 12px; border-radius: 10px; background: var(--cell-prompt-bg); border: 1px solid var(--cell-prompt-border); color: var(--cell-prompt-fg); font-size: 11px; line-height: 1.45; }",
  ".clips-cell-mock-prompt-link { color: var(--cell-fg-muted); }",

  ".clips-cell-mock-response { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }",
  ".clips-cell-mock-searched { display: flex; align-items: center; gap: 2px; color: var(--cell-fg-subtle); font-size: 10.5px; }",
  ".clips-cell-mock-heading { color: var(--cell-fg); font-size: 11.5px; font-weight: 500; }",
  ".clips-cell-mock-list { display: flex; flex-direction: column; gap: 4px; padding: 0; margin: 0; list-style: none; }",
  ".clips-cell-mock-list-item { display: flex; align-items: flex-start; gap: 6px; color: var(--cell-fg-muted); font-size: 10.5px; line-height: 1.4; }",
  ".clips-cell-mock-list-check { flex-shrink: 0; margin-top: 1px; color: var(--cell-check); font-size: 10.5px; font-weight: 700; }",

  ".clips-cell-mock-composer { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 999px; background: var(--cell-composer-bg); border: 1px solid var(--cell-composer-border); color: var(--cell-fg-subtle); }",
  ".clips-cell-mock-composer-label { flex: 1 1 auto; font-size: 10.5px; }",
  ".clips-cell-mock-composer-send { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; background: var(--cell-fg); color: var(--cell-bg); flex-shrink: 0; }",

  "html.light .clips-cell-mock { --cell-bg: #f1f0ea; --cell-prompt-bg: #fdfdfb; --cell-prompt-border: #e3e0d8; --cell-prompt-fg: #22201c; --cell-fg: #22201c; --cell-fg-muted: #56534d; --cell-fg-subtle: #827e76; --cell-check: #2f8f45; --cell-composer-bg: #fdfdfb; --cell-composer-border: #e3e0d8; }",
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
        <div className="clips-cell-mock-prompt">
          Watch{" "}
          <span className="clips-cell-mock-prompt-link">
            clips.agent-native.com/share/U1f0uKYYKGF2
          </span>{" "}
          and fix the issues from my feedback.
        </div>
        <div className="clips-cell-mock-response">
          <div className="clips-cell-mock-searched">
            Watched the recording <IconChevronRight size={11} />
          </div>
          <div className="clips-cell-mock-heading">
            Fixed the three issues you called out:
          </div>
          <ol className="clips-cell-mock-list">
            {FIXED_ITEMS.map((item) => (
              <li key={item} className="clips-cell-mock-list-item">
                <span className="clips-cell-mock-list-check">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="clips-cell-mock-composer">
          <IconPaperclip size={13} />
          <span className="clips-cell-mock-composer-label">
            Ask a follow-up
          </span>
          <span className="clips-cell-mock-composer-send">
            <IconArrowUp size={12} />
          </span>
        </div>
      </div>
    </div>
  );
}
