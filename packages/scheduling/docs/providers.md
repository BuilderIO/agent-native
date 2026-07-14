# Writing a custom provider

Scheduling needs two kinds of providers:

- **CalendarProvider** — reads busy intervals + writes events.
- **VideoProvider** — creates meeting rooms when a booking is confirmed.

Built-ins: Google Calendar, Office 365, Zoom, Microsoft Teams, built-in video
(Daily.co), and Google Meet (piggy-backs on Google Calendar).

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

### Microsoft Teams

Teams uses delegated Microsoft OAuth for work or school accounts. Register the
provider with consumer-owned token storage and refresh callbacks:

```ts
import {
  createTeamsProvider,
  registerVideoProvider,
} from "@agent-native/scheduling/server/providers";

registerVideoProvider(
  createTeamsProvider({
    clientId: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    tenant: process.env.MICROSOFT_TENANT_ID,
    getAccessToken: resolveMicrosoftAccessToken,
    updateTokens: saveMicrosoftTokens,
    markInvalid: markSchedulingCredentialInvalid,
  }),
);
```

The provider requests `offline_access`, `OnlineMeetings.ReadWrite`, and
`User.Read`. Start the grant with `connect-video --kind teams_video` and finish
the callback with `completeVideoOAuth()`. `getAccessToken` must refresh expired
tokens; the package never reads a token store or environment directly.
