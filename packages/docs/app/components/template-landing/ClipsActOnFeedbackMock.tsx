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
 * - Transcript panel: search field, copy/download actions, and
 *   `TranscriptSegmentRow` rows with their right-aligned mono timestamps
 *   (components/player/transcript-panel.tsx:320-431,
 *   components/transcript/transcript-segment-row.tsx:48-95).
 * - The open share popover on the Agents tab, which is the point of the card:
 *   this is the real entry point for handing a recording to an agent
 *   (share-dialog.tsx:223-241, 455-481, 827-871).
 *
 * Two things make those real classes work outside the Clips app. The scope
 * pins Clips' own dark palette (templates/clips/app/global.css:50-84) as HSL
 * triplets, so `bg-background`, `bg-sidebar`, `border-border`, and friends
 * resolve to the app's colours rather than the docs theme. And the page is
 * laid out at a fixed desktop width, then scaled to the card by generated
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
  IconBrandOpenai,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconLink,
  IconMaximize,
  IconMoodSmile,
  IconPictureInPicture,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconPlayerSkipForward,
  IconRectangle,
  IconSearch,
  IconSubtitles,
  IconUserPlus,
  IconVolume,
} from "@tabler/icons-react";

// Copies of `ClaudeLogo` / `ClaudeCodeLogo` from
// templates/clips/app/components/agent-destination-logos.tsx. `CodexLogo`
// there is `IconBrandOpenai`, so it is imported directly above.
function ClaudeLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`shrink-0 ${className ?? ""}`}
      fill="currentColor"
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  );
}

function ClaudeCodeLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`shrink-0 ${className ?? ""}`}
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

const RECORDING_TITLE = "Feedback on the landing page rewrite";

const TRANSCRIPT: Array<{ time: string; text: string }> = [
  {
    time: "0:00",
    text: "Recording some feedback on the landing page rewrite so you can pick it up from here.",
  },
  {
    time: "0:14",
    text: "The hero headline is good, but the subhead underneath repeats it almost word for word.",
  },
  {
    time: "0:29",
    text: "Right here, the install snippet gets cut off on the right at this window width.",
  },
  {
    time: "0:41",
    text: "The three cards below should be equal height. The middle one is short so the row looks uneven.",
  },
  {
    time: "0:58",
    text: "I left the console open for this part. There is a hydration warning coming from the copy button.",
  },
  {
    time: "1:12",
    text: "Last one, the footer links are lighter than the body text and hard to read.",
  },
  {
    time: "1:26",
    text: "That is everything. Should be about twenty minutes of work.",
  },
];

const AGENT_ROWS = [
  { label: "Copy agent prompt", icon: <IconLink className="size-4" /> },
  { label: "Open in Claude", icon: <ClaudeLogo className="size-4" /> },
  {
    label: "Open in Claude Code",
    icon: <ClaudeCodeLogo className="size-4" />,
  },
  { label: "Open in Codex", icon: <IconBrandOpenai className="size-4" /> },
] as const;

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

// Matches the pinned row background on the landing page
// (app/routes/templates.clips.tsx), so the crop dissolves into the section
// rather than ending on a visible edge.
const FADE_COLOR = "#0a0a0a";

