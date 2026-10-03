---
"@agent-native/core": minor
---

Report Core Web Vitals (TTFB, LCP, INP, CLS) once per page view as a `web_vitals` event keyed by React Router route template, mark them on session replays, and add the page's route template to `action.response`. Pages no manifest route matches send no route rather than a raw path, and a tab switch that measured nothing sends no page view. Session replay network events now carry `pageHidden: true` for requests made while the page was hidden. An `action.response` at or over `SLOW_ACTION_RESPONSE_MS` (1 s) that someone waited for (`isWaitedActionResponse`: the page stayed visible and the request wasn't cancelled) is also marked on the session replay as `agent-native.slow_request`, with its own duration, status, and outcome. Turn the capture off with `configureTracking({ webVitals: false })`.
