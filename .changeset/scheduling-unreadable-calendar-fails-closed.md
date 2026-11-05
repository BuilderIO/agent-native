---
"@agent-native/scheduling": patch
---

Stop offering times when a selected calendar can't be checked. If a calendar's busy lookup fails, its provider isn't registered, or its credential needs reconnecting, availability and booking now fail with `CalendarAvailabilityUnavailableError` ("Couldn't check <calendar>") instead of treating that calendar as free. Google Calendar busy lookups also fail when Google reports an error for a calendar, and Outlook busy times are now read from each selected calendar instead of a lookup that never returned them.
