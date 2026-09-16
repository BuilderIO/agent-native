# Booking Host Working-Hours Status & Overlay Request Flow — Implementation Plan (rev. 2)

> **For the implementing agent:** Execute task-by-task. Each step is one action.
> Do not skip verification steps. Commit after each task.

**Goal:** In the Calendar template's booking-link editor, show a per-host status
icon telling the owner whether each host's _real working hours_ are actually
being used for that link, and give the owner a one-click path to fix it when
they aren't.

**Architecture:** A shared server helper (`getHostOverlayStatuses`) reports
reciprocity and schedule-presence as two independent booleans. Two new actions
expose it (`get-host-overlay-status`, read) and act on it
(`send-overlay-request`, write). A React component renders four visual states on
the host chip — three server-derived, one client-derived for manual hosts.
Sent-request timestamps persist in a user setting. The request email deep-links
the peer straight into the add-people dialog, prefilled.

**Tech stack:** TypeScript, `defineAction` (`@agent-native/core/action`), Drizzle,
`getUserSetting` / `mutateUserSetting`, `defineTransactionalEmail` + `renderEmail`,
`buildDeepLink`, React + shadcn/ui + Tabler Icons, `useActionQuery` /
`useActionMutation`, Vitest.

All paths below are relative to `templates/calendar/` unless noted.

---

## What changed from rev. 1

Four decisions were taken during review. Each one changes the task list, so they
are recorded here rather than left implicit:

| Decision                                                     | Effect                                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual raw-email hosts **do** get an indicator               | New client-derived fourth state (Task 9, 10). `getHostOverlayStatuses` keeps its overlay-list-only server contract.                                              |
| Manual hosts use a **muted** icon, not the red warning       | External hosts are a permanent, non-actionable condition; red would be permanent noise. Red stays reserved for the actionable "peer hasn't added you back" case. |
| Manual host popover offers **Add to my calendar**            | Wired to the existing `useAddOverlayPerson`. `send-overlay-request` must keep rejecting non-overlay emails — that guard is what stops arbitrary emailing.        |
| Email CTA deep-links to the **add-people dialog**, prefilled | New Task 6a: an `addPersonEmail` param on `navigate`, drained into `AppLayout`'s dialog state, plus a prefill prop on `PeopleTab`.                               |

**Why the deep link goes through `navigate` and not a route query param.**
`open-route.ts:250-253` serves the sign-in form _at the deep-link URL_ and
replays the navigation after login. The recipient of this email is a peer
clicking from their inbox — frequently signed out or in another browser profile.
A bare `/calendar/?addPerson=…` link loses its param across the auth redirect and
lands them on an empty calendar, which is the exact dead end this feature exists
to remove. The two existing query-param reads in this template
(`BookingLinksPage.tsx:836`, `event.tsx:172`) are both already-authenticated
in-app navigation and do not hit this.

---

## Background: the domain model you need before writing code

The Calendar template lets a user "overlay" a peer's calendar — stored in the
`calendar-overlay-people` user setting as `{ people: OverlayPerson[] }`.

For a booking link with multiple hosts, a host's **real working-hours schedule**
can only be used when the relationship is **two-way**:

1. The link owner has the host in _their_ `calendar-overlay-people`, **and**
2. the host has the owner in _their_ `calendar-overlay-people` (reciprocal), **and**
3. the host has actually saved a `calendar-availability.weeklySchedule` **and** a
   resolvable IANA time zone.

If any of those is missing, `getEligibleHostAvailability` degrades to
free/busy-only checking. Today that degradation is silent.

**Three server states, not two.** `reciprocal` and `hasWorkingHours` must stay
separate fields. "Peer hasn't added you back" and "peer added you back but hasn't
saved a schedule" need different copy, and only the first has a meaningful
action. Do not collapse them into one boolean.

**A fourth state lives on the client.** A manual raw-email host is not in the
owner's overlay list at all, so `getHostOverlayStatuses` returns no row for it —
correctly, because widening the server contract to report on arbitrary emails is
exactly the probing surface the identity rule below is designed to close. The
manual state is therefore derived in the component from the _absence_ of a
status row on a chip the client already knows is non-overlay
(`isOverlayHost(host)` in `BookingLinksPage.tsx`). It is never a server row.

**Identity rule (security-critical).** Both actions resolve the owner from the
booking link row's persisted `ownerEmail`, never from the signed-in caller,
because links are shareable with non-owner editors/viewers and the working-hours
relationship is always about the _owner's_ calendar. When the caller is not the
resolved owner, both actions additionally scope requested emails to that link's
own persisted host list, so a shared viewer cannot use these actions to probe the
owner's entire personal overlay list.

---

## Task 1: Extract the shared peer schedule/timezone resolver

**Files:**

- Modify: `server/lib/booking-host-availability.ts`

**Step 1.** Read the existing file in full. Note that
`getEligibleHostAvailability` currently inlines a `Promise.all` that reads the
peer's `calendar-availability` and `calendar-settings` settings, then falls back
to `getGoogleAccountTimezone`.

**Step 2.** Add a module-private helper above `getEligibleHostAvailability`:

