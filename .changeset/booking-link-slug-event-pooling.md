---
"@agent-native/scheduling": patch
---

Fix "Cannot read properties of null (reading 'value')" crash in `BookingLinkCreateDialog` when typing into the slug input. React nulls `e.currentTarget` once the synthetic event finishes synchronous propagation; reading it inside the `setForm` updater closure happened after that point. Capture the value before calling `setForm`.
