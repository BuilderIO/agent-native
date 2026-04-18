# UI Unification — booking-link / event-type editor

As of 0.1.x the `@agent-native/scheduling` package ships a small set of
shared React components the `calendar` and `scheduling` templates both
consume so the two apps keep visual parity without duplicating logic.

Exported from `@agent-native/scheduling/react/components`:

| Component                 | Purpose                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ConferencingSelector`    | 2x2 grid of "No conferencing / Google Meet / Zoom / Custom link"; includes a "Connect Zoom" affordance that starts real OAuth |
| `SlugEditor`              | Inline-editable URL preview (`host/prefix/username/slug`) with click-to-edit segments                                         |
| `CustomFieldsEditor`      | Add / edit / reorder / remove custom booking-form fields, with presets (LinkedIn, Company, Phone, Website)                    |
| `DurationPicker`          | Multi-select pills (15 / 30 / 45 / 60 + custom) for per-event-type durations                                                  |
| `BookingLinkCreateDialog` | Modal prompting for Title / URL / Duration / Description when creating a new event type                                       |
| `AvailabilityEditor`      | Weekly schedule grid with toggles + start/end time pickers; `summarizeAvailability(ws)` helper for list subtitles             |

The existing `SlotPicker` and `TimezoneSelect` continue to live alongside
these.

## Shadcn primitives required in the consumer

Every component in this package imports shadcn primitives via the
standard `@/components/ui/*` alias (resolved by the consumer's bundler).
The package ships type shims for them in
`react/components/_shadcn-shims.d.ts` so it compiles cleanly on its own.

Add these to your template's `app/components/ui/` before importing any
of the shared components:

| Component required | Used by                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `button`           | ConferencingSelector, BookingLinkCreateDialog, DurationPicker                                         |
| `input`            | ConferencingSelector, CustomFieldsEditor, DurationPicker, BookingLinkCreateDialog, AvailabilityEditor |
| `label`            | ConferencingSelector, CustomFieldsEditor, SlugEditor, BookingLinkCreateDialog, AvailabilityEditor     |
| `textarea`         | CustomFieldsEditor, BookingLinkCreateDialog                                                           |
| `switch`           | CustomFieldsEditor, AvailabilityEditor                                                                |
| `badge`            | ConferencingSelector                                                                                  |
| `dialog`           | BookingLinkCreateDialog                                                                               |

Icons come from `@tabler/icons-react` (not bundled; each template already
depends on it).

## What moved where

| Old home (calendar template)             | New home                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `ConferencingEditor` in BookingLinksPage | `ConferencingSelector` in `@agent-native/scheduling/react/components` |
| `EditableBookingUrl` in BookingLinksPage | `SlugEditor` in the package                                           |
| `CustomFieldsEditor` in BookingLinksPage | `CustomFieldsEditor` in the package                                   |

| Old home (scheduling template)             | New home                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `DurationsEditor` in event-type editor     | `DurationPicker` in the package                                             |
| `LocationEditor` + `AppsGrid` (two places) | `ConferencingSelector` in the package (Apps tab removed — it was redundant) |
| Inline create dialog in `_index`           | `BookingLinkCreateDialog` in the package                                    |

## Zoom became real OAuth

Previously the calendar template's Zoom option asked the user to paste a
personal meeting URL. The scheduling template had no OAuth-based Zoom at
all (only the `zoom_video` "app install" placeholder).

Both now use real Zoom OAuth via the provider's new optional
`startOAuth` / `completeOAuth` methods on `VideoProvider`. Consumers:

- **Scheduling template** — calls the package's `connect-video` action
  for `zoom_video`, callback lands at
  `/_agent-native/oauth/zoom/callback.get.ts`, tokens stored via
  `completeVideoOAuth()`.
- **Calendar template** — ships a lightweight `server/lib/zoom.ts` that
  uses the package's `createZoomProvider` but stores tokens directly in
  core's `oauth_tokens` keyed by Zoom user id + owner email. The
  booking-create handler calls `createZoomMeeting()` when the booking
  link's conferencing type is `zoom`.

Both flows auto-refresh the Zoom access token when it's within 60s of
expiry and mark credentials invalid if Zoom returns 401/403.
