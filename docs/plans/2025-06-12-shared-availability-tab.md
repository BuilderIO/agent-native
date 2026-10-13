# Shared Availability Tab Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one action. Do not skip steps. Verify after each task.

**Goal:** Move peer-relationship management (the sidebar "People" group) into a new
"Shared availability" tab on the booking-links page, leaving the sidebar with only
grid controls (colour, show/hide) for those same peers.

**Architecture:** The overlay list (`calendar-overlay-people`) serves two jobs — it
renders peer events on the grid _and_ gates whether a booking-link co-host's real
working hours are used. Splitting the surfaces by job: the booking-links page owns
add/remove/reciprocity/request, the sidebar keeps colour + visibility only. No
server or data-model changes; both surfaces already read the same action.

**Tech Stack:** React, `useActionQuery`/`useActionMutation`, shadcn Tabs/Popover/Tooltip,
Tabler icons, existing `get-overlay-people` / `get-host-overlay-status` /
`send-overlay-request` actions.

## Task 1: Localization keys

**Files:** Modify `templates/calendar/app/i18n-data.ts`, `templates/calendar/app/i18n/zh-TW.ts`

New keys under `bookingLinks`:

- `sharedAvailability` — tab label
- `sharedAvailabilityDescription` — card description
- `sharedAvailabilityEmpty` — empty state
- `addPeerCalendar` — add button
- `workingHoursAppliedLabel` — short row label for the applied state
- `workingHoursPendingScheduleLabel` — short row label, reciprocal but no schedule
- `workingHoursNotAppliedLabel` — short row label, not reciprocal
- `removePeerConfirm` — confirm copy for removing a peer

New keys under `sidebar`:

- `managePeerAvailability` — link from the sidebar to the new tab

Remove now-unused `sidebar.peopleGroup`, `sidebar.overlayReciprocalTooltip`,
`sidebar.overlayReciprocalAriaLabel` only if nothing else references them.

**Verify:** `pnpm guards` i18n check passes.

## Task 2: `SharedAvailabilityPanel` component

**Files:** Create `templates/calendar/app/components/booking/SharedAvailabilityPanel.tsx`

- `useOverlayPeople()` for the list.
- `useHostOverlayStatus(emails, undefined, emails.length > 0)` — with no
  `bookingLinkId` the action resolves the owner to the caller, which is correct
  here because the tab only ever manages the signed-in user's own peers.
- One row per peer: name/email, short status label, `HostOverlayStatusIcon`
  (`variant="overlay"`, no `bookingLinkId`), remove button behind a confirm dialog.
- "Add a peer's calendar" opens the existing `AddCalendarDialog` with
  `defaultTab="people"` rather than duplicating the people picker.
- Empty state when the overlay list is empty.

**Verify:** renders in the browser with real peers; status icons match the
booking-link chips for the same people.

## Task 3: Fourth tab + URL deep link

**Files:** Modify `templates/calendar/app/pages/BookingLinksPage.tsx`

- Extend `type Tab` (line 247) with `"shared"`.
- Add `TabsTrigger`/`TabsContent` (lines 1874-1884, 2287-2289).
- Read `?tab=` on mount so the sidebar can deep-link to `?tab=shared`, and keep
  the param in sync on tab change.

**Verify:** `/calendar/booking-links?tab=shared` opens the new tab directly.

## Task 4: Demote the sidebar People rows

**Files:** Modify `templates/calendar/app/components/layout/Sidebar.tsx`

- Drop the `People` collapsible wrapper; render peer rows flat under
  "Other Calendars" alongside the Google rows.
- Keep the colour picker and the eye toggle.
- Remove the `X`/`removePerson` button — severing the booking relationship must
  not be a hover-target next to a plain hide toggle — and remove the reciprocity
  exchange icon, whose job the new tab now does.
- Point the section's people `+` at `/calendar/booking-links?tab=shared`.
- Add a "Manage shared availability" link under the peer rows.
- Drop `useOverlayReciprocity`/`useRemoveOverlayPerson` usage and the
  `peopleGroupOpen` state that only gated the reciprocity query.

**Verify:** no `People` sub-header; peers still toggle and recolour; group and
resource calendars unchanged.

## Task 5: Tests

**Files:** Create `templates/calendar/app/components/booking/SharedAvailabilityPanel.test.tsx`

Cover: empty state, one row per peer, status label per state, remove requires
confirmation, request button only on the non-reciprocal state.

**Verify:** `pnpm vitest run` in the template passes.

## Task 6: Full verification

- `npx vitest run` (calendar template)
- `npx tsc --noEmit -p tsconfig.json`
- `pnpm guards`
- Browser: sidebar has no People header, new tab lists peers with status,
  removing a peer asks for confirmation, deep link works.
