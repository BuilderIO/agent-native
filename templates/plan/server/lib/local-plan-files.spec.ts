import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planContentSchema,
  type PlanContent,
} from "../../shared/plan-content.js";
import { parsePlanMdxFolder } from "../plan-mdx.js";
import {
  localPlanFolder,
  localPlansDir,
  writePlanLocalFiles,
} from "./local-plan-files.js";

function sampleContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Local sync flow",
    brief: "Plans written to local files in local mode.",
    blocks: [
      {
        id: "summary",
        type: "rich-text",
        title: "Summary",
        data: { markdown: "Round-trip the plan to MDX on disk." },
      },
    ],
  });
}

describe("local-plan-files", () => {
  let tmpDir: string;
  let savedDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-local-"));
    savedDir = process.env.PLAN_LOCAL_DIR;
    process.env.PLAN_LOCAL_DIR = tmpDir;
  });

  afterEach(async () => {
    if (savedDir === undefined) delete process.env.PLAN_LOCAL_DIR;
    else process.env.PLAN_LOCAL_DIR = savedDir;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("uses PLAN_LOCAL_DIR for the plans directory", () => {
    expect(localPlansDir()).toBe(path.resolve(tmpDir));
    expect(localPlanFolder("plan_abc")).toBe(path.join(tmpDir, "plan_abc"));
  });

  it("writes plan.mdx and round-trips through parsePlanMdxFolder", async () => {
    const content = sampleContent();
    const result = await writePlanLocalFiles({
      planId: "plan_local1",
      title: content.title ?? "Untitled",
      brief: content.brief,
      content,
      url: "/plans/plan_local1",
    });

    expect(result.written).toBe(true);
    expect(result.files).toContain("plan.mdx");

    const planMdx = await fs.readFile(
      path.join(tmpDir, "plan_local1", "plan.mdx"),
      "utf-8",
    );
    expect(planMdx).toContain("Local sync flow");

    // The on-disk MDX must round-trip back to a parseable plan content model,
    // so import/patch actions can consume it.
    const folder: { "plan.mdx": string; "canvas.mdx"?: string } = {
      "plan.mdx": planMdx,
    };
    const reparsed = await parsePlanMdxFolder(folder);
    expect(reparsed.title).toBe("Local sync flow");
  });

  it("is idempotent — same content produces the same files", async () => {
    const content = sampleContent();
    const input = {
      planId: "plan_idem",
      title: content.title ?? "Untitled",
      brief: content.brief,
      content,
      url: "/plans/plan_idem",
    };
    await writePlanLocalFiles(input);
    const first = await fs.readFile(
      path.join(tmpDir, "plan_idem", "plan.mdx"),
      "utf-8",
    );
    await writePlanLocalFiles(input);
    const second = await fs.readFile(
      path.join(tmpDir, "plan_idem", "plan.mdx"),
      "utf-8",
    );
    expect(second).toBe(first);
  });

  it("does not throw on an unwritable directory", async () => {
    process.env.PLAN_LOCAL_DIR = "/proc/this-should-not-be-writable/plans";
    const content = sampleContent();
    const result = await writePlanLocalFiles({
      planId: "plan_ro",
      title: "x",
      brief: "y",
      content,
    });
    expect(result.written).toBe(false);
  });
});
