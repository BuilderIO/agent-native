import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TrashProjectDialog } from "./TrashProjectDialog";

describe("TrashProjectDialog", () => {
  it("names the project and says it can be restored from Trash", () => {
    const html = renderToStaticMarkup(
      <TrashProjectDialog
        projectTitle="Weekly revenue"
        pending={false}
        error={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("Move to trash");
    expect(html).toContain("Weekly revenue");
    expect(html).toContain("restore it from there");
    expect(html).toContain("Cancel");
  });

  it("keeps the dialog open with the failure message", () => {
    const html = renderToStaticMarkup(
      <TrashProjectDialog
        projectTitle="Untitled project"
        pending={false}
        error="The project could not be moved to trash."
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("could not be moved to trash");
  });
});
