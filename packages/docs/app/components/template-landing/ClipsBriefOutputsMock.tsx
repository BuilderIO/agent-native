/**
 * A recorded brief in the middle, with lines radiating out to the four things
 * an agent can turn it into: an app change, a presentation, a design, and a
 * document. Art for the "Create from a recorded brief" use case, where the
 * point is the fan-out rather than any single screen, so this one is a diagram
 * instead of a crop of the product.
 *
 * The clip in the centre is the real Library card (thumbnail, play overlay,
 * duration badge, title, owner row) so the thing being fanned out still reads
 * as a Clips recording. The four outputs are icon cards; they are outside the
 * product, so there is no real UI to copy.
 *
 * The rays are one SVG sized to the whole diagram, drawn behind the cards with
 * percentage endpoints rather than a viewBox, which keeps the stroke an even
 * weight at every container width instead of shearing with the aspect ratio.
 * Each ray starts under the centre card and ends under an output card, so only
 * the span between the two is ever visible.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and the frame inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings.
 */
import {
  IconCode,
  IconFileText,
  IconPalette,
  IconPlayerPlayFilled,
  IconPresentation,
} from "@tabler/icons-react";

import { CLIPS_APP_PALETTE } from "./ClipsShareUi";

// Grid slot plus the ray endpoint that belongs to it, as percentages of the
// diagram box. The endpoints sit a little inside each card so the line stops
// under the card rather than at its outer corner.
const OUTPUTS = [
  {
    label: "App change",
    icon: IconCode,
    area: "tl",
    x: "13%",
    y: "15%",
  },
  {
    label: "Presentation",
    icon: IconPresentation,
    area: "tr",
    x: "87%",
    y: "15%",
  },
  {
    label: "Design",
    icon: IconPalette,
    area: "bl",
    x: "13%",
    y: "85%",
  },
  {
    label: "Document",
    icon: IconFileText,
    area: "br",
    x: "87%",
    y: "85%",
  },
] as const;

const CLIPS_BRIEF_MOCK_CSS = [
  ".clips-brief-mock { width: 100%; }",
  `.clips-brief-mock-frame { ${CLIPS_APP_PALETTE} }`,
  ".clips-brief-mock-frame { display: flex; justify-content: center; width: 100%; padding: 16px 0; }",
  ".clips-brief-mock-diagram { position: relative; width: 100%; max-width: 620px; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); grid-template-rows: auto auto auto; grid-template-areas: 'tl . tr' '. clip .' 'bl . br'; align-items: center; justify-items: center; gap: 56px 8px; }",
  ".clips-brief-mock-rays { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }",
  ".clips-brief-mock-rays line { stroke: hsl(var(--border)); }",
].join("\n");

function BriefClipCard() {
  return (
    <div
      className="relative w-[240px] select-none overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
      style={{ gridArea: "clip" }}
    >
      <div className="relative aspect-video bg-muted">
        <img
          src="/clips/growth-plan.jpg"
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
          <IconPlayerPlayFilled className="size-7" />
        </div>
        <span className="absolute bottom-1.5 end-1.5 rounded bg-black/80 px-1.5 py-px text-[11px] tabular-nums text-white">
          2:14
        </span>
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <div className="truncate text-sm font-medium">
          Brief: new onboarding flow
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-accent-foreground">
            NO
          </span>
          <span>Nadia Okonkwo</span>
          <span>•</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}

export function ClipsBriefOutputsMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`clips-brief-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{CLIPS_BRIEF_MOCK_CSS}</style>
      <div className="clips-brief-mock-frame" aria-hidden="true">
        <div className="clips-brief-mock-diagram">
          <svg className="clips-brief-mock-rays">
            {OUTPUTS.map((output) => (
              <line
                key={output.label}
                x1="50%"
                y1="50%"
                x2={output.x}
                y2={output.y}
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            ))}
          </svg>

          <BriefClipCard />

          {OUTPUTS.map((output) => (
            <div
              key={output.label}
              style={{ gridArea: output.area }}
              className="relative flex w-[136px] select-none flex-col items-center gap-2 rounded-lg border border-border bg-card px-3 py-4 text-card-foreground transition-colors hover:border-border hover:bg-accent"
            >
              <span className="flex size-9 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                <output.icon className="size-[18px]" />
              </span>
              <span className="text-sm font-medium">{output.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
