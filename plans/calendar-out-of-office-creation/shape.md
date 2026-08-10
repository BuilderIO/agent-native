# Make out-of-office creation feel date-first

## Answer

Agent Native Calendar should treat **Out of office** as a status-setting workflow, not as a generic meeting with a special type. Keep the event-type choice that worked, then switch the form into a compact out-of-office mode:

1. Default the title to `Out of office`; do not require the user to name it.
2. Default to a full-day date or date range, with an optional `Specific hours` control.
3. Translate a full-day choice into the midnight-to-midnight timed event required by Google's API.
4. Default automatic declines and the decline message to the provider-compatible out-of-office behavior, with those settings progressively disclosed.
5. Hide meeting-only fields such as attendees, video, Find a Time, and location until the user asks for more options.

The important distinction is semantic: the user can truthfully choose “all day” even though the provider payload must use `dateTime` rather than `date`.

## Evidence

### The observed attempt

Rewind's retained local context shows Agent Native Calendar in the foreground from 10:50:27 to 10:51:38 EDT, a switch to Google Calendar by 10:51:48, and the Google event present at 10:52:18. Rewind did not retain clean frames for visual inspection, and its OCR over the forms was sparse, so this establishes the app sequence and timing window rather than exact pointer-level click counts.

The Google event inventory confirms that the event saved at 10:52:18 was:

- title: `Out of office`;
- type: `outOfOffice`;
- start: `2026-07-31T00:00:00-04:00`;
- end: `2026-08-01T00:00:00-04:00`;
- auto-decline: `declineAllConflictingInvitations`;
- decline message: `Declined because I am out of office`.

That event is technically timed, but it expresses one complete local calendar day. This is the translation Agent Native Calendar should perform on the user's behalf.

### The current Agent Native flow

