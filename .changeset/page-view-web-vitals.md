---
"@agent-native/core": minor
---

Report Core Web Vitals (TTFB, LCP, INP, CLS) once per page view as a `web_vitals` event keyed by React Router route template, mark them on session replays, and add the page's route template to `action.response`. Pages no manifest route matches send no route rather than a raw path, and a tab switch that measured nothing sends no page view. Session replay network events now carry `pageHidden: true` for requests made while the page was hidden. Turn the capture off with `configureTracking({ webVitals: false })`.
