---
"@agent-native/core": patch
---

Composer toolbar: drop the leading pencil/clipboard icon from the Act/Plan mode picker, and hide the reasoning-level suffix ("· Auto") when the chatfield is narrower than 370px so the model name + version stays fully readable instead of truncating. The reasoning level is still reachable via the model picker popover. Also alias `@agent-native/core/styles/agent-native.css` to source in dev so CSS edits take effect live instead of silently loading the stale built copy.
