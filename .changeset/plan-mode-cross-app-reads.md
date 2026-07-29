---
"@agent-native/core": patch
---

Make generic public URL reads immediately available to agents and preserve
machine-readable alternate links when extracting page content, including in
Plan mode. Large extensions now default to bounded, targeted source excerpts so
focused edits do not stall a run by loading an entire generated app body.
