# Aliases

An alias is a named group of recipients the user can address at once. The
user creates one in Settings → Aliases, giving it a name and one address per
line.

## Sub-features

- `alias-empty` shows `No aliases yet. Create one to get started.`
- `alias-create` uses `New alias`, then name and recipients, then `Save`.
- `alias-persist` keeps the alias listed after a reload.

## How to get to it (user POV)

- Settings → the Mail `Aliases` section, at `/settings/app/aliases`.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance.

- **Create and read back.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-aliases.ts [--param "name=…"]`.
  The recipe:
  - fills the `e.g. Design team` and `alice@example.com…` placeholders with
    two recipients and saves
  - sees the name listed
  - reads back `list-aliases`, which must contain the name and both addresses
  - reloads and checks the alias is still listed.
- **Proof.** `evidence/mail-aliases/01-alias-created.png` and
  `action-list-aliases.json`.

## Gotchas

- The visible field labels aren't associated with their inputs. Use the
  placeholders as handles.
- Use `{ name: "Save", exact: true }`. Short names match as substrings by
  default (see the SKILL.md gotchas).
