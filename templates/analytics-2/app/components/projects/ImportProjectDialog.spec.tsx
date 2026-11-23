import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImportProjectDialog } from "./ImportProjectDialog";

describe("ImportProjectDialog", () => {
  it("renders the upload control and the notebook-only boundary", () => {
    const html = renderToStaticMarkup(
      <ImportProjectDialog onClose={() => {}} onImport={async () => {}} />,
    );
    expect(html).toContain("Upload project");
    expect(html).toContain('accept=".ipynb,application/x-ipynb+json"');
    expect(html).toContain("Jupyter notebook (.ipynb)");
    expect(html).toContain(">Import<");
  });
});
