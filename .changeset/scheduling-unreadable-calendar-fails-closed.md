---
"@agent-native/scheduling": patch
---

Stop offering times when a selected calendar can't be checked. If a calendar's busy lookup fails, its provider isn't registered, or its credential needs reconnecting, availability and booking now fail with `CalendarAvailabilityUnavailableError` ("Couldn't check <calendar>") instead of treating that calendar as free. Google Calendar and Outlook busy lookups also fail when the provider reports an error for a calendar.
