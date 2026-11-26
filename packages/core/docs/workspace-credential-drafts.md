# Workspace credential draft edits

`createWorkspaceCredentialActions` and `createWorkspaceCredentialService` accept the trusted server option `allowDraftEdits: true`. It is off by default. Enable it only when the app can reopen and activate its own disabled drafts.

With the option enabled, pass `draft: true` to `update` with the opened connection revision. The update stores the submitted configuration and credentials without provider validation, atomically marks the profile disabled, and keeps its grant and encrypted credentials. Disabled profiles cannot resolve credentials for app requests. The returned profile has `active: false`; its `workspaceCredentialDraft` config marker identifies it as an editable draft. Archive removes that marker, so an archived connection cannot be activated as a draft.

To activate, reopen the draft and pass its current revision with `draft: false`. The service validates the complete credential set before publishing the active status. A validation failure leaves the draft and its revision unchanged. An update that omits `draft` keeps the profile a draft and skips validation; only an explicit `draft: false` activates it. Omitted secret values retain their saved values. Unknown write outcomes require a fresh read rather than an automatic retry.

```ts
const actions = createWorkspaceCredentialActions({
  appId: "analytics-2",
  provider,
  validateCredentials,
  allowDraftEdits: true,
});

await actions.update.run(
  { connectionId, revision, draft: true, name },
  context,
);
// Reopen the profile to get its latest revision before activation.
await actions.update.run(
  { connectionId, revision: reopenedRevision, draft: false },
  context,
);
```

The app must apply its usual manager authorization and provide a form that distinguishes a disabled draft from an archived connection. Do not treat the draft marker as permission to query the provider.
