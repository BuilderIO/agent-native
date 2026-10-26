---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Long conversations stay responsive:

- The WebMCP polyfill's declarative-form scan, which walked every element on the page after each DOM change, now runs at most every 500 ms in idle time. Typing, scrolling and streaming no longer slow down as a transcript grows. Declarative form tools still register.
- Each streamed delta re-renders only the message it changed. Message rows read narrow slices of the thread through the new `useAgentThreadSelector` hook, and every subscriber of a controller is notified in one task per change instead of one task per subscriber.
- A long thread opens on its newest 20 rows and mounts older rows in idle chunks without moving the view. Collapsed work steps in a long thread mount in idle time, or as soon as they are opened. Every row is mounted within a few idle periods, so find-in-page reaches the whole history shortly after opening.
- Finished replies use `content-visibility: auto`, so the browser skips styling, layout and paint for replies that are off screen.
