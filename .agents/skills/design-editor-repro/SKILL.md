---
name: design-editor-repro
description: Reproduce and verify Design editor issues against the application itself.
---

# Reproduce Design editor issues

Use this skill for defects that need a real Design editor session. Work from a
local or production copy of an Agent-Native design and describe the observed
application behavior directly.

## Setup

1. Start the worktree's Design app with
   .agents/skills/design-editor-repro/harness/start-dev.sh.
2. Run
   node .agents/skills/design-editor-repro/harness/doctor.mjs
   until the local app and editor session are ready.
3. Copy a source design with
   node .agents/skills/design-editor-repro/scripts/copy-design.mjs <design-id>.
   Use a production copy only when DESIGN_TEST_EMAIL and
   DESIGN_TEST_PASSWORD are configured. Remove that copy when finished.
4. Reproduce the reported steps before changing application code. Save only
   task-relevant files under templates/design/.tmp/editor-repro/.

## Investigation

- Use the helpers in harness/dlib.mjs to open the editor, select layers, inspect
  fields, trigger actions, and read persisted files.
- Prefer Playwright input through the app page. Use the OS input helper only
  when browser input cannot exercise the reported path.
- Capture screenshots with harness/shot.mjs when visual evidence will help
  explain the application state. The helper returns local paths for inspection.
- Check the relevant implementation and neighboring tests before changing code.
  Keep fixes at the application boundary and add a regression test where the
  existing suite supports it.
- Keep diagnostic data local to the task. Do not commit screenshots, copied
  user designs, session data, credentials, or temporary exports.

## Verification

- Reproduce the original steps on the changed build.
- Run the narrowest relevant unit or browser tests, then the required Design
  interaction lane when the change affects canvas behavior.
- Inspect the rendered application when the fix changes visible behavior.
- Close the editor page and delete any temporary production copy before
  reporting completion.

For details, see harness-recipes.md, reference/input-and-osmouse.md,
reference/fixing.md, reference/tests-and-blast-radius.md, and
reference/performance.md.
