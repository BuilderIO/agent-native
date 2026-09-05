# Changelog

All notable user-facing changes to Agent-Native Calendar are documented here. Open it any
time from the command menu (Cmd+K → "What's new") or from Settings.

## 2026-09-03

### Improved

- Calendar now supports reliable batch event updates and booking cancellations.
- The agent now asks for your approval before it deletes events in bulk, emails your guests about a cancellation or change, or moves an event to another calendar.

## 2026-09-02

### Improved

- Creating an event with guests now uses Save while still sending invitations
- Updated the booking-link OG preview image with the new monochrome logo and dark background.

## 2026-09-01

### Added

- Calendars shared with your connected Google accounts can now appear alongside your primary calendars.

### Improved

- Calendar keeps the learn-more link clear of the language control on every screen size.
- Signed-in coworkers now see their own calendar conflicts and booking details are prefilled.

## 2026-08-31

### Improved

- Lower-contrast scrollbars keep desktop surfaces calm
- Per-app auth pages show a product preview and learn-more link

### Fixed

- Booking link availability aligns with its tabs
- Calendar no longer shows duplicate agent controls on Home and can remove saved Google Meet links

## 2026-08-29

### Improved

- Calendar now has a public marketing page with a direct path into the app.

## 2026-08-28

### Improved

- Event popovers match Notion Calendar's density: a 284px blurred panel with one 13px type scale, 30px rows, and compact attendee rows
- Sidebar branding matches the app text color with a tighter mark size.
- Event creators can choose whether a meeting shows as Free or Busy.
- Sidebar branding uses a monochrome Agent-Native mark.

### Fixed

- Calendar organizer-note emails now link back to Agent-Native Calendar on the event's local day
- Calendar shows Google profile photos in the desktop app
- Fixed Calendar navigation, scheduling permissions, action feedback, and event-note links.
- Google Calendar connections use the registered callback on mounted apps
- The Calendar sidebar keeps the settings link compact
- All-day events stay in the compact top bar in day and week views.
- The Calendar sidebar keeps the workspace picker compact

## 2026-08-27

### Fixed

- Public booking pages now pause availability when Google Calendar is disconnected or cannot be checked.

## 2026-08-24

### Improved

- Overlapping calendar events now use more of the available width while keeping same-time meetings readable.

## 2026-08-22

### Improved

- Google Calendar can now connect with the shared Google OAuth app in one click

### Fixed

- Booking link visibility controls now respect shared access and keep disabled links hidden when edited.
- Clicking an out-of-office event's marker no longer creates a new draft event at an unrelated time
- Opening an event's details now shows its time in your calendar timezone instead of the timezone it was originally created in.
- Overlapping events now split the available width so each one's edge stays visible instead of being covered by the event on top of it.
- Public booking pages now offer time slots from the host's weekly schedule even when the host hasn't connected Google Calendar

## 2026-08-19

### Improved

- Calendar pages stay fast after periods of inactivity.

### Fixed

- The calendar grid and settings load again for accounts whose saved timezone was stored in a format the calendar no longer understands

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

## 2026-08-11

### Improved

- Google Calendar connection buttons now open the sign-in flow directly

### Fixed

- Chrome no longer offers to install Calendar as a desktop app.

## 2026-08-10

### Fixed

- Opening availability settings from the agent lands on the availability editor

## 2026-08-06

### Added

- Existing events can move between connected Google account calendars

### Improved

- Long-running calendar requests now continue in the background instead of stopping at the foreground time limit.

## 2026-08-05

### Fixed

- Out-of-office blocks now open from their scheduled time range instead of creating a new event.

## 2026-08-03

### Fixed

- Booking-created events now include the calendar owner as the organizer.

## 2026-08-01

### Improved

- Language and appearance now sit together in one Preferences card in Settings

## 2026-07-31

### Improved

- The Agent-Native logo stays visible when the sidebar is collapsed and toggles the sidebar when clicked.

## 2026-07-29

### Improved

- Recent calendar locations now appear as address suggestions while creating an event.
- Sidebar footers now keep Feedback, Search, and Collapse together without a separate language shortcut.

### Fixed

- Unnamed events now show an empty title field with an “Add title” placeholder when you edit them.

## 2026-07-27

### Improved

- Calendar's sidebar now uses a cleaner layout with fewer utility controls and no divider lines

## 2026-07-26

### Improved

- Out-of-office events now default to full days with a ready-to-use title and automatic decline settings.

## 2026-07-25

### Improved

- App branding now uses the product name without the Agent-Native prefix.
- Settings navigation now keeps Manage agent as a dedicated linked destination at the bottom.

## 2026-07-24

### Improved