const CLIPS_PAGE_MOCK_CSS = [
  ".clips-page-mock { width: 100%; }",

  // Clips' own dark palette (templates/clips/app/global.css:50-84), pinned so
  // the real utility classes below resolve to the app's colours instead of the
  // docs page theme. `--player-control*` come from the same file's `:root`.
  //
  // Two deliberate departures from the app: `--background` and
  // `--sidebar-background` are darker here (5% / 8% against the app's 10% /
  // 14%) so the crop settles into the near-black section it sits on instead of
  // reading as a lighter panel floating on it. The 3-point gap between them is
  // kept, which is what still separates the transcript panel from the page.
  // Do not "restore" these to the app values without re-checking the section.
  ".clips-page-mock-page { --background: 0 0% 5%; --foreground: 0 0% 90%; --card: 0 0% 14%; --card-foreground: 0 0% 90%; --popover: 0 0% 15%; --popover-foreground: 0 0% 90%; --primary: 0 0% 75%; --primary-foreground: 0 0% 10%; --muted: 0 0% 16%; --muted-foreground: 0 0% 60%; --accent: 0 0% 18%; --accent-foreground: 0 0% 90%; --border: 0 0% 24%; --input: 0 0% 24%; --sidebar-background: 0 0% 8%; --sidebar-foreground: 0 0% 60%; --player-control: 0 0% 0%; --player-control-foreground: 0 0% 100%; }",

  // `.dark .clips-share-trigger` sets the same override in the real app, which
  // is what makes the header's share controls read as solid white on dark.
  ".clips-page-mock-share-group { --primary: 0 0% 100%; }",

  // The recording page is held back so the open share menu reads as the
  // subject of the illustration. The popover is a sibling of this wrapper, so
  // it keeps full contrast; the page behind it recedes toward its own
  // background rather than toward the section, which is why the opacity sits
  // on the app and not on a scrim over the whole crop.
  ".clips-page-mock-app { opacity: 0.55; }",

  ".clips-page-mock-crop { position: relative; width: 100%; overflow: hidden; border-radius: 0 12px 12px 0; }",
  `.clips-page-mock-crop { height: ${Math.round(DESIGN_HEIGHT * SCALE)}px; }`,
  `.clips-page-mock-page { position: absolute; top: 0; right: 0; width: ${DESIGN_WIDTH}px; height: ${DESIGN_HEIGHT}px; transform-origin: top right; transform: scale(${SCALE}); }`,

  // Short on purpose: the fade only has to dissolve the cut edge, so it has to
  // clear the player before the video itself goes dark. At this magnification
  // only a sliver of the player is in frame, so the ramp is tighter than it
  // would need to be on a wider crop.
  `.clips-page-mock-fade { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to right, ${FADE_COLOR} 0%, ${FADE_COLOR} 2%, transparent 12%); }`,

  `@media (max-width: 768px) { .clips-page-mock-crop { height: ${Math.round(
    DESIGN_HEIGHT * MOBILE_SCALE,
  )}px; } .clips-page-mock-page { transform: scale(${MOBILE_SCALE}); } }`,
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
  return (
    <div
      className={`clips-page-mock ${className}`}
      role="img"
      aria-label={label}
    >
      <style>{CLIPS_PAGE_MOCK_CSS}</style>
      <div className="clips-page-mock-crop" aria-hidden="true">
        <div className="clips-page-mock-page bg-background text-foreground">
          <div className="clips-page-mock-app">
            {/* PageHeader: breadcrumb, then the joined share controls. */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
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
              <div className="ms-auto flex shrink-0 items-center">
                <div className="clips-page-mock-share-group flex shrink-0 items-center">
                  <span className="inline-flex h-9 items-center gap-2 rounded-md rounded-e-none bg-primary px-3 text-sm font-medium text-primary-foreground">
                    <IconUserPlus className="size-4" />
                    <span>Share</span>
                  </span>
                  <span className="inline-flex h-9 w-8 items-center justify-center rounded-md rounded-s-none border-s border-primary-foreground/15 bg-primary px-0 text-primary-foreground shadow-none">
                    <IconLink className="size-4" />
                  </span>
                </div>
              </div>
            </div>

            {/* clips-recording-view: player column + side panel column. */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)]">
              <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-4 px-5 pb-5 pt-4">
                <div className="mx-auto flex w-full flex-1 flex-col gap-4">
                  <div className="flex w-full shrink-0 justify-center">
                    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border">
                      <div className="group relative h-full w-full select-none overflow-hidden rounded-2xl bg-black @container">
                        <img
                          src="/clips/build-your-own.jpg"
                          alt=""
                          className="h-full w-full object-cover"
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
                      <div className="flex h-8 w-full items-center rounded-md border border-input bg-transparent pr-3 pl-8 text-xs text-muted-foreground">
                        Search transcript
                      </div>
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
                      {TRANSCRIPT.map((segment, index) => (
                        <li key={segment.time}>
                          <div
                            className={`relative flex w-full items-baseline gap-4 rounded-md px-3 py-1.5 text-left text-sm leading-normal text-foreground ${
                              index === 0 ? "bg-accent" : ""
                            }`}
                          >
                            <span className="min-w-0 flex-1 whitespace-pre-wrap">
                              <span
                                className={
                                  index === 0
                                    ? "text-sm leading-normal text-foreground"
                                    : "text-sm leading-normal text-foreground/80"
                                }
                              >
                                {segment.text}
                              </span>
                            </span>
                            <span className="pointer-events-none w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/80">
                              {segment.time}
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

          {/* ShareRecordingPopover, open on the Agents tab. */}
          {/* `align="end"`, so the popover and the 360px panel below it share a
              right edge — the same coincidence the real page has. */}
          <div className="absolute end-4 top-[46px] z-20 w-[360px] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
            <div className="px-3 py-2">
              <div className="flex flex-col gap-3">
                <div className="flex h-8 w-full items-center justify-start gap-1 rounded-none px-0 py-0 text-muted-foreground">
                  <span className="relative inline-flex h-8 min-w-0 flex-none items-center justify-center rounded-none px-2 py-0 text-sm font-medium text-foreground/60">
                    People
                  </span>
                  <span className="relative inline-flex h-8 min-w-0 flex-none items-center justify-center rounded-none px-2 py-0 text-sm font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground">
                    Agents
                  </span>
                </div>

                <div className="-mx-1.5 flex flex-col gap-0.5">
                  {AGENT_ROWS.map((row, index) => (
                    <div key={row.label}>
                      {index === 1 ? (
                        <div className="my-1 border-t border-border" />
                      ) : null}
                      <span className="flex h-9 w-full items-center justify-start gap-2 rounded-md px-1.5 text-sm font-normal">
                        <span className="text-muted-foreground">
                          {row.icon}
                        </span>
                        {row.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="clips-page-mock-fade" />
      </div>
    </div>
  );
}
