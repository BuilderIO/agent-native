---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Connect Builder.io from browsers that refuse blank popups: when the host refuses the blank sign-in window, the connect flow opens its waiting page in the same click instead of reporting that popups are blocked. The app's own redirect to Builder no longer cuts off a popup that started on that page, which the app took for a closed window and reported as a failed setup 20 seconds into the sign-in.