- Secondary controls and dashboard surfaces now use quieter borderless styling.
- Sidebar utility controls now follow a consistent footer order.

## 2026-07-23

### Improved

- Booking links now derive an overlay-listed host's time zone from their general calendar settings when they haven't set explicit working hours

## 2026-07-22

### Improved

- Manage agent navigation now uses the connected-nodes icon.

### Fixed

- Calendar views now render, navigate, and create events in the timezone selected in Calendar settings.

## 2026-07-21

### Added

- Group booking links can now enforce a peer's real working hours and time zone when they're in your calendar overlay, with an optional multi-time-zone grid on the public booking page.

## 2026-07-20

### Improved

- Events can be updated inline with date, time, timezone, and repeat controls.

### Fixed

- Public booking pages no longer show a theme-related hydration error on first load.

## 2026-07-17

### Fixed

- The agent chat sidebar stays closed until you open it or start a chat handoff.

## 2026-07-14

### Fixed

- Out-of-office blocks now sit behind meetings, and event stacking resets after closing details.

## 2026-07-13

### Added

- A full Agent page now brings context, files, connections, jobs, and external access together

### Improved

- Direct Calendar reads now show which connected sources were covered, including partial connection or feed failures.

### Fixed

- Booking links and previews now support opening in a new tab.
- Your local time now follows your browser timezone, and event details no longer show a redundant timezone row.

## 2026-07-12

### Improved

- Calendar responses can now be saved with Command+Enter or Ctrl+Enter, and delete confirmations focus the delete action for faster keyboard use.

## 2026-07-11

### Improved

- Event cards give subtle press feedback and smoother hover

### Fixed

- Booking links and bookings now show a clear retry action when they cannot be loaded.

## 2026-07-10

### Fixed

- Choose which connected Google account receives a new event, with updates and deletions staying on that calendar.
- Event guest details and option menus now use valid, accessible controls.
- Natural-language event phrases stay available as quick-create results in the command menu.

## 2026-07-09

### Improved

- Calendar events with guests now automatically get a Google Meet link when no video link is provided.

### Fixed

- New events now mark the creator's RSVP as Yes when guests are invited.

## 2026-07-08

### Added

- Event details now support extension widgets, and you can see each guest's local time next to their email when their timezone is known.

### Improved

- Settings are cleaner and searchable, with a consistent navigation that jumps straight to any setting.

### Fixed

- Clicking empty calendar space closes an open event popover before creating a new event.
- When you invite guests to a new event, you now appear in the Guests list the same way Google Calendar shows you as the organizer.

## 2026-07-07

### Added

- You can mark event guests as optional while inviting them or later from the guest list

### Fixed

- Guest suggestions now find coworkers from your Google Workspace directory as you type.
- Working locations now appear in a dedicated non-blocking lane and can be changed between Home, Office, and Other for one day or an entire recurring series.
- Zoom stays selected after connecting it from a draft event.

## 2026-07-06

### Added

- Create events from the command menu with natural phrases like 'lunch with Sam tomorrow 12:30'
- Drag across empty week or day slots to create an event with a live time-range preview

### Improved

- Calendar now loads view preferences much more efficiently
- Dragging and resizing events is much smoother, especially on busy weeks
- Public booking pages respond faster

### Fixed

- Connected calendars keep their own color when you customize them.
- Each connected Google account can now have its own calendar color
- Events spanning multiple days now show on every day they cover in month view
- Google Calendar now finishes connecting correctly after signing in through Agent-Native Desktop.

### Removed

- The app header no longer shows the global notifications bell.

## 2026-07-01

### Improved

- Meeting invite pages have cleaner branding, a black dark-mode backdrop, and a language picker.

### Fixed

- Booking links now show an error when calendar availability cannot be checked and use 30-minute start intervals.

## 2026-06-30

### Fixed

- Calendar now gives the agent a safe Google connection link instead of surfacing a raw auth error.
- Google Calendar connection errors now stay in the app instead of opening a blank sign-in window.

## 2026-06-29

### Fixed

- Event details and Find Time layouts now adapt cleanly when the agent sidebar narrows the app.

## 2026-06-28

### Improved

- The left sidebar now collapses into an animated icon rail with quieter footer controls.

## 2026-06-27

### Fixed

- Traditional Chinese copy now uses Taiwan terminology and clearer technical wording.

## 2026-06-25

### Improved

- Booking link previews now show the content directly on the grid background.

### Fixed

- Booking link copy buttons no longer fail when clipboard permissions are blocked.

## 2026-06-24

### Added

- Added a language picker and localized app chrome for supported languages.

### Improved

- Settings now link directly to Agent settings for model, API key, automation, and voice preferences.

For the full list of updates, see the [changelog folder](./changelog/).
