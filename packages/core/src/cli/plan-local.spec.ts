import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildLocalPlanPreviewHtml,
  localPlanFolderName,
  readLocalPlanFiles,
  writeLocalPlanPreview,
} from "./plan-local.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-plan-local-"));
  tmpRoots.push(root);
  return root;
}

function writeSamplePlan(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Private Checkout Plan"',
      'brief: "No database writes."',
      'kind: "recap"',
      "---",
      "",
      "# Private Checkout Plan",
      "",
      "This plan stays local.",
      "",
      '<WireframeBlock id="wf" title="Checkout" data={{ surface: "browser", html: "<div>Pay</div>" }} />',
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("local plan CLI helpers", () => {
  it("builds the same safe folder names as the Plan app local mirror", () => {
    expect(localPlanFolderName("Private / no-DB recap!")).toBe(
      "private-no-db-recap",
    );
  });

  it("reads only the expected local plan source files", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const files = readLocalPlanFiles(dir);

    expect(files.planMdx).toContain("Private Checkout Plan");
    expect(files.canvasMdx).toBeUndefined();
  });

  it("generates a self-contained preview with a no-DB notice", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const html = buildLocalPlanPreviewHtml({ dir });

    expect(html).toContain("Private Checkout Plan");
    expect(html).toContain("No DB writes");
    expect(html).toContain("does not call");
    expect(html).toContain("&lt;WireframeBlock");
  });

  it("writes preview.html and returns a file URL", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);

    const result = writeLocalPlanPreview({ dir });

    expect(result.kind).toBe("recap");
    expect(result.files).toContain("plan.mdx");
    expect(result.url).toMatch(/^file:\/\//);
    expect(fs.readFileSync(result.out, "utf-8")).toContain("Local-files mode");
  });
});
