import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planContentSchema,
  type PlanContent,
} from "../../shared/plan-content.js";
import { createPrototypePlanContent } from "../plan-content.js";
import { parsePlanMdxFolder } from "../plan-mdx.js";
import {
  assertLocalPlanSlug,
  localPlanFolderName,
  localPlanFolder,
  localPlansDir,
  readPlanLocalFolder,
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
    expect(localPlanFolder("plan_abc", "Checkout review flow")).toBe(
      path.join(tmpDir, "checkout-review-flow"),
    );
  });

  it("builds readable filesystem-safe folder names", () => {
    expect(localPlanFolderName("Fix / polish: visual plan folders!")).toBe(
      "fix-polish-visual-plan-folders",
    );
    expect(localPlanFolderName("!!!")).toBe("untitled-plan");
  });

  it("rejects local plan slugs that could escape PLAN_LOCAL_DIR", () => {
    expect(assertLocalPlanSlug("checkout-review_2.1")).toBe(
      "checkout-review_2.1",
    );
    expect(() => assertLocalPlanSlug("../secrets")).toThrow(/may only contain/);
    expect(() => assertLocalPlanSlug("nested/folder")).toThrow(
      /may only contain/,
    );
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
    expect(result.folder).toBe(path.join(tmpDir, "local-sync-flow"));

    const planMdx = await fs.readFile(
      path.join(tmpDir, "local-sync-flow", "plan.mdx"),
      "utf-8",
    );
    expect(planMdx).toContain("Local sync flow");
    expect(planMdx).toContain(
      "# Visual plan: open https://plan.agent-native.com/plans/plan_local1 in a browser for the canvas and review UI.",
    );
    expect(planMdx).toContain(
      'visualUrl: "https://plan.agent-native.com/plans/plan_local1"',
    );
    expect(planMdx).not.toMatch(/^planId:/m);
    expect(planMdx).not.toMatch(/^source:/m);

    // The on-disk MDX must round-trip back to a parseable plan content model,
    // so import/patch actions can consume it.
    const folder: { "plan.mdx": string; "canvas.mdx"?: string } = {
      "plan.mdx": planMdx,
    };
    const reparsed = await parsePlanMdxFolder(folder);
    expect(reparsed.title).toBe("Local sync flow");
  });

  it("reads a local plan folder without consulting the database", async () => {
    const content = sampleContent();
    await writePlanLocalFiles({
      planId: "plan_localread",
      title: content.title ?? "Untitled",
      brief: content.brief,
      content,
      url: "/plans/plan_localread",
    });

    const local = await readPlanLocalFolder("local-sync-flow");

    expect(local.folder).toBe(path.join(tmpDir, "local-sync-flow"));
    expect(local.mdx["plan.mdx"]).toContain("Local sync flow");
    expect(local.content.title).toBe("Local sync flow");
  });

  it("writes prototype.mdx for prototype plans and round-trips it", async () => {
    const content = createPrototypePlanContent({
      title: "Prototype local sync",
      brief: "Keep live prototype source beside the plan.",
      screens: [
        {
          id: "start",
          title: "Start",
          html: '<div><h1>Start</h1><button data-goto="done">Continue</button></div>',
        },
        {
          id: "done",
          title: "Done",
          html: "<div><h1>Done</h1></div>",
        },
      ],
    });

    const result = await writePlanLocalFiles({
      planId: "plan_proto",
      title: content.title ?? "Prototype",
      brief: content.brief,
      content,
      url: "/plans/plan_proto",
    });

    expect(result.written).toBe(true);
    expect(result.files).toEqual(
      expect.arrayContaining(["plan.mdx", "canvas.mdx", "prototype.mdx"]),
    );

    const folderPath = path.join(tmpDir, "prototype-local-sync");
    const folder = {
      "plan.mdx": await fs.readFile(path.join(folderPath, "plan.mdx"), "utf-8"),
      "canvas.mdx": await fs.readFile(
        path.join(folderPath, "canvas.mdx"),
        "utf-8",
      ),
      "prototype.mdx": await fs.readFile(
        path.join(folderPath, "prototype.mdx"),
        "utf-8",
      ),
    };
    const reparsed = await parsePlanMdxFolder(folder);
    expect(reparsed.prototype?.screens.map((screen) => screen.id)).toEqual([
      "start",
      "done",
    ]);
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
      path.join(tmpDir, "local-sync-flow", "plan.mdx"),
      "utf-8",
    );
    await writePlanLocalFiles(input);
    const second = await fs.readFile(
      path.join(tmpDir, "local-sync-flow", "plan.mdx"),
      "utf-8",
    );
    expect(second).toBe(first);
  });

  it("adds a numeric suffix only when a readable folder name collides", async () => {
    const content = sampleContent();
    const taken = path.join(tmpDir, "checkout-review-flow");
    await fs.mkdir(taken, { recursive: true });
    await fs.writeFile(
      path.join(taken, "plan.mdx"),
      `---\ntitle: "Checkout review flow"\nplanId: "plan_other"\n---\n\n`,
      "utf-8",
    );

    const input = {
      planId: "plan_collision",
      title: "Checkout review flow",
      brief: content.brief,
      content,
      url: "/plans/plan_collision",
    };
    const result = await writePlanLocalFiles(input);

    expect(result.written).toBe(true);
    expect(result.folder).toBe(path.join(tmpDir, "checkout-review-flow-2"));

    const second = await writePlanLocalFiles(input);
    expect(second.folder).toBe(path.join(tmpDir, "checkout-review-flow-2"));
    await expect(
      fs.stat(path.join(tmpDir, "checkout-review-flow", "plan.mdx")),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(tmpDir, "checkout-review-flow-2", "plan.mdx")),
    ).resolves.toBeTruthy();
  });

  it("moves legacy plan-id folders to readable folders on write", async () => {
    const content = sampleContent();
    const legacy = path.join(tmpDir, "plan_legacy123");
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(
      path.join(legacy, "plan.mdx"),
      `---\ntitle: "Old title"\nplanId: "plan_legacy123"\n---\n\n`,
      "utf-8",
    );

    const result = await writePlanLocalFiles({
      planId: "plan_legacy123",
      title: "Readable local mirror",
      brief: content.brief,
      content,
      url: "/plans/plan_legacy123",
    });

    expect(result.written).toBe(true);
    expect(result.folder).toBe(path.join(tmpDir, "readable-local-mirror"));
    await expect(fs.stat(legacy)).rejects.toThrow();
    await expect(
      fs.stat(path.join(tmpDir, "readable-local-mirror", "plan.mdx")),
    ).resolves.toBeTruthy();
  });

  it("does not throw when the local plans directory cannot be created", async () => {
    const nonDirectory = path.join(tmpDir, "not-a-directory");
    await fs.writeFile(nonDirectory, "not a directory", "utf-8");
    process.env.PLAN_LOCAL_DIR = nonDirectory;
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
