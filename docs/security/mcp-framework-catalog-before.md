# Framework MCP catalog inventory before hardening

Recorded on 2026-10-22 against `origin/main` at `16d6de1469c90d57fe10faeb69d2a9dd220c68d3`. The later rebase target `b07c13bf20c4636931d3cf4d97c0d4ad8acdb305` changes no framework action names or MCP registry/catalog policy.

This is a historical audit snapshot, not a catalog configuration. The existing `advertised-catalog.harness.ts` loaded each app plugin and its actual constructed action map, then used the in-memory MCP client to call `tools/list`. Factory/core-loader provenance identified framework entries; names were not inferred from source text. App-owned entries, including Dispatch package actions, are not counted as framework factories.

The run completed 476 listings: 17 apps, four runtime surfaces, and seven variants. It found 192 registry factory/core-loader names plus two factories created by the MCP server itself. Every entry below was actually advertised in the specified combinations. Entries sharing an identical exposure pattern are grouped.

Apps: analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, plan, slides, slides-2, tasks.

Surface labels: `off`, `sandboxed`, and `trusted` mean production with the corresponding code-execution setting. `dev` means the authenticated development full surface. `all` in an app cell means all 17 apps.

The mounted default uses each app's configuration unchanged. Forced compact disables connector declarations and authenticated-read expansion. Forced connector explicitly declares every registered action. Forced app sets `catalogMode: "app"`. Forced directory uses reviewed, annotation-compatible entries from the original full listing and a synthetic HTTPS widget origin; it does not claim these apps currently deploy directory profiles. Full-token requests the token full-catalog scope; full-env enables the existing full-catalog configuration alias.

| Variant         | Distinct framework names across apps/surfaces |
| --------------- | --------------------------------------------- |
| mounted-default | 5                                             |
| compact         | 6                                             |
| connector       | 192                                           |
| app             | 191                                           |
| directory       | 54                                            |
| full-token      | 193                                           |
| full-env        | 193                                           |

## Default changes in this PR

The before/after comparison uses every mounted default catalog on all four surfaces. Analytics loses `estimate-query-cost` because its SQL input lacks `publicAgent.allowRawQueryInput`. Assets, Brain, Clips, Factory, Forms, and Tasks lose `context-manifest-get` and `context-preview-get` because these are covered by the existing context exclusions. No other mounted-default tool disappears, and no default tool is added.

`create_embed_session`, `ask_app`, and its `ask-agent` alias are outside this factory inventory and remain unchanged by this PR. `create_embed_session` gating belongs to the separate embed-scope change.

The fetch factory's real registered name is `web-request`. The new boundary also denies the `fetch` alias, all `db-*` and `provider-api-*` names, `seed-*`, inherited context/extension/browser-session exclusions, raw-query inputs without opt-in, and dev CLI wrappers. `db-exec` and `db-patch` are absent from these mounted shapes but are covered by the explicit registration regression fixtures.

## Server-created factories

`create_workspace_app` and `list_templates` are added by the MCP server after the app's registry is assembled. Both appeared only in full-token and full-env listings, for every app on every surface (136 listings each). They appeared in none of the mounted-default, compact, connector, app, or directory listings. Both now default off under the same framework policy.

## Registry exposure groups

### Group 1

`activate-browser`, `call-agent`, `chat-history`, `connect-builder`, `connect-file-storage`, `control-remote-browser`, `core-send-email`, `create-agent-resource-link`, `delete-memory`, `describe-workspace-apps`, `docs-search`, `explain-access`, `export-audit-events`, `export-audit-ocsf`, `export-resource-pack`, `framework-search`, `get-audit-event`, `get-email-log-body`, `get-experiments`, `get-remote-browser-command`, `get-user-profile`, `import-resource-pack`, `list-app-member-roles`, `list-app-permissions`, `list-audit-events`, `list-browser-session-actions`, `list-browser-session-webmcp-tools`, `list-browser-sessions`, `list-email-activity`, `list-email-engagement`, `list-email-log`, `list-org-service-tokens`, `list-remote-browser-devices`, `list-sign-in-methods`, `list-transactional-emails`, `list-workspace-app-access`, `list-workspace-icons`, `manage-agent-engine`, `manage-agent-loop-settings`, `manage-notifications`, `manage-progress`, `open-settings-page`, `promote-trace-eval`, `read-attachment`, `read-remote-browser-page`, `refresh-screen`, `render-data-widget`, `render-transactional-email-preview`, `resources`, `revoke-org-service-token`, `run-browser-session-action`, `run-browser-session-webmcp-tool`, `save-memory`, `send-browser-session-command`, `set-app-member-roles`, `set-app-permission-roles`, `set-browser-control`, `set-computer-use`, `set-search-params`, `set-url-path`, `set-workspace-app-access`, `show-workspace-file`, `source-search`, `update-user-profile`, `view-browser-session`, `web-search`