```ts
/**
 * Resolves a peer's saved working-hours schedule and time zone, shared by
 * `getEligibleHostAvailability` and `getHostOverlayStatuses` so the
 * timezone-fallback order (calendar-availability, then calendar-settings,
 * then the peer's connected Google account) lives in one place.
 */
async function resolvePeerScheduleAndTimezone(email: string): Promise<{
  weeklySchedule?: AvailabilityConfig["weeklySchedule"];
  timezone?: string;
}> {
  const [config, calendarSettings] = await Promise.all([
    getUserSetting(
      email,
      "calendar-availability",
    ) as Promise<AvailabilityConfig | null>,
    getUserSetting(email, "calendar-settings") as Promise<{
      timezone?: string;
    } | null>,
  ]);
  const timezone =
    safeBookingTimeZone(config?.timezone) ||
    safeBookingTimeZone(calendarSettings?.timezone) ||
    (await getGoogleAccountTimezone(email)) ||
    undefined;

  // Without a resolvable time zone there's no correct zone to interpret
  // the schedule in — attaching it anyway would silently hard-filter using
  // the owner's zone instead of the peer's. Fall back to free/busy-only
  // (schedule omitted) rather than guess.
  if (!config?.weeklySchedule || !timezone) {
    return { timezone };
  }
  return { weeklySchedule: config.weeklySchedule, timezone };
}
```

**Step 3.** Replace the inlined body of `getEligibleHostAvailability`'s
`Promise.all` map with:

```ts
const { weeklySchedule, timezone } =
  await resolvePeerScheduleAndTimezone(email);
return weeklySchedule
  ? { email, weeklySchedule, timezone }
  : { email, timezone };
```

**Step 4. Verify.** `pnpm vitest run templates/calendar/server/lib/booking-host-availability.spec.ts`
— the pre-existing `getEligibleHostAvailability` and `withHostTimezones` suites
must still pass unchanged. This task is a pure refactor; if any assertion
changes, you have altered behavior.

**Step 5. Commit.** `refactor(calendar): extract shared peer schedule/timezone resolver`

---

## Task 2: Add `getHostOverlayStatuses`

**Files:**

- Modify: `server/lib/booking-host-availability.ts`

**Step 1.** Export the status interface next to `EligibleHostAvailability`:

```ts
export interface HostOverlayStatus {
  email: string;
  isOverlaidByOwner: boolean;
  reciprocal: boolean;
  hasWorkingHours: boolean;
  timezone?: string;
  displayName?: string;
}
```

Document _why_ `reciprocal` and `hasWorkingHours` are separate in the doc comment.

**Step 2.** Add `getHostOverlayStatuses(ownerEmail, hostEmails)`. Order of
operations matters:

1. Return `[]` early when `!ownerEmail` or `hostEmails.length === 0`.
2. Read the owner's `calendar-overlay-people`; build a
   `Map<lowercasedEmail, OverlayPerson>`. Return `[]` when the map is empty.
3. Build `candidateEmails`: lowercase, dedupe via `Set`, drop the owner's own
   address, and **drop anything not in the owner's overlay map**. This filter is
   the function's contract — it is not a way to probe arbitrary emails.
4. Return `[]` when no candidates remain.
5. `Promise.all` over `overlaysBack(email, owner)` (the existing helper) to get
   reciprocity per candidate.
6. For each candidate: pull `displayName` from the overlay map. If not
   reciprocal, return `{ email, isOverlaidByOwner: true, reciprocal: false,
hasWorkingHours: false, displayName }` and **skip the schedule read entirely**
   — there is nothing to resolve and it saves two settings reads plus a possible
   Google API round-trip per host. If reciprocal, call
   `resolvePeerScheduleAndTimezone` and set
   `hasWorkingHours: Boolean(weeklySchedule && timezone)`.

**Step 3.** Add a `describe("getHostOverlayStatuses")` block to
`server/lib/booking-host-availability.spec.ts` mirroring the existing suite's
mocking style. Seven cases:

- returns nothing when the owner has no overlay people
- drops candidates not in the owner overlay list
- reports not-reciprocal for an overlaid host who has not added the owner back
- reports reciprocal but no working hours when the peer has not saved a schedule
- reports reciprocal _and_ working hours when peer has schedule + timezone
- never reports the owner as their own host
- **does not read peer schedule settings at all for a non-reciprocal host**
  (assert the `getUserSetting` mock was not called with `calendar-availability`
  for that email — this is the step-6 short-circuit, and without a test it will
  be refactored away)

**Step 4. Verify.** `pnpm vitest run templates/calendar/server/lib/booking-host-availability.spec.ts`
— all suites green, new block included.

**Step 5. Commit.** `feat(calendar): add getHostOverlayStatuses helper`

---

## Task 3: Add the shared result types

**Files:**

- Modify: `shared/api.ts`

**Step 1.** After the existing `BookingHost` interface, add:

```ts
export interface HostOverlayStatusResult {
  email: string;
  reciprocal: boolean;
  hasWorkingHours: boolean;
  timezone?: string;
  displayName?: string;
  /** ISO timestamp of the last overlay-access request sent to this host. */
  requestSentAt?: string;
}

export interface SendOverlayRequestResult {
  email: string;
  requestSentAt: string | null;
  emailSent: boolean;
  skippedReason?: "email-not-configured";
}
```

