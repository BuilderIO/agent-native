---
"@agent-native/scheduling": minor
---

Booking attendees keep the order they were added in through a new nullable `booking_attendees.position` column (add it in your app's migrations), and calendar and video providers can read credentials and account identity through workspace connections, including a Google Calendar workspace provider and calendar reminders.