| Variant    | Surface                      | Apps                                                                                                                           |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| connector  | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 2

`add-extension-slot-target`, `create-extension`, `delete-extension`, `extension-data-get`, `extension-data-set`, `get-extension`, `get-extension-history-version`, `global-hide-extension`, `global-unhide-extension`, `hide-extension`, `install-extension`, `list-extension-history`, `list-extension-slots`, `list-extensions`, `list-extensions-for-slot`, `render-inline-extension`, `restore-extension-history-version`, `show-extension-inline`, `unhide-extension`, `uninstall-extension`, `update-extension`

| Variant    | Surface                      | Apps      |
| ---------- | ---------------------------- | --------- |
| connector  | off, sandboxed, trusted, dev | analytics |
| app        | off, sandboxed, trusted, dev | analytics |
| full-token | off, sandboxed, trusted, dev | analytics |
| full-env   | off, sandboxed, trusted, dev | analytics |

### Group 3

`bash`, `edit`, `write`

| Variant    | Surface      | Apps                                                                                                                           |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| connector  | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| directory  | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 4

`bulk-update-workspace-user-groups`, `consume-review-feedback`, `context-evict`, `context-pin`, `context-report`, `context-restore`, `create-resource-suggestion`, `create-resource-suggestion-proposal`, `create-resource-version`, `create-review-comment`, `decide-resource-suggestion`, `decide-resource-suggestion-proposal`, `delete-api-key`, `delete-review-comment`, `delete-workspace-user-group`, `disconnect-chatgpt-subscription`, `manage-builder-connection`, `manage-file-storage`, `manage-messaging-channel`, `manage-provider-key-policy`, `manage-provider-models`, `manage-service-providers`, `manage-usage-alert`, `react-to-review-comment`, `reply-review-comment`, `resolve-review-thread`, `restore-resource-version`, `select-chatgpt-subscription-account`, `send-review-thread-to-agent`, `set-feature-flag`, `set-lab`, `set-localization-preference`, `set-review-status`, `set-review-thread-muted`, `set-review-thread-unread`, `set-review-threads-unread`, `share-resource`, `unshare-resource`, `update-resource-suggestion`, `update-review-comment`, `update-review-comment-anchor`, `upload-image`, `upsert-workspace-user-group`

| Variant    | Surface                      | Apps     |
| ---------- | ---------------------------- | -------- |
| connector  | off, sandboxed, trusted, dev | dispatch |
| app        | off, sandboxed, trusted, dev | dispatch |
| directory  | off, sandboxed, trusted, dev | dispatch |
| full-token | off, sandboxed, trusted, dev | dispatch |
| full-env   | off, sandboxed, trusted, dev | dispatch |

### Group 5

`change-appearance`

| Variant    | Surface                      | Apps                                                                                                                   |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| connector  | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 6

`check-provider-key`, `get-builder-credit-status`, `get-builder-credit-usage`, `get-builder-referral-info`, `get-chatgpt-subscription-status`, `get-feature-flags`, `get-file-storage`, `get-infrastructure-status`, `get-lab-states`, `get-labs`, `get-launchdarkly-flags`, `get-localization-preference`, `get-provider-models`, `get-resource-suggestion`, `get-resource-suggestion-proposal-by-creation-key`, `get-resource-version`, `get-review-feedback`, `get-usage-alerts`, `get-usage-insights`, `get-usage-metrics`, `get-usage-run`, `list-api-keys`, `list-chatgpt-subscription-accounts`, `list-feature-flags`, `list-messaging-channels`, `list-model-providers`, `list-resource-history`, `list-resource-shares`, `list-resource-suggestions`, `list-resource-versions`, `list-review-comments`, `list-workspace-user-groups`, `preview-secret-removal`

