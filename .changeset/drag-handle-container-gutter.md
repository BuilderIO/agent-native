---
"@agent-native/core": patch
---

Rich-markdown drag handle: make container blocks (`columns`, and any nested-region
block) draggable to reorder again. Each column inside a `columns` block mounts its
own nested editor that tiles the container's full footprint and extends an 8rem
forgiving hover zone into the container's left-margin gutter. The grip's
"smallest editor wins" hover arbitration therefore handed the gutter to the inner
column editor everywhere, so the outer `columns` block (e.g. a before/after
wireframe pair in a visual plan) could never be selected or dragged.

Hover arbitration now splits candidates by cursor position: over a block's body
the innermost (smallest) editor still wins so nested blocks stay grabbable from
their content, but in the shared left-margin gutter where the grip lives the
outermost (largest) editor wins so the container can be picked up and reordered.
Sibling non-container blocks are unaffected.