Note `HostOverlayStatusResult` deliberately omits `isOverlaidByOwner` — the
action strips it, since by construction every returned row is overlaid by the
owner and shipping it to the client would only invite a redundant client check.

`requestSentAt: string | null` on the send result is intentional: `null` means
"nothing was sent and nothing was recorded" and must remain distinguishable from
a real timestamp. Do not default it to a timestamp.

There is deliberately **no** shared type for the manual-host state. It is not a
server row (see Background); the component derives it.

**Step 2. Verify.** `pnpm typecheck` — clean.

**Step 3. Commit.** `feat(calendar): add host overlay status shared types`

---

## Task 4: The overlay-request email

**Files:**

- Create: `server/lib/overlay-request-emails.ts`
- Create: `server/lib/overlay-request-emails.spec.ts`
- Modify: `server/lib/emails.ts`

**Step 1.** Create `overlay-request-emails.ts` exporting
`renderOverlayRequestEmail({ requesterName, requesterEmail, appLink })`.

Two non-obvious requirements:

- **CRLF stripping.** Run the requester name through a `stripCrlf` helper
  (`replace(/[\r\n]+/g, " ").trim()`) before it reaches the subject line, to
  prevent header injection.
- **HTML escaping.** `renderEmail`'s paragraph strings are interpolated into HTML
  **without escaping** (see `packages/core/src/server/email-template.ts`). The
  requester name is user-editable, so it must be wrapped in `emailStrong` — which
  escapes — before it reaches a paragraph. This matches `booking-emails.ts`'s
  handling of attendee names. Leave a comment saying so; it is exactly the kind
  of trap a future edit reintroduces.

Fall back to the stripped email when the name is empty. Return
`{ subject, ...renderEmail({ preheader, heading, paragraphs, cta, footer }) }`
with a `cta` pointing at `appLink` and a footer explaining why the peer received
it.

The CTA label must describe the destination it now actually has — the peer lands
on the add-people dialog prefilled with the requester, not on a generic calendar.

**Step 2.** Create the spec with three cases: escapes a malicious requester name
before it reaches the HTML; includes the name, CTA link, and the working-hours
ask; falls back to the requester email when no name is provided.

**Step 3.** In `emails.ts`: import `renderOverlayRequestEmail`, add
`SAMPLE_APP_LINK`, export
`CALENDAR_OVERLAY_REQUEST_EMAIL_ID = "calendar.overlay-request"`, and register a
`defineTransactionalEmail` inside `registerCalendarEmails()`. The `trigger`,
`recipient`, and `sender` prose must state the real conditions (in the
requester's overlay list, not reciprocal, cooldown + daily cap; reply-to the
requester). Use obviously-fake sample data in `preview` — it renders in a preview
pane and never sends.

**Step 4. Verify.** `pnpm vitest run templates/calendar/server/lib/overlay-request-emails.spec.ts`
— 3 passing. Then open the app's transactional email preview surface and confirm
the new template renders.

**Step 5. Commit.** `feat(calendar): add overlay access request email`

---

## Task 5: The `get-host-overlay-status` action

**Files:**

- Create: `actions/get-host-overlay-status.ts`
- Create: `actions/get-host-overlay-status.spec.ts`

