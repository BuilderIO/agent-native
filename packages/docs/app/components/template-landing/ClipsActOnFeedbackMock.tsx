/**
 * Static recreation of the real Clips recording page, used as the art for the
 * "Act on recorded feedback" use-case card on the Clips landing page.
 *
 * Unlike a hand-drawn mock, every surface here is built from the class strings
 * of the components that actually render that page, so the artwork tracks the
 * product instead of drifting from it:
 *
 * - Header: `PageHeader` + `PageBreadcrumb`, with the joined share controls
 *   from `ShareRecordingPopover` — the solid `ClipsShareTrigger` (IconUserPlus
 *   + "Share") next to the `IconLink` copy button
 *   (templates/clips/app/routes/_app.r.$recordingId.tsx:2372-2387,
 *   components/library/page-header.tsx:98-137,
 *   components/player/clips-share-trigger.tsx:10-37,
 *   components/player/share-dialog.tsx:189-220).
 * - Two-column body: `lg:grid-cols-[minmax(0,1fr)_auto]` with the player column
 *   and the `lg:w-[360px]` `RecordingSidePanel`
 *   (_app.r.$recordingId.tsx:2388-2398, 2607-2614,
 *   components/player/recording-side-panel.tsx:25-35).
 * - Player: the route's `aspect-video ... ring-1 ring-border sm:rounded-2xl`
 *   frame, `CenterPlaybackOverlay`'s circular play button, and `PlayerControls`
 *   in its real left-to-right order — play, back/forward 5s, volume, time,
 *   captions, speed, picture-in-picture, theater, fullscreen
 *   (_app.r.$recordingId.tsx:2412-2417, components/player/video-player.tsx:
 *   1692-1704, 2214-2243, components/player/player-controls.tsx:132-328,
 *   components/player/scrubber.tsx:281-307).
 * - Title and meta row, view badge, React button, and options menu
 *   (_app.r.$recordingId.tsx:2502-2545, 2089-2136,
 *   components/player/recording-views-badge.tsx:140-164,
 *   components/player/delete-recording-menu.tsx:95-104).
 * - Transcript panel: search field, copy/download actions, and the
 *   `TranscriptSegmentRow` gutter — text column plus a fixed timestamp slot —
 *   drawn as skeleton lines rather than sentences
 *   (components/player/transcript-panel.tsx:320-431,
 *   components/transcript/transcript-segment-row.tsx:48-95).
 * - The open share popover on the Agents tab, which is the point of the card:
 *   this is the real entry point for handing a recording to an agent
 *   (share-dialog.tsx:223-241, 455-481, 827-871).
 *
 * Two things make those real classes work outside the Clips app. The scope
 * pins Clips' own palette (templates/clips/app/global.css:10-84) as HSL
 * triplets, so `bg-background`, `bg-sidebar`, `border-border`, and friends
 * resolve to the app's colours rather than the docs theme's, switching
 * between the app's own dark and light values under `html.light` so the
 * artwork still tracks the docs site's theme toggle. And the page is laid out at a fixed desktop width, then scaled to the card by generated
 * `@container` steps — the real desktop layout has to survive at card size,
 * since below `lg` the product moves the transcript panel under the player.
 *
 * Deliberately distinct from `ClipsInvestigateBugMock` (an agent chat
 * transcript): this one shows the recording itself and how it reaches an agent.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. The wrapper is
 * a `role="img"` with a localized `aria-label` and everything inside it is
 * `aria-hidden`, so no assistive tech ever reads these strings; they are the
 * pixels of a product screenshot (a fake recording, owner, and transcript).
 */
import {
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconMaximize,
  IconMoodSmile,
  IconPictureInPicture,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconPlayerSkipForward,
  IconRectangle,
  IconSearch,
  IconSubtitles,
  IconVolume,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  CLIPS_APP_PALETTE,
  CLIPS_APP_PALETTE_LIGHT,
  CLIPS_SHARE_UI_CSS,
  ClipsShareControl,
  ClipsShareMenu,
} from "./ClipsShareUi";

const RECORDING_TITLE = "Feedback on the landing page rewrite";

// The panel body is drawn as skeleton lines rather than sentences. Whichever
// tab is showing — Comments or Transcript — it is a stack of wrapped text rows,
// and abstracting it keeps the illustration about the share menu instead of
// inviting the reader to read fake feedback. Each entry is one segment, and its
// numbers are the widths of that segment's wrapped lines, so the last line of
// each runs short the way real text does.
const TRANSCRIPT_SKELETON: number[][] = [
  [100, 64],
  [100, 100, 46],
  [100, 72],
  [100, 100, 52],
  [100, 38],
  [100, 58],
];

