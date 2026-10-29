# Design

An agent-native HTML prototyping studio — describe a screen and get a working
Alpine/Tailwind prototype you can refine, tweak, and export. An open-source,
self-hostable alternative to v0 and Lovable-style prototyping tools.

**Live app: [design.agent-native.com](https://design.agent-native.com?utm_source=github&utm_medium=referral&utm_content=design-readme)**

Instead of a layered drawing canvas, the agent generates complete self-contained
HTML prototypes, renders them in an iframe, and lets you refine the result with
prompts and visual tweak controls.

## Features

- Generate complete, working HTML prototypes from a prompt.
- Compare multiple design directions, then keep refining the strongest one.
- Visual tweak controls for common copy, layout, color, and spacing changes.
- Save and reuse design-system preferences to stay on-brand.
- Import existing HTML or reference material as context.
- Export real files: HTML, ZIP, or PDF.
- Share prototypes with element-anchored review comments and apply verified feedback through the agent.

## Develop locally

Scaffold your own copy and run it:

```bash
npx --yes @agent-native/core@latest create my-design --standalone --template design
cd my-design
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-design](https://agent-native.com/docs/template-design?utm_source=github&utm_medium=referral&utm_content=design-readme).

## First Design experiment

New Design signups are assigned to the `design_no_questions` experiment when
the app is enabled. To turn the experiment off for a deployment, set
`AGENT_QUESTION_INTAKE_EXPERIMENT_DISABLED=true`. Users without a stored
signup-time assignment continue on the control path.

The first-output next-step experiment assigns eligible signed-in owners 50/50
to `control` or `next_step` after a verified completed generation. The
`first_output_next_step_exposed` event records both arms. Join subsequent
`first_output_next_step_shown`, `first_output_next_step_clicked`, and
`first_output_next_step_dismissed` events by `auth_user_id` to measure engagement;
compare later `design_experiment_editor_visit` and Design action events by the
same identity and timestamp for return visits and next actions. Use the private
`design_first_output_experiment_claims` table as the assignment population,
including users without a later event: telemetry is best-effort, and an exposure
event can be lost after a durable claim. This is an intention-to-treat analysis;
a claim does not prove that the bar rendered. Eligibility includes verified
completed runs observed in the editor. Result links opened separately and
historical first generations cannot be identified by this experiment.
