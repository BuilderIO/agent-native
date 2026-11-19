---
"@agent-native/core": patch
---

New Builder starter apps now tell their coding agent to style with Tailwind utilities, or to write any custom CSS before or alongside the markup that uses it. The preview reloads on every file write, so an agent that wrote the page markup first and its stylesheet later showed users a fully unstyled page while it worked.