// The page is laid out at desktop width so the real `lg:` layout applies.
// Below `lg` the product moves the transcript panel under the player, which is
// a different screen than the one this depicts. The height stops just under
// the player, so the crop ends on the frame rather than on the title block.
const DESIGN_WIDTH = 1120;
const DESIGN_HEIGHT = 470;

// Scale is set from type size, not from the box: the product renders its body
// copy at 14px and the illustration has to read at 18px, so everything is
// magnified by that ratio. The consequence is intentional — the page is far
// wider than the card, so it is anchored right to keep the share popover and
// transcript panel whole while the player runs off the left edge under the
// fade. Fitting the whole page in instead is what made the UI too small to
// read as a product screenshot.
const UI_TEXT_PX = 14;
const ILLUSTRATION_TEXT_PX = 18;
const SCALE = ILLUSTRATION_TEXT_PX / UI_TEXT_PX;
const MOBILE_SCALE = 0.9;

// The section background this crop sits on (app/routes/templates.clips.tsx),
// so the crop dissolves into it rather than ending on a visible edge. A CSS
// variable rather than a literal because that section now follows the docs
// site's light/dark toggle instead of staying pinned dark.
const FADE_COLOR = "var(--b-bg-page)";

const CLIPS_PAGE_MOCK_CSS = [
  ".clips-page-mock { width: 100%; }",

  // The app palette and the share-control override live in ClipsShareUi,
  // which holds the single copy shared with the bare variant.
  ".clips-page-mock-page { " + CLIPS_APP_PALETTE + " }",
  "html.light .clips-page-mock-page { " + CLIPS_APP_PALETTE_LIGHT + " }",
  CLIPS_SHARE_UI_CSS,

  // The recording page is held back so the open share menu reads as the
  // subject of the illustration. The popover is a sibling of this wrapper, so
  // it keeps full contrast; the page behind it recedes toward its own
  // background rather than toward the section, which is why the opacity sits
  // on the app and not on a scrim over the whole crop.
  ".clips-page-mock-app { opacity: 0.55; }",

  ".clips-page-mock-crop { position: relative; width: 100%; overflow: hidden; border-radius: 0 12px 12px 0; }",
  `.clips-page-mock-crop { height: ${Math.round(DESIGN_HEIGHT * SCALE)}px; }`,
  `.clips-page-mock-page { position: absolute; top: 0; right: 0; width: ${DESIGN_WIDTH}px; height: ${DESIGN_HEIGHT}px; transform-origin: top right; transform: scale(${SCALE}); }`,

  // Wide enough that the cut edge reads as a dissolve rather than a visible
  // seam: a short ramp left a hard line where the fade ended and the app's
  // own (unfaded) background took over.
  `.clips-page-mock-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to right, ${FADE_COLOR} 0%, ${FADE_COLOR} 6%, transparent 48%); }`,

  `@media (max-width: 768px) { .clips-page-mock-crop { height: ${Math.round(
    DESIGN_HEIGHT * MOBILE_SCALE,
  )}px; } .clips-page-mock-page { transform: scale(${MOBILE_SCALE}); } }`,

  // The popover's shadow has to separate it from a near-black page in dark
  // mode, so it is heavier than `shadow-md` and fully opaque. That same
  // opaque black reads as a smudge in light mode, where the page behind it is
  // pale, so it is cut down to a faint contact shadow instead.
  ".clips-page-mock-menu-shadow { box-shadow: 1px 1px 70px 0 rgba(0, 0, 0, 1); }",
  "html.light .clips-page-mock-menu-shadow { box-shadow: 1px 1px 70px 0 rgba(0, 0, 0, 0.1); }",

  // Mirrors the real popover's own open animation (Radix's zoom-in-95 +
  // fade-in from `data-[state=open]`), replayed on scroll instead of on
  // click since nothing here is actually clickable. `top right` is the
  // trigger's corner under `align="end"`, so the menu grows out from the
  // button rather than from its own centre. Toggling the reveal class off
  // when the illustration scrolls out (see the component) lets it replay
  // rather than only ever opening once.
  ".clips-page-mock-menu-anim { opacity: 0; transform: scale(0.95) translateY(-4px); transform-origin: top right; transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1), transform 0.7s cubic-bezier(0.22, 1, 0.36, 1); }",
  ".clips-page-mock-menu-anim.clips-menu-reveal-in { opacity: 1; transform: scale(1) translateY(0); }",
  "@media (scripting: none) { .clips-page-mock-menu-anim { opacity: 1; transform: none; } }",
  "@media (prefers-reduced-motion: reduce) { .clips-page-mock-menu-anim { opacity: 1; transform: none; transition: none; } }",
].join("\n");

