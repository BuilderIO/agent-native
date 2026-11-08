# Clips Desktop Dictation UX

This document defines the product behavior for desktop dictation. Keep its
interaction consistent with Clips recording and save flows while making spoken
text available quickly in the focused app.

## Interaction

- A configured shortcut starts capture; releasing it ends capture.
- Keep the recording indicator compact and visible above the current desktop
  app. Use the same color, type, spacing, and motion tokens as Clips recording.
- Show clear listening, processing, delivered, and recoverable-error states.
- With AI polish off, insert the transcript as soon as it is final. With
  polish on, show a cleanup step and insert the polished text; if polish fails
  or takes longer than 2.5 s, insert the raw transcript. Never wait for history
  persistence before delivering text.
- An engine that transcribes while the key is held (Parakeet) should have the
  text ready within 0.5 s of release. If its live pass fails, transcribe the
  whole recording instead of dropping it; a slower paste beats a lost one.
- Make cancellation explicit. A canceled or empty recording must not look like
  a successful insertion.

## Recovery

- If insertion fails after transcription, keep the transcript available in the
  flow bar and provide a one-step copy action.
- Confirm whether text was inserted or copied so the user knows where it went.
- Keep history retries attached to the same dictation record to avoid duplicate
  entries.
- Errors should preserve recoverable transcript text and offer a direct retry
  when the failed step can be safely repeated.

## Visual direction

- Treat the flow bar as part of the Clips desktop recording experience, not as
  a separate settings or onboarding surface.
- Keep the default surface compact. Use the existing overlay components,
  typography, colors, and motion patterns.
- Make processing and recovery states readable without adding a second dialog
  to the hold-and-release path.
