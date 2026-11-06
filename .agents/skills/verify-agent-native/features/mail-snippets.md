# Snippets

A snippet is reusable text the user inserts while composing. The user creates
one in Settings → Snippets with a name and body.

## Sub-features

- `snippet-empty` shows `No snippets yet. Create one to get started.`
- `snippet-create` uses `New snippet`, then name and body, then `Save`.
- `snippet-persist` keeps the snippet listed after a reload.

## How to get to it (user POV)

- Settings → the Mail `Snippets` section, at `/settings/app/snippets`.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance.

- **Create and read back.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-snippets.ts [--param "name=…"]`.
  The recipe fills the `e.g. Pricing follow-up` and `Text inserted when this
  snippet is used...` placeholders and saves. It reads back `manage-snippets`
  over POST with `{ "operation": "list" }`, then reloads and checks the snippet
  is still listed.
- **Proof.** `evidence/mail-snippets/01-snippet-created.png` and
  `action-manage-snippets.json`.

## Gotchas

- `manage-snippets` has no GET route. Read it back with
  `ctx.action("manage-snippets", { operation: "list" }, "POST")`.
- Inserting a snippet from compose isn't covered by the recipe.
