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
import { fetchPlanBlockCatalog } from "./plan-blocks.js";

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

  it("can open the generated preview when requested", () => {
    const dir = path.join(tmpDir(), "checkout");
    writeSamplePlan(dir);
    let openedUrl = "";

    const result = writeLocalPlanPreview({
      dir,
      open: true,
      openUrl: (url) => {
        openedUrl = url;
        return { ok: true, command: "test-open" };
      },
    });

    expect(openedUrl).toBe(result.url);
    expect(result.opened).toBe(true);
    expect(result.openCommand).toBe("test-open");
  });

  it("fetches the no-auth block catalog for local authoring", async () => {
    const dir = tmpDir();
    const calls: Array<{ url: string; method: string }> = [];
    const fetchFn: typeof fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? "GET"),
      });
      return new Response(
        JSON.stringify({
          reference: "## Blocks\n\n| type | tag |",
          count: 12,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const out = path.join(dir, "plan-blocks.md");
    const result = await fetchPlanBlockCatalog({
      appUrl: "https://plan.agent-native.com/",
      out,
      fetchFn,
    });

    expect(result).toEqual({
      ok: true,
      out,
      count: 12,
      format: "reference",
    });
    expect(calls[0].url).toBe(
      "https://plan.agent-native.com/_agent-native/actions/get-plan-blocks?format=reference",
    );
    expect(calls[0].method).toBe("GET");
    expect(fs.readFileSync(out, "utf8")).toContain("## Blocks");
  });

  it("writes schema catalog output when requested", async () => {
    const dir = tmpDir();
    const fetchFn: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          reference: "## Blocks",
          blocks: [{ type: "rich-text", tag: "RichText" }],
          count: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const out = path.join(dir, "plan-blocks.schema.json");
    const result = await fetchPlanBlockCatalog({
      appUrl: "https://plans.example.com",
      format: "schema",
      out,
      fetchFn,
    });

    expect(result.format).toBe("schema");
    expect(JSON.parse(fs.readFileSync(out, "utf8"))).toEqual({
      count: 1,
      blocks: [{ type: "rich-text", tag: "RichText" }],
    });
  });
});
