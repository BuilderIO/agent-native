# Community templates

Seeded, cloneable community apps for the first workflows prioritized from the
Geoff + Steve Gamut discussion. Each app has its own entry point and template
data; shared UI and the Agent-Native interaction contract live in `toolkit/`.

## Included

- Agent Advisor with the contextual Agent Pill entry point
- Account Tiering
- Call Follow-up Drafter
- Win/Loss Memo
- Churn Early Warning
- Account Expert
- Demo Clip Library
- Outbound in Your Voice
- LinkedIn Signal Watch
- LinkedIn ICP Prospect Tracker

The root page is a small launcher. Each app is available under
`apps/<slug>/index.html` and can be cloned by copying its folder and editing
`template.ts`. Apps use local sample data and stage bounded prompts through the
shared Agent-Native chat bridge when the host provides one.

```bash
pnpm --dir community-templates dev
pnpm --dir community-templates build
pnpm --dir community-templates typecheck
pnpm --dir community-templates test
```
