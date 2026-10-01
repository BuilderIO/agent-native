---
"@agent-native/core": patch
---

Poll every 2.5 s while another person is present on the same collaborative document and no realtime stream is connected (serverless), so their edits land in seconds instead of up to a minute. Lone tabs and tabs on a live stream or hosted gateway keep their existing cadence.
