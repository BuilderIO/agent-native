/**
 * The Clips share control and its open "Agents" menu, drawn from the class
 * strings of the components that actually render them, and shared by every
 * landing-page illustration that needs them so the two never drift apart:
 *
 * - Control: `ClipsShareTrigger` / `PageHeaderPrimaryAction`, a solid button
 *   with `IconUserPlus` and the label "Share", joined to the `IconLink` copy
 *   button from `ShareRecordingPopover`
 *   (templates/clips/app/components/player/clips-share-trigger.tsx:10-37,
 *   components/player/share-dialog.tsx:189-220).
 * - Menu: `PopoverContent` with the People / Agents tabs and the agent
 *   destination rows, including the real `ClaudeLogo` / `ClaudeCodeLogo` /
 *   `CodexLogo` icons and the ghost-button hover state
 *   (share-dialog.tsx:223-241, 455-481, 827-871,
 *   components/agent-destination-logos.tsx).
 *
 * Neither component positions itself. The page illustration hangs the menu off
 * a header row and lifts the control above it; the bare illustration centres
 * the pair. Callers pass that in through `className`.
 *
 * i18n-raw-literal-disable-file -- this is artwork, not UI copy. Callers wrap
 * it in a `role="img"` with a localized `aria-label` and mark the frame
 * `aria-hidden`, so no assistive tech ever reads these strings.
 */
import { IconBrandOpenai, IconLink, IconUserPlus } from "@tabler/icons-react";

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

const AGENT_ROWS = [
  { label: "Copy agent prompt", icon: <IconLink className="size-4" /> },
  { label: "Open in Claude", icon: <ClaudeLogo className="size-4" /> },
  {
    label: "Open in Claude Code",
    icon: <ClaudeCodeLogo className="size-4" />,
  },
  { label: "Open in Codex", icon: <IconBrandOpenai className="size-4" /> },
] as const;

/**
 * Clips' own dark palette (templates/clips/app/global.css:50-84) as the HSL
 * triplets the shadcn utilities read, so `bg-popover`, `border-border`, and
 * friends resolve to the app's colours instead of whichever theme the docs
 * page is in. Apply to an ancestor of the artwork.
 *
 * Two deliberate departures from the app: `--background` and
 * `--sidebar-background` are darker here (5% / 8% against the app's 10% / 14%)
 * so a crop settles into the near-black section it sits on instead of reading
 * as a lighter panel floating on it. The 3-point gap between them is kept,
 * which is what still separates the transcript panel from the page. Do not
 * "restore" these to the app values without re-checking the section.
 */
export const CLIPS_APP_PALETTE =
  "--background: 0 0% 5%; --foreground: 0 0% 90%; --card: 0 0% 14%; --card-foreground: 0 0% 90%; --popover: 0 0% 15%; --popover-foreground: 0 0% 90%; --primary: 0 0% 75%; --primary-foreground: 0 0% 10%; --muted: 0 0% 16%; --muted-foreground: 0 0% 60%; --accent: 0 0% 18%; --accent-foreground: 0 0% 90%; --border: 0 0% 24%; --input: 0 0% 24%; --sidebar-background: 0 0% 8%; --sidebar-foreground: 0 0% 60%; --player-control: 0 0% 0%; --player-control-foreground: 0 0% 100%;";

/**
 * `.dark .clips-share-trigger` sets the same override in the real app, which
 * is what makes the share controls read as solid white on dark.
 */
export const CLIPS_SHARE_UI_CSS =
  ".clips-share-ui-trigger { --primary: 0 0% 100%; }";

export function ClipsShareControl({ className = "" }: { className?: string }) {
  return (
    <div
      className={`clips-share-ui-trigger flex shrink-0 items-center ${className}`}
    >
      <span className="inline-flex h-9 items-center gap-2 rounded-md rounded-e-none bg-primary px-3 text-sm font-medium text-primary-foreground">
        <IconUserPlus className="size-4" />
        <span>Share</span>
      </span>
      <span className="inline-flex h-9 w-8 items-center justify-center rounded-md rounded-s-none border-s border-primary-foreground/15 bg-primary px-0 text-primary-foreground shadow-none">
        <IconLink className="size-4" />
      </span>
    </div>
  );
}

/**
 * The width is art direction rather than product truth: the real popover is
 * `w-[360px]`, which crowded the magnified crop, so it is pulled in.
 *
 * Elevation is left to the caller, like position. Over the recording page the
 * menu needs a heavy shadow to lift off a near-black surface; standing on its
 * own in a card it overlaps nothing and a shadow would only add grime.
 */
export function ClipsShareMenu({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-[293px] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground ${className}`}
    >
      <div className="px-3 py-2">
        <div className="flex flex-col gap-3">
          <div className="flex h-8 w-full items-center justify-start gap-1 rounded-none px-0 py-0 text-muted-foreground">
            <span className="relative inline-flex h-8 min-w-0 flex-none items-center justify-center rounded-none px-2 py-0 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground">
              People
            </span>
            <span className="relative inline-flex h-8 min-w-0 flex-none items-center justify-center rounded-none px-2 py-0 text-sm font-medium text-foreground transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-foreground">
              Agents
            </span>
          </div>

          <div className="-mx-1.5 flex flex-col gap-0.5">
            {AGENT_ROWS.map((row, index) => (
              <div key={row.label}>
                {index === 1 ? (
                  <div className="my-1 border-t border-border" />
                ) : null}
                <span className="flex h-9 w-full items-center justify-start gap-2 rounded-md px-1.5 text-sm font-normal transition-colors hover:bg-accent hover:text-accent-foreground">
                  <span className="text-muted-foreground">{row.icon}</span>
                  {row.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
