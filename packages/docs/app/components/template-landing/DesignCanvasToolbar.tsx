/**
 * The Design editor's floating canvas toolbar, drawn as static art. The hero
 * mock pins its own full-width copy over the editor window; this is the trimmed
 * bar the narrower use-case cards can carry, so a card still reads as the
 * editor canvas rather than as a bare pair of screenshots.
 *
 * Callers own the positioning context: the bar is absolutely positioned against
 * the nearest positioned ancestor, so the frame it sits in needs
 * position: relative and overflow: hidden.
 *
 * i18n-raw-literal-disable-file -- artwork, not UI copy. There are no strings
 * here at all; the icons render inside a caller's aria-hidden frame.
 */
import {
  IconFrame,
  IconHandClick,
  IconMessage,
  IconPointer,
  IconScribble,
  IconSquare,
  IconTextSize,
  IconTransformPoint,
} from "@tabler/icons-react";

const TOOLS = [
  { icon: IconPointer, active: true },
  { icon: IconFrame },
  { icon: IconSquare },
  { icon: IconTextSize },
  { icon: IconMessage },
];

const MODES = [
  { icon: IconScribble },
  { icon: IconTransformPoint, active: true },
  { icon: IconHandClick },
];

export function DesignCanvasToolbar() {
  return (
    <div className="dct">
      <span className="dct-group">
        {TOOLS.map(({ icon: Icon, active }, index) => (
          <span
            key={index}
            className={active ? "dct-btn is-active" : "dct-btn"}
          >
            <Icon size={16} />
          </span>
        ))}
      </span>
      <span className="dct-divider" />
      <span className="dct-modes">
        {MODES.map(({ icon: Icon, active }, index) => (
          <span
            key={index}
            className={active ? "dct-mode is-active" : "dct-mode"}
          >
            <Icon size={16} />
          </span>
        ))}
      </span>
    </div>
  );
}

export const DESIGN_CANVAS_TOOLBAR_CSS = [
  ".dct { position: absolute; bottom: 14px; left: 50%; z-index: 3; display: flex; max-width: calc(100% - 32px); transform: translateX(-50%); align-items: center; gap: 4px; overflow: hidden; padding: 5px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 11px; background: rgba(44, 44, 44, 0.95); box-shadow: 0 22px 55px -24px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.25); backdrop-filter: blur(8px); }",
  ".dct-group, .dct-modes { display: flex; flex-shrink: 0; align-items: center; gap: 2px; }",
  ".dct-modes { padding: 2px; border-radius: 6px; background: rgba(255, 255, 255, 0.1); }",
  ".dct-btn, .dct-mode { display: flex; width: 28px; height: 28px; flex-shrink: 0; align-items: center; justify-content: center; border-radius: 6px; color: #e5e5e5; }",
  ".dct-btn.is-active { background: hsl(0 0% 88%); color: hsl(0 0% 12%); }",
  ".dct-mode.is-active { background: rgba(3, 3, 3, 0.7); color: hsl(0 0% 90%); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }",
  ".dct-divider { width: 1px; height: 20px; flex-shrink: 0; margin: 0 2px; background: rgba(255, 255, 255, 0.15); }",

  "html.light .dct { border-color: rgba(0, 0, 0, 0.14); background: #ffffff; box-shadow: 0 24px 55px -22px rgba(0, 0, 0, 0.45), 0 2px 8px -2px rgba(0, 0, 0, 0.12); }",
  "html.light .dct-btn, html.light .dct-mode { color: hsl(0 0% 28%); }",
  "html.light .dct-btn.is-active { background: hsl(0 0% 20%); color: hsl(0 0% 98%); }",
  "html.light .dct-modes { background: rgba(0, 0, 0, 0.06); }",
  "html.light .dct-mode.is-active { background: #ffffff; color: hsl(0 0% 15%); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.16); }",
].join("\n");
