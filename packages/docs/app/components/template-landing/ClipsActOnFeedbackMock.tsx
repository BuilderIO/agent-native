/**
 * Static, decorative recreation of an agent chat exchange: a prompt with a
 * clip share link asking the agent to act on recorded feedback, followed by
 * the agent's confirmation that it made the requested changes — used as the
 * art for the "Act on recorded feedback" use-case card on the Clips landing
 * page.
 *
 * All CSS lives here, scoped under `.clips-cell-mock`, following the same
 * convention as `ClipsLibraryMock.tsx`. Unlike that hero mock, this one has
 * no card/background of its own — it sits directly on whatever surface the
 * caller places it on, so it reads as a chat transcript rather than a boxed
 * screenshot.
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
  ".clips-cell-mock { position: relative; width: 100%; }",
  ".clips-cell-mock, .clips-cell-mock * { box-sizing: border-box; }",
  ".clips-cell-mock-frame { display: flex; flex-direction: column; gap: 18px; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }",

  ".clips-cell-mock { --cell-prompt-bg: #262626; --cell-prompt-border: #383838; --cell-prompt-fg: #e6e6e6; --cell-fg: #e6e6e6; --cell-fg-muted: #999999; --cell-fg-subtle: #808080; --cell-composer-bg: #212121; --cell-composer-border: #333333; }",

  ".clips-cell-mock-prompt { padding: 14px 16px; border-radius: 18px; background: var(--cell-prompt-bg); border: 1px solid var(--cell-prompt-border); color: var(--cell-prompt-fg); font-size: 13.5px; line-height: 1.5; }",
  ".clips-cell-mock-prompt-link { color: var(--cell-fg-muted); }",

  ".clips-cell-mock-response { display: flex; flex-direction: column; gap: 8px; }",
  ".clips-cell-mock-searched { display: flex; align-items: center; gap: 2px; color: var(--cell-fg-subtle); font-size: 12px; }",
  ".clips-cell-mock-heading { color: var(--cell-fg); font-size: 13px; font-weight: 500; }",
  ".clips-cell-mock-list { display: flex; flex-direction: column; gap: 6px; padding: 0; margin: 0; list-style: none; }",
  ".clips-cell-mock-list-item { display: flex; align-items: flex-start; gap: 8px; color: var(--cell-fg-muted); font-size: 13px; line-height: 1.5; }",
  ".clips-cell-mock-list-index { flex-shrink: 0; color: var(--cell-fg-subtle); }",

  ".clips-cell-mock-composer { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 999px; background: var(--cell-composer-bg); border: 1px solid var(--cell-composer-border); color: var(--cell-fg-subtle); }",
  ".clips-cell-mock-composer-label { flex: 1 1 auto; font-size: 13px; }",
  ".clips-cell-mock-composer-send { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 999px; background: var(--cell-fg); color: #191919; flex-shrink: 0; }",

  "html.light .clips-cell-mock { --cell-prompt-bg: #fdfdfb; --cell-prompt-border: #e3e0d8; --cell-prompt-fg: #22201c; --cell-fg: #22201c; --cell-fg-muted: #56534d; --cell-fg-subtle: #827e76; --cell-composer-bg: #fdfdfb; --cell-composer-border: #e3e0d8; }",
  "html.light .clips-cell-mock-composer-send { color: #f1f0ea; }",
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
            Watched the recording <IconChevronRight size={12} />
          </div>
          <div className="clips-cell-mock-heading">
            Fixed the three issues you called out:
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
          <IconPaperclip size={14} />
          <span className="clips-cell-mock-composer-label">
            Ask a follow-up
          </span>
          <span className="clips-cell-mock-composer-send">
            <IconArrowUp size={13} />
          </span>
        </div>
      </div>
    </div>
  );
}
