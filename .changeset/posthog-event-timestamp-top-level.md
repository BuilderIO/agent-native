---
"@agent-native/core": patch
---

Send each PostHog event's own time at the payload root instead of inside `properties`, where PostHog treated it as an ordinary custom property and stamped the event with its ingestion time. An agent run emits its trace, generation, and every tool span in one burst when the run ends, so a five-minute run rendered as a 100ms waterfall with its steps in flush order rather than the order they ran.
