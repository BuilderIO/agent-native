---
"@agent-native/core": patch
---

The `/visual-plan` skill now prescribes a gated, read-only, non-blocking
adversarial self-review before handoff: surface the plan first, then spawn one
skeptical reviewer (concurrently, against the written plan only — no
re-research) for high-stakes architecture/backend/data/multi-file plans, apply
clear-cut fixes via `update-visual-plan` patches, and route genuine judgment
calls back to the user. Plan Discipline also gains a reuse-first instruction
(name what each step reuses before what it adds) and a "decide the hard-to-
reverse bets first" instruction (settle wire format, public ids, data-model
shape, auth, and ownership before scoping to the smallest first cut). The
guidance is byte-synced across the shipped skill constant, the template copy,
and the exported mirror.
