# Design-system creation MVP

Local review artifact based on the [concept clip](https://beta.clips.agent-native.com/r/ufznkqAVv2QK). No hosted Plan content was created. This pass changes planning artifacts only, not app source.

- `plan.mdx`: the product contract, MVP boundary, integration work, and two implementation loops.
- `canvas.mdx`: four states: starting paths, multi-source collection, the left-chat/live-canvas workspace, and return to the prompt.
- `prototype.mdx`: a stateful local interaction model. Supports combined website + design.md + logo + Figma references, selective removal, Back without losing the batch, fresh creation, target selection, an example Avatar refinement, more references on the same system, and return.

## Review verification · 2026-09-23

- Offline lint passed.
- Full local renderer schema validation passed with zero issues.
- Inspected the document and four-frame canvas; no overlapping artboards.
- Browser-tested References → website + two file fixtures + Figma → remove/re-add website → Back/Continue → create. All four sources appeared together in the workspace.
- Selected Avatar, sent “Make avatars rounded squares,” and verified the example preview and usage rule changed.
- Reopened references from the composer: the existing batch remained and the action became Add to system.
- Returned to the original prompt with both brief.pdf and the system attachment.
- Final layout pass: tested Start fresh with a different name, native chat opening without references, first generation simulation, then Avatar selection/refinement. Composer remains visible while canvas content scrolls.

This is a prototype, not proof of live extraction, DSI, real AI generation, persistence, or cross-app consumption. Those are explicit implementation acceptance gates. File selection stages local demo fixtures; nothing is uploaded. The example refinement is scripted, not an agent response.

The Plan renderer's clean/sketch toggle can reset its local prototype runtime. Reload the plan if switching that preview style disrupts interactions. This review is left in the working clean style.

## Reopen

Keep the Plan app running on port 8096. From the Design app directory:

```sh
node node_modules/@agent-native/core/bin/agent-native.js plan local serve --dir plans/design-system-launch-mvp --kind plan --app-url http://127.0.0.1:8096
```

The command prints a machine-local review URL. Keep that bridge running while reviewing. The ignored .plan-url may be rewritten by one-shot validation; use the active serve command's link. Feedback can be supplied in this task or by editing the local artifact.
