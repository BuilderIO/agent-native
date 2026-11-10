---
"@agent-native/core": patch
---

A healthy `/_agent-native/ping?configuration=1` report now has an empty `prompt` instead of a "Fix this Agent-Native deployment configuration issue" prompt with no issues in it. The "Create an App with an AI Agent" prompt now ends by reading that probe and running `pnpm action hello`, instead of only checking that the page answers `curl -I`.