function IconBtn({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md">
      {children}
    </span>
  );
}

function PanelTab({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={`relative inline-flex h-10 min-w-0 flex-none items-center justify-center gap-1.5 rounded-none px-2 py-0 text-sm font-medium whitespace-nowrap ${
        active
          ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground"
          : "text-foreground/60"
      }`}
    >
      {label}
    </span>
  );
}

export function ClipsActOnFeedbackMock({
  className = "",
  label,
}: {
  className?: string;
  label?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setMenuOpen(entry?.isIntersecting ?? false),
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`clips-page-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{CLIPS_PAGE_MOCK_CSS}</style>
      <div className="clips-page-mock-crop" aria-hidden="true">
        <div className="clips-page-mock-page bg-background text-foreground">
          <div className="clips-page-mock-app">
            {/* PageHeader. The share controls that belong in this row are
                rendered after the popover instead, for the reason noted
                there. */}
            <div className="flex h-12 shrink-0 items-center gap-2 px-4">
              <nav className="min-w-0">
                <ol className="flex flex-nowrap items-center gap-1.5 overflow-hidden text-sm text-muted-foreground">
                  <li className="block max-w-48 shrink-0 truncate">Library</li>
                  <li className="shrink-0">
                    <IconChevronRight className="size-3.5" />
                  </li>
                  <li className="min-w-0 truncate font-medium text-foreground">
                    {RECORDING_TITLE}
                  </li>
                </ol>
              </nav>
            </div>

            {/* clips-recording-view: player column + side panel column. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)]">
              <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-4 px-5 pb-5 pt-4">
                <div className="mx-auto flex w-full flex-1 flex-col gap-4">
                  <div className="flex w-full shrink-0 justify-center">
                    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
                      <div className="group relative h-full w-full select-none overflow-hidden rounded-2xl bg-black @container">
                        {/* The dark "build your own" thumbnail is a mostly-black
                            editor screenshot, which on a light page pulls the
                            eye more than the share menu this illustration is
                            actually about. Swapped for a brighter recording in
                            light mode via the theme-img-dark/light crossfade
                            pattern (tokens.css), not a new one. */}
                        <img
                          src="/clips/build-your-own.jpg"
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="theme-img-dark absolute inset-0 h-full w-full object-cover"
                        />
                        <img
                          src="/clips/meeting-report.jpg"
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="theme-img-light absolute inset-0 h-full w-full object-cover"
                        />

                        {/* CenterPlaybackOverlay */}
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/15 text-white">
                          <div className="flex flex-col items-center gap-3 px-4 drop-shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
                            <span className="flex size-[clamp(2.75rem,8cqw,4rem)] items-center justify-center rounded-full bg-player-control-foreground text-player-control shadow-xl ring-1 ring-player-control-foreground/35 [&_svg]:size-[clamp(1.25rem,3.5cqw,1.75rem)]">
                              <IconPlayerPlay className="fill-current" />
                            </span>
                          </div>
                        </div>

                        {/* PlayerControls */}
                        <div className="absolute inset-x-0 bottom-0">
                          <div className="bg-gradient-to-t from-black/80 via-black/50 to-transparent px-3 pb-2 pt-10">
                            <div className="relative flex h-10 items-center">
                              <div className="relative h-1.5 w-full rounded-full bg-white/35 shadow-[0_0_0_1px_rgba(0,0,0,0.16)]">
                                <div className="absolute inset-y-0 left-0 w-[2%] rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.45)]" />
                                <span className="absolute top-1/2 left-[34%] h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white/80" />
                                <span className="absolute top-1/2 left-[68%] h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white/80" />
                              </div>
                            </div>

                            <div className="relative flex min-w-0 items-center gap-1.5 text-white">
                              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md [&_svg]:size-5">
                                <IconPlayerPlayFilled />
                              </span>
                              <IconBtn>
                                <IconPlayerSkipForward className="size-4 rotate-180" />
                              </IconBtn>
                              <IconBtn>
                                <IconPlayerSkipForward className="size-4" />
                              </IconBtn>
                              <IconBtn>
                                <IconVolume className="size-4" />
                              </IconBtn>
                              <span className="shrink-0 px-1 font-mono text-[11px] leading-none whitespace-nowrap tabular-nums text-white/85">
                                0:00
                                <span className="text-white/50">/1:38</span>
                              </span>
                              <div className="flex-1" />
                              <IconBtn>
                                <IconSubtitles className="size-4" />
                              </IconBtn>
                              <span className="inline-flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium tabular-nums">
                                1.2x
                              </span>
                              <IconBtn>
                                <IconPictureInPicture className="size-4" />
                              </IconBtn>
                              <IconBtn>
                                <IconRectangle className="size-4" />
                              </IconBtn>
                              <IconBtn>
                                <IconMaximize className="size-4" />
                              </IconBtn>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Title, owner meta, and the view / react / options actions. */}
                  <div className="flex shrink-0 flex-col gap-3 px-1 pt-4">
                    <div className="flex flex-row items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-2xl font-semibold leading-tight tracking-[-0.02em]">
                          {RECORDING_TITLE}
                        </div>
                        <div className="mt-2 flex min-w-0 items-center gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                            N
                          </span>
                          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
                            <span className="min-w-0 max-w-full truncate font-medium text-foreground">
                              nadia@example.com
                            </span>
                            <span>·</span>
                            <span>Aug 31, 2026</span>
                            <span>·</span>
                            <span>Public</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground">
                          <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold ring-1 ring-background">
                            P
                          </span>
                          <span className="tabular-nums">14 views</span>
                        </span>
                        <span className="inline-flex h-8 items-center gap-1.5 px-2 text-xs">
                          <IconMoodSmile className="size-4" />
                          React
                        </span>
                        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md">
                          <IconDotsVertical className="size-4" />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* RecordingSidePanel */}
              <div className="col-start-2 row-start-1 my-4 me-4 flex w-[360px] min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-sidebar shadow-sm">
                <div className="flex h-10 min-h-10 w-fit max-w-full shrink-0 items-center justify-start gap-1 rounded-none bg-sidebar px-3 py-0 text-muted-foreground">
                  <PanelTab label="Comments" />
                  <PanelTab label="Transcript" active />
                  <PanelTab label="Settings" />
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center gap-2 border-b border-border p-3">
                    <div className="relative flex-1">
                      <IconSearch className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <div className="flex h-8 w-full items-center rounded-md border border-input bg-transparent pr-3 pl-8 text-xs text-muted-foreground" />
                    </div>
                    <div className="flex items-center gap-0.5">
                      <span className="inline-flex size-8 items-center justify-center rounded-md">
                        <IconCopy className="h-4 w-4" />
                      </span>
                      <span className="inline-flex size-8 items-center justify-center rounded-md">
                        <IconDownload className="h-4 w-4" />
                      </span>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden px-3">
                    <ul className="py-1">
                      {TRANSCRIPT_SKELETON.map((lines, index) => (
                        <li key={index}>
                          {/* Keeps TranscriptSegmentRow's gutter: text column,
                              then the fixed 12-unit timestamp slot. */}
                          <div className="relative flex w-full items-start gap-4 rounded-md px-3 py-2">
                            <span className="flex min-w-0 flex-1 flex-col gap-2">
                              {lines.map((width, lineIndex) => (
                                <span
                                  key={lineIndex}
                                  className="h-2.5 rounded-md bg-muted"
                                  style={{ width: `${width}%` }}
                                />
                              ))}
                            </span>
                            <span className="flex w-12 shrink-0 justify-end">
                              <span className="h-2 w-8 rounded-md bg-muted" />
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ShareRecordingPopover, open on the Agents tab. `align="end"` puts
              its right edge on the panel's. The width is art direction rather
              than product truth: the real popover is `w-[360px]`, which at this
              magnification crowded the crop, so it is pulled in. The shadow
              itself is themed above, since dark and light need different
              weights to read as elevation rather than a smudge. It plays its
              own open animation each time the illustration scrolls into view
              (see clips-page-mock-menu-anim above), since it's always
              rendered "already open" otherwise. */}
          <ClipsShareMenu
            className={`clips-page-mock-menu-shadow clips-page-mock-menu-anim absolute end-4 top-[46px] z-20 ${menuOpen ? "clips-menu-reveal-in" : ""}`}
          />

          {/* The share control triggers that menu, so it stays clear of the
              shadow the menu casts and out of the receded layer. It has to be
              lifted out of the header rather than given a z-index in place:
              the recede is an opacity stacking context, so any z-index inside
              it stays trapped under the popover however high it goes. The
              offsets put it back in its header row, an h-9 control centred in
              h-12, inset by the px-4 of that row. */}
          <ClipsShareControl className="absolute end-4 top-1.5 z-30" />
        </div>

        <div className="clips-page-mock-fade" />
      </div>
    </div>
  );
}
