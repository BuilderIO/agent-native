---
"@agent-native/toolkit": patch
"@agent-native/core": patch
---

Show a tooltip on every icon in the collapsed app sidebar rail. Sidebar link components now forward refs and unknown props, so the tooltip triggers around nav links, nav groups, and the brand mark actually attach, and the compact org switcher uses the shared tooltip instead of a native `title`.
