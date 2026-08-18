import { readAppStateForCurrentTab } from "./_tab-state.js";

/** A measurement record written by the editor after rendering a slide.
 * Both overflow fields must be zero for the slide to fit the canvas. */
export interface SlideFitMeasurement {
  slideId: string;
  deckId?: string;
  contentHeight: number;
  contentWidth?: number;
  viewportHeight: number;
  viewportWidth?: number;
  verticalOverflow: number;
  horizontalOverflow?: number;
  contentHash?: string;
  measuredAt: number;
}

/** What `awaitLayoutFitCheck` returns. `status: "fits"` and `status: "overflows"`
 * mean the editor measured the slide (we have a definitive answer); `status:
 * "timeout"` means no measurement arrived within the polling window — the
 * deck might not be open in any editor, or the renderer is slow. Treat
 * `timeout` as a soft "unknown", not as success. */
export type SlideFitResult =
  | { status: "fits"; measurement: SlideFitMeasurement }
  | { status: "overflows"; measurement: SlideFitMeasurement }
  | { status: "timeout" };

const DEFAULT_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 150;

/** Poll `application_state.slide-fit-check` for a fresh measurement of the
 * given slide. The editor writes this key after every measurement, so a
 * matching `slideId` plus a `measuredAt` timestamp ≥ `since` is proof that
 * the slide rendered AFTER the action's DB write — we're not looking at a
 * stale measurement from a previous slide.
 *
 * Returns:
 *   - `{ status: "overflows", measurement }` when the slide's natural
 *     rendered content was too tall for the canvas. The caller (add-slide /
 *     update-slide) surfaces this in the agent's tool result so the agent
 *     can patch the slide and try again.
 *   - `{ status: "fits", measurement }` when the slide rendered and fits.
 *   - `{ status: "timeout" }` when no measurement arrived (deck not open in
 *     an editor, headless server, etc.). Caller should NOT treat this as a
 *     failure — just no auto-fix signal available.
 */
export async function awaitLayoutFitCheck(
  slideId: string,
  since: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  expectedContentHash?: string,
): Promise<SlideFitResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Reads can fail when there's no authenticated request context
    // (e.g. headless tests, server-only runs) — treat that as "no editor
    // is reporting, so we can't fit-check" and exit with timeout.
    let raw: unknown = null;
    try {
      raw = await readAppStateForCurrentTab("slide-fit-check", {
        fallbackToGlobal: false,
      });
    } catch {
      return { status: "timeout" };
    }
    const m = raw as SlideFitMeasurement | null;
    if (
      m &&
      m.slideId === slideId &&
      (expectedContentHash === undefined ||
        m.contentHash === expectedContentHash) &&
      Number.isFinite(m.measuredAt) &&
      m.measuredAt >= since &&
      Number.isFinite(m.verticalOverflow) &&
      Number.isFinite(m.contentHeight) &&
      Number.isFinite(m.viewportHeight) &&
      (m.horizontalOverflow === undefined ||
        Number.isFinite(m.horizontalOverflow))
    ) {
      return m.verticalOverflow > 0 || (m.horizontalOverflow ?? 0) > 0
        ? { status: "overflows", measurement: m }
        : { status: "fits", measurement: m };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { status: "timeout" };
}

/** Format an overflow result into a short tool-result block that the agent
 * will see and act on. Includes the slide id, the exact overflow, and a
 * prioritized fix list. The wording is deliberately bounded so the agent
 * makes one structural repair and verifies it instead of looping. */
export function formatOverflowForTool(
  deckId: string,
  m: SlideFitMeasurement,
): string {
  const hasHorizontal = (m.horizontalOverflow ?? 0) > 0;
  const hasVertical = m.verticalOverflow > 0;

  // A row of side-by-side cards/columns that's too wide is a *width formula*
  // bug (fixed px flex-basis, a wrong container-width assumption, a missing
  // `min-width: 0`), not a density bug. The old list was vertical-only —
  // "tighten copy" / "fewer stacked cards" — which cannot shrink a fixed
  // column width no matter how many times it's applied, so a horizontal
  // overflow looped forever against fixes that could never touch the actual
  // defect (see the Oliver Robertson Slack thread this regression test
  // reproduces).
  const fixes = [
    ...(hasHorizontal
      ? [
          `Use percentage or flex-based column widths (e.g. \`flex: 1 1 0%\` with \`min-width: 0\`, or \`width: calc((100% - <gaps>) / <count>)\` measured against this slide's own content width) instead of a fixed pixel width per column.`,
          `Reduce the number of side-by-side columns, or wrap to a second row, if the content cannot fit at the slide's actual content width.`,
        ]
      : []),
    ...(hasVertical || !hasHorizontal
      ? [
          `Tighten copy — shorter headings/bullets, drop low-value lines.`,
          `Reduce vertical density — fewer stacked cards, smaller gaps, body font no smaller than 16px.`,
          `Reduce slide padding (e.g. 40px top/bottom instead of 60-80px).`,
          `Split across two slides only if the content cannot be compressed.`,
        ]
      : []),
  ];

  return [
    ``,
    `⚠ Layout overflows the canvas${hasVertical ? ` vertically by ${m.verticalOverflow}px` : ""}${hasHorizontal ? ` and horizontally by ${m.horizontalOverflow}px` : ""} — natural content is ${m.contentWidth ?? "unknown"}x${m.contentHeight}px inside a ${m.viewportWidth ?? "unknown"}x${m.viewportHeight}px content area.`,
    ``,
    `Make one structural repair now with \`update-slide --deckId ${deckId} --slideId ${m.slideId}\`. Prefer small surgical patches (--find / --replace) over a full rewrite:`,
    ...fixes.map((fix, index) => `${index + 1}. ${fix}`),
    ``,
    `Do **not** use zoom, \`transform: scale\`, clipping, \`overflow: scroll\`, or a smaller-than-16px body font. Preserve existing absolute text boxes and fix the normal-flow HTML. Verify the action result and then use \`view-screen\`; do not spin through another repair loop.`,
  ].join("\n");
}
