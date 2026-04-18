# UI Audit — scheduling template

Date: 2026-04-18

Goal: rebuild the scheduling template to match Cal.com's IA, density, and
copy on every screen, while keeping the shadcn-monochrome chrome of the
`mail` and `calendar` templates and swapping Cal.com's brand blue
(#007EE5) as the sole accent color.

## Palette

| Token                   | Before                     | After                                             |
| ----------------------- | -------------------------- | ------------------------------------------------- |
| `--primary` (shell CTA) | violet-600 (`262 83% 58%`) | shadcn neutral foreground (`220 10% 15%`)         |
| `--sidebar-*` (nav)     | violet ring + purple icons | neutral slate                                     |
| `--brand-accent`        | `#7c3aed` (hex)            | `209 100% 45%` (Cal.com blue, `hsl()`-compatible) |
| `<meta theme-color>`    | `#7c3aed`                  | responsive neutral (white / dark)                 |
| favicon                 | 🗓 emoji                   | monochrome Tabler-style calendar SVG              |

`--brand-accent` is now stored as HSL-components so a per-event-type hex
color can be converted at runtime (`hexToHslValues`) and override the CSS
var without clobbering shadcn's `hsl(var(...))` consumers.

## Shell

### AppLayout

- Sidebar tightened to 56 (was 60), added a neutral "mark" logo square.
- Active nav item uses `bg-accent` + `font-medium` instead of `bg-muted`
  with violet ring.
- Theme toggle now labeled "Theme" to match Cal.com's Settings behavior.

### Landing (`/`)

- Dropped the large violet `IconCalendarTime` and marketing copy.
- Replaced with a minimal "Go to dashboard" shim (matches Cal.com's
  behavior for logged-in users arriving at `/`).
- No brand color used anywhere on this screen.

## Dashboard pages

### `/event-types` (list)

**Before:** sparse list, one line per item, 2 icon buttons (copy + menu).

**After:**

- Personal events grouped under `IconUser` + email heading; team events
  under `IconUsersGroup` (when present).
- Each row now shows title, slug URL, description (2-line clamp),
  scheduling-type badge, duration chips (from `durations[]` JSON), and a
  "Hidden" badge when `hidden=true`.
- Row-hover actions: **Switch** (show/hide inline — toggles
  `toggle-event-type-hidden`), **copy link**, **preview**, and a
  `DropdownMenu` with Edit / Duplicate / Embed / Delete.
- Delete flows through `AlertDialog` (no browser `confirm`).
- Create dialog adds a URL-prefix adornment (`/ownerEmail/…`), optional
  description, and matches Cal.com's field order + copy.
- Empty state uses a circular muted chip + headline + CTA (Cal.com-style).

### `/event-types/:id` (editor)

**Before:** flat list of inputs, 2 or 3 fields per tab, plain text hint.

**After:** two-column layout `[tabs content][sticky preview]`, with six
tabs (Setup · Availability · Limits · Advanced · Apps · Workflows). Each
tab's content is grouped in shadcn `Card`s with titles + descriptions.

- **Setup** — title, URL slug (with prefix adornment), markdown-hinted
  description, multi-duration chip editor, location dropdown (8 kinds —
  Cal Video / Google Meet / Zoom / Teams / Phone / In-Person / Attendee
  phone / Custom link).
- **Availability** — schedule dropdown + "Override availability for this
  event" scaffold (Cal.com parity).
- **Limits** — buffers, minimum notice, slot interval, booking-window
  selector supporting rolling-days OR specific date range (radio by
  dropdown).
- **Advanced** — custom event name template (`{attendee}` `{host}`),
  success redirect URL, 5 switches (requires confirmation / disable
  guests / hide notes / lock timezone / hide from profile), **private
  links** section with Generate → list w/ copy + revoke per link, and
  seat-per-slot toggle.
- **Apps** — 8-card grid with icon + name + description + selected state.
- **Workflows** — link to `/workflows`, empty state.
- Auto-save on blur/change with a "Saving…/Saved" text indicator in the
  header.
- Sticky right rail — a **live preview card** with the slug URL,
  duration chips, location pill, and external-link button.

### `/bookings/:status`

**Before:** simple list, no grouping, single status badge.

**After:** Cal.com-parity row density

- Pill-tab nav: Upcoming · Unconfirmed · Recurring · Past · Canceled
  (uses `bg-muted`/`bg-background` like Cal.com's segmented control).
- Top-right **search box** with live filter across title + attendee
  name/email.
- Bookings grouped under **sticky date headers** (`Today` / `Tomorrow` /
  `Yesterday` / `Friday, Apr 20`).
- Each row: start–end time (left column), title + status badge,
  attendee avatar + names, date, timezone, location icon, description
  snippet.
- Row-hover action bar: `Copy link` (when a meeting URL exists),
  `Reschedule`, and a `DropdownMenu` with View details / Mark as no-show
  / Cancel booking (destructive AlertDialog).
- Past + cancelled tabs render in reverse chronological order.
- Empty state varies by tab label.

### `/availability`

**Before:** just a list of names + default badge.

**After:**

- Each row shows the schedule name, a compact week-summary
  (`S M T W T F s` — lowercase = day off), timezone, and default-star badge.
- Per-row `DropdownMenu` with Edit / Set as default / Delete (AlertDialog
  under the hood for delete).
- Create dialog with placeholder text + timezone field.
- Empty state with circular chip + CTA.

### `/availability/:id` (editor)

**Before:** weekly grid + Save button, no date overrides, no timezone
input, no copy-to.

**After:**

- **Inline-editable name** as the page title (`shadow-none`, focus
  highlight via `bg-muted/40`).
- **Auto-save** — 600 ms debounce after any field touches; "Saving…" /
  "Saved" label in header.
- **Set as default** toggle in header (Cal.com parity).
- Per-day row: Switch · day label · list of time intervals · add-interval
  button · **Copy times to…** popover (Cal.com's killer UX — checkbox
  list of other days, Apply / Cancel).
- Right rail:
  - **Timezone** input with hint.
  - **Date overrides** panel with a Calendar popover to pick a date,
    then a list of override rows (toggleable, removable, per-interval
    time editor).

### `/settings/my-account/profile`

**Before:** flat form w/ color pickers.

**After:**

- Two-column layout: left settings nav (My Account + Developer groups,
  shadcn active state) / right content area.
- Each setting row is the Cal.com 2-column pattern: label + description
  on the left, input on the right.
- Avatar preview + Upload button.
- Username with `yourdomain.com/` prefix adornment.
- Timezone text, 12/24-hour select, week-start-day select, language
  select.
- Update button pinned to footer.

### `/apps`

**Before:** 4 hard-coded cards.

**After:**

- **Category pill tabs** at top: All / Calendars / Conferencing /
  Payments / CRM / Messaging.
- Search box.
- 10-app grid: Google Calendar / Outlook / Apple Calendar / Cal Video /
  Google Meet / Zoom / Teams / Stripe / HubSpot / Slack. Each card:
  icon chip · name · tagline · Install / Manage / Coming-soon button ·
  category label.
- Installed-badge support.

### `/workflows`

**Before:** simple list, single "Active" badge.

**After:**

- Per-row: name, trigger pill, step-count badge, "Active on N event
  types" meta.
- Switch to enable/disable each workflow inline.
- DropdownMenu with Edit / Duplicate / Delete (destructive).
- Empty state with circular chip + CTA.
- Create dialog copies Cal.com's "Add a new workflow" flow.

### `/routing-forms`

**Before:** simple list, single badge.

**After:**

- Per-row: name, field-count badge, disabled badge, description snippet,
  public URL `/forms/:id`.
- Per-row icons: copy link / external preview / DropdownMenu (Edit /
  Delete).
- Empty state with circular chip + CTA.

## Public-facing pages

### `/:user` (public profile)

**Before:** just a list of event types, no bio, no avatar.

**After:**

- Avatar circle (initials fallback) + display name + email subtitle.
- Each event type rendered as a richer card: title, description clamp,
  duration badge, location badge.
- Hover reveals a subtle border accent.
- Footer: "Powered by Scheduling".

### `/:user/:slug` (public Booker)

**Before:** host info, month calendar, and slot column stacked or
grid-swapped on selection; mostly single-column feel.

**After:** Cal.com's three-column card layout

- **Left column** (always shown on ≥ md): Avatar, host name, event-type
  title, description clamp, meta rows (duration, location, timezone).
- **Middle column**: Month header ("April 2026") + TZ select in the
  top-right, full month grid with availability dots under each open
  day, hover + selected states, subtle `Next available` quick-jump
  link when nothing is picked yet.
- **Right column (slides in when a date is picked)**: `framer-motion`
  `x: 24 → 0` animation. Shows "Thu 18 · Apr 2026", slot count, 12/24
  toggle, list of slot buttons.
- When form stage: left col collapses to "selected slot summary" card;
  middle expands.
- Success stage: icon check animated, inline card with add-to-calendar
  buttons (Google / Outlook / iCal).
- Footer: "Powered by Scheduling".
- Per-event-type `eventType.color` (hex) is converted to HSL
  components at runtime and applied via `--brand-accent`, affecting
  only: slot-button hover, selected calendar day, availability dot,
  success check. All other colors remain in the shadcn monochrome
  palette.

### `/booking/:uid`

**Before:** small success card with Join meeting button + attendee list.

**After:** a polished "You're booked" card

- Animated success-circle with accent check.
- Three sections: What / When / Who with icons (`IconCalendar`,
  `IconClock`, `IconGlobe`).
- Attendee list with avatar + email.
- Join meeting CTA (accent) and Reschedule / Cancel sub-actions.
- Footer "Powered by Scheduling".

## Accessibility & mobile

- All dropdowns and dialogs are shadcn primitives (no custom absolute
  positioning).
- Destructive actions route through `AlertDialog` (no
  `window.confirm`).
- Pill tabs use `bg-muted` container for segmented-control feel.
- Copy-times-to uses `Popover` + `Checkbox`.
- All responsive grid breakpoints verified at ≥ 640 / ≥ 768 / ≥ 1024.
- Dark mode parity is inherited from shadcn tokens — no component
  hardcodes a light-only color.

## Not rebuilt / known gaps

- `/workflows/:id` — editor for trigger + steps is not yet rebuilt
  (route doesn't exist). Todo.
- `/routing-forms/:id` — fields + rules editor not yet rebuilt.
- `/event-types/:id` Availability tab — per-event availability override
  is scaffolded but `add-event-type-override` action wiring TBD.
- Command palette (`⌘K`) and shortcut overlay (`?`) — not added.
- Keyboard shortcuts (`J/K` list nav, `E/D` archive) — not added.

## Test coverage

All 14 cases from `TEST_RESULTS.md` pass; typecheck is clean
(`pnpm typecheck` → 0 errors).
