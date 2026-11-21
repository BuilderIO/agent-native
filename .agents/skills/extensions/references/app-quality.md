# App quality pipeline

Use `app-quality-bar` for new extensions and changes to a user-facing workflow.
Choose one or two patterns after inspecting the closest shipped host
interaction. Write the chosen and rejected options in the app's required
`DESIGN.md` before implementing. In a runtime-only session, use the extension
brief or authorized workspace resource to record decisions and hand back the
required design update to the source-code owner.

For source changes register or update `app.manifest.ts` with screens, entities,
`viewPolicy`, and actionable `suggestableCapabilities`. A sandboxed extension
uses the host's shared actions and scoped extension APIs. Use the real host
route or slot for the 12-row rubric, automatic fails, blind reviewer, and
60-second Playwright walkthrough. Verify state persistence, narrow layout,
error recovery, and three applicable manifest-driven chat cases. Keep the
extension in verification when either gate is incomplete. Record the
independent walkthrough in `app-quality-bar/preview-acceptance.md`, including
which host slot reopened and which edit survived.
