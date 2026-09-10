/**
 * The Clips share control and its open "Agents" menu on their own, centred in
 * the card with no app behind them, used as the alternate art for the "Act on
 * recorded feedback" use case.
 *
 * This is the counterpart to `ClipsActOnFeedbackMock`, which shows the same
 * menu in situ on a magnified crop of the recording page. Both render the
 * identical control and menu from `ClipsShareUi`, so the difference between
 * the two sections is only the framing.
 *
 * Everything here is at 1:1. The page version has to be magnified because it
 * shrinks a 1120px-wide layout into the card; with no page to fit, the real
 * sizes are already legible and scaling would only invent a size the product
 * never renders.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the frame inside it is
 * `aria-hidden`, so no assistive tech ever reads the strings it renders.
 */
import {
  CLIPS_APP_PALETTE,
  CLIPS_SHARE_UI_CSS,
  ClipsShareControl,
  ClipsShareMenu,
} from "./ClipsShareUi";

const CLIPS_SHARE_MOCK_CSS = [
  ".clips-share-mock { width: 100%; }",
  `.clips-share-mock-frame { ${CLIPS_APP_PALETTE} }`,
  ".clips-share-mock-frame { display: flex; align-items: center; justify-content: center; width: 100%; padding: 32px 0; }",

  // Enlarged with zoom rather than a transform. The two are not
  // interchangeable here: transform scale rasterises at the authored size and
  // then stretches the bitmap, which is what softens text and icon edges,
  // while zoom multiplies the computed lengths and re-runs layout, so the
  // label is laid out at its larger size and the icons re-render as vectors.
  // Doing it this way also keeps one copy of the real product class strings in
  // ClipsShareUi instead of a parallel set of enlarged values to keep in sync.
  ".clips-share-mock-group { zoom: 1.5; }",

  CLIPS_SHARE_UI_CSS,
].join("\n");

export function ClipsShareMenuMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`clips-share-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{CLIPS_SHARE_MOCK_CSS}</style>
      <div className="clips-share-mock-frame" aria-hidden="true">
        {/* The control sits on the menu's right edge, the way `align="end"`
            leaves it on the real page, and the pair centres as one group. The
            4px gap is the popover's own `sideOffset`. */}
        <div className="clips-share-mock-group flex w-[293px] flex-col items-end gap-1">
          {/* The control has to paint over the menu: the menu is the later
              sibling, so without this its heavy shadow washes across the
              button above it. No stacking context is in the way here, unlike
              the page illustration, so an ordinary z-index is enough. */}
          <ClipsShareControl className="relative z-10" />
          <ClipsShareMenu />
        </div>
      </div>
    </div>
  );
}
