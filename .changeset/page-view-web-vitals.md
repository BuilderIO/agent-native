---
"@agent-native/core": minor
---

Report Core Web Vitals (TTFB, LCP, INP, CLS) once per page view as a `web_vitals` event keyed by route template, mark them on session replays, and add the page's route template to `action.response`. Turn the capture off with `configureTracking({ webVitals: false })`.
