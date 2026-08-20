# Changelog

All notable user-facing changes to Agent-Native Analytics are documented here. Open it any
time from the command menu (Cmd+K → "What's new") or from Settings.

Older updates live in [the changelog folder](./changelog/) and are included in the in-app "What's new" view.

## 2026-08-18

### Fixed

- Analytics no longer carries a previous dashboard into a new Ask chat.
- Feature flag changes now preserve actionable failures and verify the target app's persisted state.

## 2026-08-17

### Fixed

- Fixed dashboard editing focus, history recovery, panel setup focus, and repeated failed warehouse queries.

## 2026-08-13

### Fixed

- Account health readouts now verify customer identity, completed usage periods,
  contract metrics, and product adoption before summarizing.

## 2026-08-12

### Improved

- Ask now toggles chat history directly, and the collapsed sidebar uses a more compact navigation rhythm.
- Data source statuses now distinguish workspace access from credentials configured in Analytics.

### Fixed

- Feature flags can be managed across apps whose workspace records use different local IDs
- Kept feature flag details readable by stacking rollout controls at narrow widths.

## 2026-08-11

### Improved

- Full-page chat composers stay at a focused 750px width.

### Fixed

- Analytics custom blocks keep loading when they use the legacy BigQuery query action name.
- Analytics dashboards keep the selected tab when reopened
- Analytics routes company-knowledge and Slack-context questions to Brain
- Chrome no longer offers to install Analytics as a desktop app.
