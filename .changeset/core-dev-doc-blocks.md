---
"@agent-native/core": minor
---

Move the seven "dev-doc" structured blocks into the core block library so any app can register them, mirroring how `checklist` / `code-tabs` / `html` / `table` / `tabs` already live in core.

- **New shared blocks** — `mermaid` (hand-drawn Mermaid diagram), `api-endpoint` (Swagger / Stripe-style endpoint reference), `data-model` (interactive dbdiagram-style ERD), `diff` (GitHub-style before/after with unified + split views), `file-tree` (VS Code / GitHub explorer with change badges), `json-explorer` (collapsible devtools JSON tree), and `annotated-code` (Stripe-docs "explain this code" walkthrough). Their React-free schema + MDX round-trip config export from `@agent-native/core/blocks/server`; their `Read` / `Edit` React renderers export from `@agent-native/core/blocks`.
- **App-agnostic** — the renderers no longer depend on a host app's shadcn/ui components or `next-themes`. Form controls use minimal inline primitives styled with the same Tailwind tokens, dark mode is detected from the document root's `.dark` class, and the diff line-differ is inlined so core carries no extra runtime dependency. Rendered output (dark/light, collapse, FK-highlight interactivity, panel editing) is unchanged.
