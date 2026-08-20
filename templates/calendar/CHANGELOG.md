# Changelog

All notable user-facing changes to Agent-Native Calendar are documented here. Open it any
time from the command menu (Cmd+K → "What's new") or from Settings.

Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What's new" view.

## 2026-08-19

### Improved

- Calendar pages stay fast after periods of inactivity.

## 2026-08-18

### Added

- The agent can now remove many meetings at once, such as every Saturday and Sunday meeting in a range, instead of failing partway through

### Fixed

- Calendar event time editing now respects the event's timezone.
- Calendar stays responsive in the desktop app without focus-triggered reloads

## 2026-08-17

### Fixed

- Booking links now respect each required host's saved availability

## 2026-08-14

### Fixed

- Choosing Office or Other when adding a working location creates that type, and adding one on a day that already has a location updates that day instead of extending Home.
- Creating an Other working location now keeps the custom name instead of saving it as Working.
- Timed working locations keep a Home, Office, or custom title instead of the generated Working location label.
- Timed working locations now keep a Home, Office, or custom title instead of showing as Untitled.
- Turning a timed working location that ends at midnight back to all-day no longer adds an extra day.

## 2026-08-13

### Added

- Working locations can be added from calendar days, with a full-day first entry and timed same-day additions

### Fixed

- The Find a time window now closes from a clear header action.

### Changed

- Calendar stays pinned to the saved timezone and asks before adopting a changed browser timezone
