---
"@agent-native/core": patch
---

Wrap shadcn `Tooltip` usages in a `TooltipProvider` so the agent panel and other top-level components don't crash on render. PR #509 swapped native `title` hints for `Tooltip`, but `@radix-ui/react-tooltip@1.2.x` requires a provider ancestor and threw `'Tooltip' must be used within 'TooltipProvider'` on the docs site and any template embedding the agent sidebar.