The generic event form starts with an empty title and `allDay: false`, and classifies both out-of-office and focus-time events as timed-only ([CreateEventDialog.tsx](../../templates/calendar/app/components/calendar/CreateEventDialog.tsx#L240-L268)). Selecting out of office forcibly clears an all-day choice ([CreateEventDialog.tsx](../../templates/calendar/app/components/calendar/CreateEventDialog.tsx#L539-L545)), while submit rejects an empty title and sends the generic timing model unchanged ([CreateEventDialog.tsx](../../templates/calendar/app/components/calendar/CreateEventDialog.tsx#L632-L647), [CreateEventDialog.tsx](../../templates/calendar/app/components/calendar/CreateEventDialog.tsx#L675-L703)).

The same constraints exist beneath the UI: `create-event` requires title, start, and end ([create-event.ts](../../templates/calendar/actions/create-event.ts#L32-L50)), and the shared validator rejects `allDay: true` for out-of-office events ([event-action-helpers.ts](../../templates/calendar/actions/event-action-helpers.ts#L335-L346)). The Google adapter must serialize these status events with `dateTime`, because its `date` representation is driven by `allDay` ([google-calendar.ts](../../templates/calendar/server/lib/google-calendar.ts#L224-L238)).

There is also a semantic mismatch beyond the visible friction: Agent Native currently defaults out-of-office events to `declineNone` ([event-action-helpers.ts](../../templates/calendar/actions/event-action-helpers.ts#L270-L278)), while the event just created in Google declined all conflicting invitations.

### Google's contract

Google's Calendar API explicitly says out-of-office events cannot be `date`-based all-day events and must include timed start and end fields. Google's user guidance, however, tells people to select out-of-office dates and says specifying a time is optional. Those statements are compatible only if the product translates the human date-range choice into a timed provider payload. See [Google's status-event API guide](https://developers.google.com/workspace/calendar/api/guides/calendar-status) and [Google Workspace's out-of-office instructions](https://support.google.com/a/users/answer/9282964?hl=en).

## Inferences

- The primary failure is not bad validation copy. It is a leaked provider constraint: Agent Native asks the user to think in API fields rather than in days away.
- A generic event form remains useful for regular meetings, but status events need type-aware defaults and progressive disclosure.
- The event-type selector should remain. Alice explicitly found that part understandable, and replacing a working decision point would add motion without removing pain.
- “All day” should be presentation/input semantics for out-of-office, not a promise to send Google's `start.date` and `end.date` representation.

## Uncertainties

- Rewind did not preserve clean frames of either form, so exact control order and click count were corroborated through source code, timestamps, Alice's account, and the resulting Google event rather than frame-by-frame visual evidence.
- This pass did not test whether Google changes its default auto-decline mode by account policy. Implementation should preserve an explicit user choice and verify the default against the connected account rather than assuming one universal policy.
- Multi-day, recurrence, time-zone boundary, and daylight-saving transitions still need real provider acceptance tests.

## Recommendation

### P0 — remove the two dead ends

- When `eventType` changes to `outOfOffice`, set the effective title to `Out of office` unless the user already supplied a custom title.
- Replace the disabled all-day switch with an enabled, default-on full-day mode.
- For full-day mode, accept inclusive start and end dates in the UI, then normalize them in the shared action layer to local midnight at the first date through local midnight after the final date. Send `allDay: false` and explicit time-zone-aware `dateTime` values to Google.
- Keep specific-hours mode for partial-day absence.

This normalization belongs in the action/shared event helper, not only in the React form, so agent calls, drafts, and the UI share the same behavior.

### P1 — make it a status form

After selecting Out of office, the default form should contain only:

- date or date range;
- `All day` / `Specific hours`;
- calendar account when more than one is connected;
- Save.

Under `More options`, expose:

- editable title;
- automatic-decline mode;
- decline message;
- recurrence;
- visibility and reminders where supported.

Meeting-only controls should not occupy the main path.

### P1 — restore out-of-office meaning

Do not silently create an out-of-office status with `declineNone`. Match Google's ordinary out-of-office default or clearly show the auto-decline choice. Preserve the current default decline message unless the user edits it.

### P2 — add a faster entry seam

Keep the existing New event → type selector. In addition, clicking an all-day cell or date header can initialize the selected date and make Out of office a first-class type choice. The fast path should not require a separate bespoke API surface; it should prepare the same `create-event` action input.

## Frozen implementation shape

- **Outcome:** A person can mark one or more complete days out of office in Agent Native Calendar without entering a title or times, while Google receives a valid native out-of-office event.
- **Shipping surface:** `agent-native` repository → Calendar template event-creation UI and shared `create-event` action → public Calendar users → durable product behavior → ordinary integration by merge after review and acceptance.
- **Governing architecture:** The UI captures human status semantics; the shared action normalizes them into Google-compatible timed values; Google Calendar remains the source of truth.
- **Acceptance story:** From a chosen date, select Out of office and save without typing a title or time. The event appears in Agent Native and Google as `Out of office`, spans the intended complete local day or date range, has native `outOfOffice` behavior, uses the chosen auto-decline policy, and survives refresh. Specific-hours mode remains available. The same result is reachable through the action surface without UI-only normalization.
- **Required assertions:** single-day full-day; multi-day full-day; partial-day; title default and custom override; account and time-zone preservation; daylight-saving boundary; auto-decline and message fidelity; draft path; refresh/sync rendering; agent/action parity; no regression to focus time or working location.
- **Risk strategy:** system-ready. Do not merge and then discover whether Google's provider restrictions accept the normalization; verify against a connected primary calendar before integration.

## Sources

- Rewind local Screen Memory, 2026-07-26 10:50:27–10:52:18 EDT; sequence evidence only, with clean-frame coverage unavailable.
- Agent Native Calendar source files linked above.
- [Google Calendar API: manage status events](https://developers.google.com/workspace/calendar/api/guides/calendar-status)
- [Google Workspace Learning Center: show when you're out of office](https://support.google.com/a/users/answer/9282964?hl=en)
