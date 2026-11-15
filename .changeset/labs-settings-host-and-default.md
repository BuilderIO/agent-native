---
"@agent-native/toolkit": patch
---

Labs settings show a Lab the host product decides as set and read-only, instead of a switch whose choice the server wouldn't apply. After a save, a row shows what the server applies once it reads back, rather than the choice it sent. If that read fails, the row keeps the choice until a later read lands. A Lab with a saved choice offers Use default, which clears the choice. Keyboard focus stays on the row after a save, instead of dropping to the page while the switch waits for the server.
