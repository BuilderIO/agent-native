# Writing a custom provider

Scheduling needs two kinds of providers:

- **CalendarProvider** — reads busy intervals + writes events.
- **VideoProvider** — creates meeting rooms when a booking is confirmed.

Built-ins: Google Calendar, Office 365, Zoom, built-in video (Daily.co), Google
Meet (piggy-backs on Google Calendar).

## CalendarProvider

```ts
import { registerCalendarProvider } from "@agent-native/scheduling/server/providers";

registerCalendarProvider({
  kind: "my_calendar",
  label: "My Calendar",
  async startOAuth({ redirectUri, state }) {
    /* return { authUrl } */
  },
  async completeOAuth({ code, credentialId, userEmail, redirectUri }) {
    /* exchange code, persist tokens, return externalEmail + calendars */
  },
  async listCalendars({ credentialId }) {
    /* ... */
  },
  async getBusy({ credentialId, calendarExternalIds, start, end }) {
    /* ... */
  },
  async createEvent({
    credentialId,
    calendarExternalId,
    booking,
    includeConference,
  }) {
    /* ... */
  },
  async updateEvent({ credentialId, externalId, booking }) {
    /* ... */
  },
  async deleteEvent({ credentialId, externalId }) {
    /* ... */
  },
});
```

All methods receive a `credentialId` — use it to look up the OAuth token via
your token store. The package's `setSchedulingContext()` doesn't touch
tokens; consumers typically use core's `oauth_tokens` and pass a
`getAccessToken(credentialId)` callback.

## VideoProvider

```ts
registerVideoProvider({
  kind: "my_video",
  label: "My Video",
  async createMeeting({ credentialId, booking }) {
    return { meetingUrl, meetingId, meetingPassword? };
  },
  async deleteMeeting?({ credentialId, meetingId }) { /* ... */ },
});
```

Video providers are invoked by the booking service when a booking's location
is `builtin-video`, `zoom`, `google-meet`, or `teams`. Meeting URLs land in
`booking_references`.
