# Design editor harness recipes

Open a local design in the running app:

    import { newDesign, openEditor } from ".agents/skills/design-editor-repro/harness/dlib.mjs";

    const designId = await newDesign("Focused reproduction");
    const editor = await openEditor(designId, { reuse: true });

Use the returned page for the interaction and close the editor in a finally
block. The helpers also expose named control clicks, layer selection, inspector
reads, style reads, menus, and persisted file reads.

Capture the application before and after an interaction:

    import { shots } from ".agents/skills/design-editor-repro/harness/shot.mjs";

    const capture = shots("position-edit");
    await capture.app(editor.page, "before");
    // Perform the application interaction.
    await capture.app(editor.page, "after");

Use the returned paths to inspect the images. Keep generated files under the
worktree's templates/design/.tmp/editor-repro directory.

For a small visual summary, call harness/sheet.mjs with labeled local images.
The helper renders a contact sheet and returns its path.

Use harness/lock.mjs around physical mouse input so two local probes cannot
move the same cursor at once. Ordinary Playwright page input does not need the
physical-input lock.