| Variant    | Surface                      | Apps     |
| ---------- | ---------------------------- | -------- |
| connector  | off, sandboxed, trusted, dev | dispatch |
| app        | off, sandboxed, trusted, dev | dispatch |
| full-token | off, sandboxed, trusted, dev | dispatch |
| full-env   | off, sandboxed, trusted, dev | dispatch |

### Group 7

`context-manifest-get`

| Variant    | Surface                      | Apps     |
| ---------- | ---------------------------- | -------- |
| compact    | off, sandboxed, trusted, dev | dispatch |
| connector  | off, sandboxed, trusted, dev | dispatch |
| app        | off, sandboxed, trusted, dev | dispatch |
| full-token | off, sandboxed, trusted, dev | dispatch |
| full-env   | off, sandboxed, trusted, dev | dispatch |

### Group 8

`context-preview-get`

| Variant         | Surface                      | Apps                                                                                                                           |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| mounted-default | off, sandboxed, trusted, dev | assets, brain, clips, factory, forms, tasks                                                                                    |
| compact         | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| connector       | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app             | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token      | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env        | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 9

`db-check-scoping`

| Variant    | Surface | Apps                                                                                                  |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------- |
| connector  | dev     | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |
| app        | dev     | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |
| full-token | dev     | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |
| full-env   | dev     | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |

### Group 10

`db-query`, `db-schema`

| Variant    | Surface                      | Apps                                                                                                  |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| connector  | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |
| app        | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |
| full-token | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |
| full-env   | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, mail, tasks |

### Group 11

`delete-data-program`, `get-code-execution`, `preview-data-program`, `run-data-program`, `save-data-program`, `tool-orchestration`

| Variant    | Surface                 | Apps                                                                                                                           |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| connector  | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 12

`get-data-program`, `list-data-programs`

| Variant    | Surface                 | Apps                                                                                                                |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| connector  | sandboxed, trusted, dev | assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | sandboxed, trusted, dev | assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | sandboxed, trusted, dev | assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | sandboxed, trusted, dev | assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 13

`get-framework-context`

| Variant    | Surface                      | Apps                                                                                                           |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| connector  | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, mail, slides, slides-2, tasks |
| app        | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, mail, slides, slides-2, tasks |
| full-token | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, mail, slides, slides-2, tasks |
| full-env   | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, mail, slides, slides-2, tasks |

### Group 14

`invite-organization-member`, `list-organization-members`

| Variant         | Surface                      | Apps                                                                                                                           |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| mounted-default | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| compact         | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| connector       | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app             | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| directory       | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token      | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env        | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 15

`manage-automations`

| Variant         | Surface                      | Apps |
| --------------- | ---------------------------- | ---- |
| mounted-default | off, sandboxed, trusted, dev | plan |
| connector       | off, sandboxed, trusted, dev | all  |
| app             | off, sandboxed, trusted, dev | all  |
| full-token      | off, sandboxed, trusted, dev | all  |
| full-env        | off, sandboxed, trusted, dev | all  |

### Group 16

`read`

| Variant    | Surface      | Apps                                                                                                                           |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| connector  | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 17

`read-problem-report`, `set-experiment`, `set-theme-family`, `web-request`

| Variant    | Surface                      | Apps                                                                                                                           |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| connector  | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| directory  | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | off, sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 18

`run-code`

| Variant    | Surface                 | Apps                                                                                                                           |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| connector  | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| app        | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| directory  | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-token | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |
| full-env   | sandboxed, trusted, dev | analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, slides, slides-2, tasks |

### Group 19

`set-resource-visibility`

| Variant    | Surface                      | Apps     |
| ---------- | ---------------------------- | -------- |
| compact    | off, sandboxed, trusted, dev | dispatch |
| connector  | off, sandboxed, trusted, dev | dispatch |
| app        | off, sandboxed, trusted, dev | dispatch |
| directory  | off, sandboxed, trusted, dev | dispatch |
| full-token | off, sandboxed, trusted, dev | dispatch |
| full-env   | off, sandboxed, trusted, dev | dispatch |

### Group 20

`tool-search`

| Variant         | Surface                      | Apps |
| --------------- | ---------------------------- | ---- |
| mounted-default | off, sandboxed, trusted, dev | all  |
| compact         | off, sandboxed, trusted, dev | all  |
| connector       | off, sandboxed, trusted, dev | all  |
