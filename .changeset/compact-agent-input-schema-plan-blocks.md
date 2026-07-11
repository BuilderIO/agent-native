---
"@agent-native/core": patch
---

Add an optional `agentInputSchema` to `defineAction` — a Standard Schema used ONLY to build the tool definition advertised to the model/MCP/A2A listings, while runtime validation keeps enforcing the full `schema`. Applied it in `templates/plan` to `create-visual-plan`, `create-ui-plan`, `create-plan-design`, `create-prototype-plan`, `update-visual-plan`, and `update-local-plan-folder`: their advertised `content`/`contentPatches` block shapes now show a compact `type` enum plus a pointer to `get-plan-blocks` instead of embedding the full per-block-type union, cutting each action's serialized tool definition by roughly half to three-quarters (largest actions went from ~55-58KB down to ~24-27KB; the rest from ~45-47KB down to ~13-15KB) without changing what content is accepted or how validation errors are reported.
