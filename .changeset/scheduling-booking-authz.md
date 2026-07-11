---
"@agent-native/scheduling": patch
---

Require host identity (or the booking's capability token) before mutating bookings, revoking private links, duplicating event types, and returning reschedule tokens, closing cross-tenant write/disclosure gaps.
