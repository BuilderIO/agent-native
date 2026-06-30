---
"@agent-native/core": patch
---

Design connect: document the per-element provenance contract (`data-source-file` / `data-source-line` / `data-source-column` / `data-component-name`, plus `data-loc` shorthand) used to map a selected element back to its source location, and surface it in `design connect --help`. The `resolveNodeToFile` bridge capability now carries a reason string describing this contract.
