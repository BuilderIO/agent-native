---
"@agent-native/toolkit": minor
---

Ship a `@agent-native/toolkit/styles.css` entrypoint that registers the package's
compiled components with Tailwind via a self-relative `@source` directive. Apps
that render toolkit UI should `@import "@agent-native/toolkit/styles.css";` in
their `app/global.css` (after the core stylesheet).

Without it, Tailwind never generated classes that appear only inside toolkit
components — e.g. the dropdown/popover content's `z-[250]` and enter/exit
animations — so those components rendered with no `z-index` (drawing behind app
panels) and looked broken/invisible even though they were mounted. This mirrors
how `@agent-native/core` self-registers its client styles.
