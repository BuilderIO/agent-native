# Automation rules

A rule pairs a plain-language condition with actions, such as applying a
label. The user creates rules in Settings → Rules, alongside the rules model
picker and the auto-send switch.

## Sub-features

- `rule-empty` shows `No automation rules yet.`
- `rule-create` uses `New rule`, then a name, a condition, and the default
  `Apply label` action with a `Label name`, then `Save`.
- `rule-empty-label` makes `Save` a silent no-op while the label is empty.
  Nothing is stored and no error shows.
- `rules-model` is the `Rules model` combobox.
- `auto-send` is the `Allow automations to send emails automatically` switch,
  off by default.

## How to get to it (user POV)

- Settings → the Mail `Rules` section, at `/settings/app/rules`.
- Asking the agent to create a rule. This needs a connected AI model.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance.

- **Reject the empty label, then create.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-rules.ts [--param "name=…"]`.
  The recipe:
  - fills the `e.g. Auto-label newsletters` and condition placeholders
  - clicks `Save` with an empty label and confirms `list-email-rules` has no
    such rule
  - fills `Label name` with `Newsletters` and saves
  - sees the rule listed and confirms `list-email-rules` contains it
  - reloads and checks the rule is still listed.
- **Proof.** `evidence/mail-rules/01-rule-created.png` and
  `action-list-email-rules.json`.

## Gotchas

- `Save` looks enabled while the label is empty but does nothing. Assert on
  stored state, not on the button.
- Rules only run against incoming mail, which needs Gmail. Only rule storage
  is verified here.
- The `Rules model` options depend on which models are configured.