**Step 1.** `defineAction` with `http: { method: "GET" }` and schema
`{ emails: string[], bookingLinkId?: string }`. The description should say what
the _user_ gets ("check whether each booking-link host's real working hours are
being used, vs. free/busy-only"), not restate the parameters. Mark
`bookingLinkId` as omitted "only for a brand-new, unsaved draft."

Cap `emails` with `.max(50)` in the zod schema. Each entry costs up to three
settings reads and a Google API round-trip; an uncapped array is a cheap
amplification vector even for an authorized caller.

**Step 2.** Implement `run`:

1. `getRequestUserEmail()`; throw `"no authenticated user"` when absent.
2. Default `ownerEmail = callerEmail`; `let linkHostEmails: string[] | null = null`.
3. When `bookingLinkId` is given: `await assertAccess("booking-link", id, "editor")`
   — **not `"viewer"`**; see the note below. Then select
   `{ ownerEmail, hosts }` from `schema.bookingLinks`. Throw
   `"Booking link not found"` on a missing row. Set `ownerEmail` from the row. If
   the row owner differs from the caller (case-insensitive), set
   `linkHostEmails = getBookingLinkCoHostEmails(row)`.
4. Normalize + dedupe `args.emails` through the existing
   `normalizeBookingHostEmail`, dropping nulls.
5. When `linkHostEmails` is set, filter the requested emails down to it.
6. Call `getHostOverlayStatuses(ownerEmail, scopedEmails)`.
7. Read the owner's `calendar-overlay-requests` setting
   (`Record<string, string>`), and return each status with
   `isOverlaidByOwner` destructured away and `requestSentAt: requests?.[email]`
   attached.

> **Why `"editor"` and not `"viewer"` on a read action.**
> `booking-link` is registered in `server/db/index.ts:9-16` with no
> `allowPublic: false` and no `publicAccessRole`. Per `access.ts:559-565`, a
> resource with `visibility === "public"` therefore resolves to **`viewer` for
> any caller** — and `visibility: "public"` is the normal, intended state for a
> bookable link. So `"viewer"` is effectively "anyone with the link id".
>
> `getRequestUserEmail()` in step 1 blocks anonymous callers, but that still
> leaves every signed-in Calendar user able to call this against any public
> link. The `linkHostEmails` scope means they cannot dump the host list, but
> they _can_ confirm one guessed address at a time and receive that host's
> `displayName`, `timezone`, and `requestSentAt` — a confirmation oracle over
> the owner's private overlay relationships.
>
> That is the same data `withHostTimezones` goes out of its way to strip from
> the public booking response ("it carries every required host's raw email,
> which the public JSON must never expose"). Granting it back through a
> `"viewer"`-gated action would undo that deliberately. This status is only ever
> rendered in the editor, so `"editor"` costs nothing and closes the hole.

**Step 3.** Spec — eight cases: uses the caller as owner for a new unsaved draft;
resolves the owner from the row rather than the caller when `bookingLinkId` is
given; scopes requested emails to the link's own hosts for a non-owner caller;
does **not** scope when the caller _is_ the owner; attaches `requestSentAt` from
the setting; throws when the link is not found; **rejects an `emails` array over
the cap**; **rejects a signed-in caller who has only public `viewer` access to a
public-visibility link**.

**Step 4. Verify.** `pnpm vitest run templates/calendar/actions/get-host-overlay-status.spec.ts`
— 8 passing.

**Step 5. Commit.** `feat(calendar): add get-host-overlay-status action`

---

## Task 6: The `send-overlay-request` action

**Files:**

- Create: `actions/send-overlay-request.ts`
- Create: `actions/send-overlay-request.spec.ts`

**Step 1.** Module constants:

```ts
const OVERLAY_REQUESTS_SETTING_KEY = "calendar-overlay-requests";
const COOLDOWN_MS = 60 * 60 * 1000;
const DAILY_CAP = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
```

`defineAction` with `http: { method: "POST" }`, schema
`{ email: z.string().email(), bookingLinkId?: string }`. The description must
state both guardrails: only works for a peer already in the owner's
`calendar-overlay-people`, and is rate-limited per peer and per day.

**Step 2.** Implement `run` in this order — each check exists for a reason and
reordering weakens one of them:

1. Resolve caller; throw when unauthenticated.
2. When `bookingLinkId` is given: `assertAccess(..., "editor")` — this is a
   mutating action, so it takes the same bar as `update-booking-link`, unlike the
   read action's `"viewer"`. Load the row, resolve `ownerEmail` from it, and
   compute `linkHostEmails` for a non-owner caller exactly as in Task 5.
3. Normalize `args.email`; throw `"Invalid email"` on null. When `linkHostEmails`
   is set and does not include it, throw
   `"This email is not a host on this booking link"`.
4. Read the owner's `calendar-overlay-people`; throw
   `"This email is not in the owner's calendar overlay list"` when the peer is
   absent. **Never send to an arbitrary address.**
5. Read the owner's `calendar-overlay-requests`. If a timestamp exists for this
   peer and `now - sentAt < COOLDOWN_MS`, return
   `{ email, requestSentAt: existingSentAt, emailSent: false }` — idempotent, so
   a double-click or a second tab gets the existing timestamp instead of a second
   email.
6. Count timestamps across _all_ peers within `DAY_MS`; throw
   `"Too many calendar-access requests sent today. Try again tomorrow."` at
   `>= DAILY_CAP`. The per-peer cooldown alone does not stop someone adding many
   peers and sending each exactly one request — this cap is what does. Note the
   cap is keyed to the **owner**, so a shared editor spends the owner's quota;
   that is intended (the emails are sent on the owner's behalf and reply to them)
   and must be stated in the skill doc.
7. When `!(await isEmailConfigured())`, return
   `{ email, requestSentAt: null, emailSent: false, skippedReason: "email-not-configured" }`.
   **Do not** record a timestamp and do not return a fake success — the UI shows
   a distinct message for this, and coercing it to success is precisely the
   silent-failure pattern this repo bans.
8. Build the deep link with
   `toAbsoluteOpenUrl(buildDeepLink({ app: "calendar", view: "calendar", params: { addPersonEmail: ownerEmail } }), getAppProductionUrl())`.
   The param is the **owner**, not the peer: the peer is the recipient and is
   being asked to add the owner back.
9. `sendEmail({ to: peerEmail, ...renderOverlayRequestEmail({...}), replyTo: ownerEmail, templateId: CALENDAR_OVERLAY_REQUEST_EMAIL_ID })`.
   Derive `requesterName` via `displayNameFromIdentifier(undefined, ownerEmail)`.
10. Only after a successful send: `mutateUserSetting` to merge
    `{ [peerEmail]: nowIso }`. Use the functional updater form, not read-modify-write.
    In the same updater, **drop entries older than `DAY_MS`** — they can no longer
    affect the cooldown or the cap, and without this the setting grows without
    bound for an owner with many peers.
11. Return `{ email, requestSentAt: nowIso, emailSent: true }`.

**Step 3.** Spec — nine cases: rejects an email not in the owner's overlay list;
sends and records the timestamp on success; returns the existing timestamp
without resending inside the cooldown; rejects once the daily cap is reached;
reports `email-not-configured` explicitly instead of a fake success; resolves
owner identity from the row for a shared editor rather than the caller; rejects a
shared editor's request for an email not on this link's hosts; does not scope to
link hosts when the caller is the owner; **prunes entries older than a day when
recording a new one**.

**Step 4. Verify.** `pnpm vitest run templates/calendar/actions/send-overlay-request.spec.ts`
— 9 passing.

**Step 5. Commit.** `feat(calendar): add send-overlay-request action`

---

## Task 6a: Deep link into the add-people dialog

**Files:**

- Modify: `actions/navigate.ts`
- Modify: `app/components/layout/AppLayout.tsx`
- Modify: `app/components/calendar/AddCalendarDialog.tsx`
- Modify: `app/hooks/use-navigation-state.ts` (wherever `useNavigationState` drains the command)

**Step 1.** Add an optional `addPersonEmail` param to the `navigate` schema,
described for the agent as opening the add-people dialog prefilled with that
address. Include it in the existing "at least one of" guard and in the `parts`
summary. This also gives the agent a UI path it does not have today — "add Jordan
to my calendar" currently has no way to open this dialog.

**Step 2.** In `useNavigationState`, surface the drained `addPersonEmail` the same
way the existing navigate fields are surfaced.

**Step 3.** In `AppLayout`, when `addPersonEmail` arrives: set
`addCalendarDefaultTab` to `"people"`, set `addCalendarOpen` to `true`, and hold
the email in state passed down as a new `prefillPersonEmail` prop on
`<AddCalendarDialog>` (`AppLayout.tsx:387-397`). Clear it when the dialog closes,
so reopening the dialog manually does not resurrect a stale prefill.

**Step 4.** In `AddCalendarDialog`, thread `prefillPersonEmail` into `PeopleTab`
and use it as the initial `query` / `searchQuery`. Do **not** auto-add the person:
the peer must consciously confirm adding someone to their own calendar. Prefilling
the search is the whole ask; auto-adding on link-click would be a write triggered
by opening an email.

**Step 5. Verify.** `pnpm typecheck`. Then, signed out in a private window, open
`/_agent-native/open?app=calendar&view=calendar&addPersonEmail=<a-test-address>`
and confirm that after signing in the add-people dialog opens prefilled. That
signed-out replay is the entire reason this task exists; a signed-in-only check
proves nothing.

**Step 6. Commit.** `feat(calendar): deep-link into the add-people dialog`

---

## Task 7: Relative-time formatter

**Files:**

- Create: `app/lib/relative-time.ts`
- Create: `app/lib/relative-time.test.ts`

**Step 1.** Export `formatRelativeTimeFromNow(iso, now = Date.now())`. Walk a
descending `UNITS` table (year, month, day, hour, minute) of
`[Intl.RelativeTimeFormatUnit, ms]`, return
`new Intl.RelativeTimeFormat("en", { style: "long" }).format(-value, unit)` for
the first unit where `Math.floor(diffMs / unitMs) >= 1`, and `"just now"` below a
minute — not `"-0 minutes"`. Return `""` for a non-finite diff (unparseable
input) so an unreadable timestamp is visibly empty rather than a plausible-looking
"just now".

**Step 2.** Test file with four cases: under a minute → "just now"; minutes;
hours; days.

**Step 3. Verify.** `pnpm vitest run templates/calendar/app/lib/relative-time.test.ts`
— 4 passing.

**Step 4. Commit.** `feat(calendar): add relative time formatter`

---

## Task 8: Client hooks

**Files:**

- Create: `app/hooks/use-host-overlay-status.ts`

**Step 1.** Two exports, both thin wrappers — no `fetch`, no REST paths:

```ts
export function useHostOverlayStatus(
  emails: string[],
  bookingLinkId: string | undefined,
  enabled: boolean,
) {
  return useActionQuery<HostOverlayStatusResult[]>(
    "get-host-overlay-status",
    { emails, bookingLinkId },
    { enabled },
  );
}

export function useSendOverlayRequest() {
  return useActionMutation<
    SendOverlayRequestResult,
    { email: string; bookingLinkId?: string }
  >("send-overlay-request");
}
```

Document that `data` is `undefined` while loading _and_ on error, and that
callers must render no icon in that case rather than a guessed state — this is a
secondary indicator, not a blocking one.

**Step 2. Verify.** `pnpm typecheck` — clean.

**Step 3. Commit.** `feat(calendar): add host overlay status hooks`

---

## Task 9: The status icon component

**Files:**

- Create: `app/components/booking/HostOverlayStatusIcon.tsx`
- Modify: `app/global.css`

**Step 1. Add a `--success` theme token.** The status icon needs a green that is
not `--primary` and not `--destructive`, and the calendar theme has no such token
(`global.css` declares `--conference` as the only non-standard hue). Add
`--success` and `--success-foreground` to **both** the `:root` and `.dark`
blocks, alongside `--conference`, and expose them in the Tailwind theme the same
way `--conference` is.

Do **not** write `text-emerald-600 dark:text-emerald-400`. It slips past
`guard-no-raw-colors.mjs` only because `emerald` is absent from that guard's
literal-color list (`red|green|blue|gray|slate|zinc`) — the guard's stated
contract is that every color themes through an HSL custom property, and a
hand-tuned dark-mode variant on a Tailwind palette color is the exact
whack-a-mole the guard's header describes.

**Step 2.** Props: `{ status?: HostOverlayStatusResult; variant: "overlay" |
"manual"; email: string; bookingLinkId?: string; mutation:
ReturnType<typeof useSendOverlayRequest>; addPerson: ReturnType<typeof
useAddOverlayPerson> }`. Both mutations are passed in from the parent, not
created here, so one shared mutation state covers all chips and per-chip pending
state is derived from the mutation's `variables`.

**Step 3.** Derive:

```ts
const name = status?.displayName || email;
const isThisPending = mutation.isPending && mutation.variables?.email === email;
const overrideResult =
  mutation.data?.email === email ? mutation.data : undefined;
```

**Step 4.** Branch on `variant` first, then on `reciprocal`, then on
`hasWorkingHours`:

- `variant === "manual"` → `IconInfoCircle`, `text-muted-foreground`, wrapped in
  a `Popover`: copy explaining that only free/busy is checked for a host who is
  not on the owner's calendar, plus an **Add to my calendar** button calling
  `addPerson`. This is deliberately _not_ a send-request button — the peer is not
  in the overlay list, and `send-overlay-request` rejects exactly that. Adding
  them flips the chip to the not-reciprocal state, which is where the real
  request button lives.
- `reciprocal && hasWorkingHours` → `IconCircleCheck`, `text-success`, `Tooltip`
  only, no action.
- `reciprocal` only → `IconInfoCircle`, `text-muted-foreground`, `Tooltip` only.
  **No send button** — there is nothing to request; the peer simply hasn't saved
  a schedule.
- otherwise → `IconAlertTriangle`, `text-destructive`, wrapped in a `Popover`
  with the warning copy, a status line, and a send button.

The manual and pending-schedule states share an icon but never appear on the same
chip (one is overlay, one is manual), so the shape collision is not ambiguous in
context. Colour is never the sole differentiator between two states that _can_
co-occur: the three overlay states use three distinct glyphs.

**Step 5.** In the popover, resolve the status line from the mutation result
first, then the server value:

```ts
const emailNotConfigured =
  overrideResult?.skippedReason === "email-not-configured";
const justSentThisSession = overrideResult?.emailSent === true;
const latestRequestSentAt =
  overrideResult?.requestSentAt ?? status?.requestSentAt ?? null;
```

Render, in priority order: the email-not-configured note (destructive, xs), else
"sent just now", else "Request sent {relative time}", else nothing. The button
label flips between `sendOverlayRequest` and `resendOverlayRequest` on
`latestRequestSentAt`, is `disabled` while `isThisPending`, and shows a `Spinner`.
On error, `toast.error(t("bookingLinks.overlayRequestFailed"))`.

**Step 6.** All icon buttons carry an `aria-label` built from the host email —
each of the four states has its own label key. All copy goes through `useT()`;
no raw string literals in the JSX. Icons are Tabler; controls are shadcn
(`Button`, `Popover`, `Tooltip`, `Spinner`) — do not hand-roll positioning.

**Step 7. Verify.** `pnpm typecheck` and `pnpm guard:no-raw-colors`, then the
browser check in Task 13.

**Step 8. Commit.** `feat(calendar): add host overlay status icon`

---

## Task 10: Wire it into `BookingLinksPage`

**Files:**

- Modify: `app/pages/BookingLinksPage.tsx`

**Step 1.** In `BookingHostsEditor` (line ~555), add props
`bookingLinkId: string | undefined` and `isNewDraft: boolean`.

**Step 2.** After the existing `calendarHosts` / `manualHosts` split (line ~639),
add:

```ts
const calendarHostEmails = useMemo(
  () => calendarHosts.map((host) => host.email).sort(),
  [calendarHosts],
);
const { data: hostStatuses } = useHostOverlayStatus(
  calendarHostEmails,
  bookingLinkId,
  // Never fire with an ambiguous identity: either this is genuinely a new
  // draft (no id yet, caller is the presumptive owner), or the real link
  // (and its bookingLinkId) has finished loading.
  calendarHostEmails.length > 0 && (isNewDraft || !!bookingLinkId),
);
const sendOverlayRequest = useSendOverlayRequest();
const addOverlayPerson = useAddOverlayPerson();
```

The `.sort()` is load-bearing: it keeps the query key stable when host order
changes, so reordering chips doesn't refetch.

**Step 3.** Change `renderHostBadge(host)` (line 641) to
`renderHostBadge(host, options: { overlay: boolean })`:

- When `options.overlay`: look up `status` from `hostStatuses` by normalized
  email and render `<HostOverlayStatusIcon variant="overlay" status={status} … />`
  only when `status` is truthy. A missing row here means loading, error, or a
  client/server disagreement about overlay membership — all three must render
  nothing rather than a guessed state.
- When `!options.overlay`: render
  `<HostOverlayStatusIcon variant="manual" email={host.email} … />`
  unconditionally. This state needs no server data.

The icon goes between the host label and the existing remove button.

**Step 4.** Update both call sites: `renderHostBadge(host, { overlay: true })` at
line 779, `{ overlay: false }` at line 809.

**Step 5.** In the `BookingLinksPage` body, near the existing
`canEditSelectedLink` derivations:

```ts
// An optimistic id is assigned client-side the moment a new link is
// created, before the route ever loads, so it is never ambiguous with an
// existing link that simply hasn't finished loading yet.
const isNewBookingLinkDraft =
  typeof selectedId === "string" && selectedId.startsWith(OPTIMISTIC_PREFIX);
const hostOverlayBookingLinkId =
  selectedLink && !selectedLink.id.startsWith(OPTIMISTIC_PREFIX)
    ? selectedLink.id
    : undefined;
```

Pass both into `<BookingHostsEditor>` (line 1667). `OPTIMISTIC_PREFIX` is already
imported in this file.

**Step 6.** Add the new imports (`HostOverlayStatusIcon`,
`use-host-overlay-status`, `useAddOverlayPerson`) in their existing sorted groups.

**Step 7. Verify.** `pnpm typecheck` — clean.

**Step 8. Commit.** `feat(calendar): show host working-hours status in booking editor`

---

## Task 11: Localization (all locales, same change)

**Files:**

- Modify: `app/i18n-data.ts`
- Modify: `app/i18n/zh-TW.ts`

**Step 1.** Add these 15 keys to the `bookingLinks` group of the `enUS` source
catalog in `app/i18n-data.ts`:

| Key                                    | English                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `workingHoursAppliedTooltip`           | `{{name}}'s working hours ({{timezone}}) are applied to this link.`                                                  |
| `workingHoursAppliedAriaLabel`         | `{{email}}'s working hours are applied`                                                                              |
| `workingHoursPendingScheduleTooltip`   | `{{name}} hasn't set up their working hours yet, so only their free/busy is checked.`                                |
| `workingHoursPendingScheduleAriaLabel` | `{{email}} hasn't set up their working hours yet`                                                                    |
| `workingHoursNotAppliedWarning`        | `{{name}} hasn't added you back to their calendar yet, so only their free/busy is checked, not their working hours.` |
| `workingHoursNotAppliedAriaLabel`      | `{{email}} hasn't added you back to their calendar`                                                                  |
| `workingHoursManualHost`               | `{{name}} isn't on your calendar, so only their free/busy is checked, not their working hours.`                      |
| `workingHoursManualHostAriaLabel`      | `{{email}} isn't on your calendar`                                                                                   |
| `addHostToMyCalendar`                  | `Add to my calendar`                                                                                                 |
| `sendOverlayRequest`                   | `Send request`                                                                                                       |
| `resendOverlayRequest`                 | `Resend request`                                                                                                     |
| `overlayRequestSentJustNow`            | `Request sent just now`                                                                                              |
| `overlayRequestSentAgo`                | `Request sent {{time}}`                                                                                              |
| `overlayRequestFailed`                 | `Failed to send request`                                                                                             |
| `overlayRequestEmailNotConfigured`     | `Email sending isn't set up yet`                                                                                     |

**Step 2.** Add the same keys to each locale block in the
`translatedBookingHostAvailability` override map: `es-ES`, `fr-FR`, `de-DE`,
`ja-JP`, `ko-KR`, `zh-CN`, `pt-BR`, `hi-IN`, `ar-SA` — 9 blocks.

**Step 3.** `zh-TW` lives in its own file, not in the override map. Add the same
keys to the `bookingLinks` group in `app/i18n/zh-TW.ts`.

**Step 4.** Preserve every `{{placeholder}}` name exactly in every locale — the
i18n guard checks placeholder parity, and a renamed placeholder renders as
literal text.

**Step 5.** The `navigate` action description added in Task 6a is agent-facing
tool copy, not UI copy, and is not catalogued.

**Step 6. Verify.** `pnpm guard:i18n-catalogs` and `pnpm guard:i18n-changed-copy`
— both exit 0. Do **not** add an `i18n-copy-ignore` marker; this is genuine
translatable copy.

**Step 7. Commit.** `feat(calendar): localize host working-hours status copy`

---

## Task 12: Skill documentation

**Files:**

- Modify: `.agents/skills/availability-booking/SKILL.md`

**Step 1.** After the existing time-zone-grid section and before the
"Management sharing is separate from public booking access" section, add a
`### Working-hours status and the "send request" flow` subsection covering:

- Which surface shows the icon (`BookingHostsEditor`) and which action/helper
  backs it.
- The **four** states, that only three come from the server, and **why** the
  manual state is client-derived rather than a server row (widening
  `getHostOverlayStatuses` past the overlay list would make it an email-probing
  oracle).
- Why `reciprocal` and `hasWorkingHours` are reported separately rather than
  collapsed.
- Why the manual state offers "Add to my calendar" and not "Send request", and
  that fixing a manual host is a two-hop process (add them, then request) that
  does not turn the chip green on its own.
- The identity rule: owner resolved from the persisted `ownerEmail`, not the
  caller, because links are shareable; only a brand-new unsaved draft uses the
  caller as presumptive owner; non-owner callers are additionally scoped to the
  link's own host list.
- That **both** actions require `"editor"`, and specifically that the read one
  must not be relaxed to `"viewer"`: `booking-link` allows public access, so
  `"viewer"` on a public-visibility link means any signed-in caller.
- The send guardrails: overlay-list-only, per-peer cooldown, per-**owner** daily
  cap (a shared editor spends the owner's quota), and _why the daily cap exists
  on top of the cooldown_.
- Where timestamps live (`calendar-overlay-requests`, `{ [peerEmailLower]:
isoTimestamp }`), that entries older than a day are pruned on write, and that
  `get-host-overlay-status` reads them back.
- That `navigate` now accepts `addPersonEmail`, and that it opens the dialog
  prefilled but never auto-adds.

Write the constraints, not a change narrative.

**Step 2. Verify.** Re-read it as someone with no context on this commit: could
they answer "why are there four states?", "whose calendar is this about?", and
"why can't a manual host send a request?" from the text alone?

**Step 3. Commit.** `docs: document booking host working-hours status flow`

---

## Task 13: End-to-end verification

**Step 1.** Full suite for the touched area:

```
pnpm vitest run templates/calendar
```

Expected: all pre-existing tests plus **31 new cases** — 8
(`get-host-overlay-status`) + 9 (`send-overlay-request`) + 7
(`getHostOverlayStatuses`) + 3 (`renderOverlayRequestEmail`) + 4
(`formatRelativeTimeFromNow`).

**Step 2.** `pnpm guards` — exit 0. It must print "All checks passed"; a SKIPPED
guard is a failure to investigate, not a pass.

**Step 3.** Browser check against the Calendar dev server. Tests do not prove the
feature works, so exercise all four states with two real accounts:

1. Owner adds peer A's calendar; A has **not** added the owner back → red
   `IconAlertTriangle` on A's chip. Open the popover, confirm the warning copy
   and a **Send request** button.
2. Click it. Confirm the button goes to a spinner, then the popover shows
   "Request sent just now" and the label becomes **Resend request**. Confirm the
   peer received the email and that reply-to is the owner. Click again
   immediately → no second email (cooldown), timestamp unchanged.
3. **Open the emailed CTA in a signed-out private window.** Confirm it serves the
   sign-in form at that URL, and that after signing in as peer A the add-people
   dialog opens prefilled with the owner's address and does _not_ auto-add.
   Confirm adding from there flips the owner's view.
4. Peer A adds the owner back but saves no working hours → muted
   `IconInfoCircle`, tooltip only, **no** send button.
5. Peer A saves a weekly schedule and time zone → `text-success`
   `IconCircleCheck`, tooltip naming the time zone.
6. Add a manual raw-email host → muted `IconInfoCircle`, popover with **Add to my
   calendar**. Click it; confirm the chip moves to the overlay group and becomes
   the red not-reciprocal state.
7. Open the link as a shared non-owner editor → status reflects the _owner's_
   relationships, not the editor's.
   7a. Sign in as an unrelated user with no share on the link, and call
   `get-host-overlay-status` against a **public-visibility** link id. Confirm it
   is rejected. This is the access-bar regression that a future "it's only a
   read" refactor would reintroduce.
8. Create a brand-new unsaved link, add an overlay host → status resolves against
   the caller as presumptive owner without a `bookingLinkId`.

**Step 4.** Unset email configuration and click Send request → the popover shows
"Email sending isn't set up yet" and **no** timestamp is recorded. This path is
the one most likely to regress into a fake success.

**Step 5.** Check every state in **dark mode**. The `--success` token is new and
untested in `.dark`, and a green that reads on white frequently does not.

**Step 6.** Report only what you actually observed, per state.

---

## Review checklist

- [ ] `reciprocal` and `hasWorkingHours` are never collapsed into one boolean.
- [ ] The manual state is client-derived; `getHostOverlayStatuses` still returns
      rows only for emails in the owner's overlay list.
- [ ] **Both** actions assert `"editor"` — `"viewer"` is public on a
      public-visibility booking link and would leak the owner's overlay peers.
- [ ] Both actions resolve `ownerEmail` from the booking-link row, never the caller.
- [ ] Non-owner callers are scoped to the link's own host list.
- [ ] `emails` is capped in the read action's schema.
- [ ] `send-overlay-request` rejects any email absent from the owner's overlay list.
- [ ] Cooldown returns the existing timestamp; daily cap throws; neither sends twice.
- [ ] `calendar-overlay-requests` prunes entries older than a day on write.
- [ ] `email-not-configured` returns `requestSentAt: null` and records nothing.
- [ ] Requester name is CRLF-stripped for the subject and `emailStrong`-escaped for the body.
- [ ] The deep link opens the add-people dialog prefilled and never auto-adds.
- [ ] The signed-out replay of the emailed CTA was actually exercised.
- [ ] No raw Tailwind palette colors; the green comes from a `--success` token
      declared in both `:root` and `.dark`.
- [ ] `calendarHostEmails` is sorted for a stable query key.
- [ ] The query is disabled while identity is ambiguous.
- [ ] All 15 keys exist in `en-US` plus all 10 non-English locales, placeholders intact.
- [ ] No new page title, subtitle, or description chrome was introduced.
- [ ] Every state checked in dark mode.
- [ ] `pnpm guards` prints "All checks passed".
