---
"@agent-native/core": patch
---

Let `ffmpeg-static` run its install script in generated projects, so the binary is actually downloaded and the deploy's ffmpeg bundling has something to copy. Also stop the workspace YAML merge from skipping an entry because its name appears in a different section.
