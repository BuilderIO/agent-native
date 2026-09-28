# Visual Edit

Instead of describing every small UI tweak and waiting for another code pass,
open your running app in Agent-Native Design and edit it on a live canvas. Review
routes, responsive layouts, or a whole flow together, then ask your coding agent
to apply the edits to your source.

## Example: refine an onboarding flow

Start your app locally, then ask Claude Code:

```text
/visual-edit the onboarding flow, plus home at every breakpoint
```

Design can arrange the four onboarding screens and Home at desktop, tablet, and
mobile sizes together on one canvas. Select the **Get started** button, change
its fill with the color picker, and drag its padding on the canvas to see the
layout respond.

When the result looks right, ask Claude to **Pull in my visual edits**. Claude
retrieves the pending batch and updates the app's source for you to review. The
canvas does not write those changes to your code automatically.

## What you can do

- Compare app routes, viewport sizes, and multi-step flows side by side.
- Adjust copy, color, spacing, and layout directly on the canvas.
- Share an opt-in, sanitized snapshot for feedback. Sharing requires sign-in;
  guests work on the snapshot and do not co-edit your live local app.
- Apply a visual-edit batch through Claude Code, then review the source changes
  in your normal development workflow.
- Use the open-source Design app; its hosted service is a separate offering.

## Get started

Keep your app running locally and install the skill with its hosted Design
connector:

```bash
npx @agent-native/core@latest skills add visual-edit
```

Then describe the routes or flow you want to review with `/visual-edit`. The
[skill instructions](https://github.com/BuilderIO/agent-native/blob/main/skills/visual-edit/SKILL.md)
cover the browser, connector, and source-handoff paths.
