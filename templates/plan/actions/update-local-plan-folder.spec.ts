import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readPlanLocalFolder,
  writePlanLocalFolder,
} from "../server/lib/local-plan-files.js";
import {
  planContentSchema,
  storedPlanContentSchema,
  type PlanContent,
} from "../shared/plan-content.js";
import updateLocalPlanFolder from "./update-local-plan-folder.js";

function sampleContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Checkout review",
    brief: "Local MDX editing.",
    blocks: [
      {
        id: "summary",
        type: "rich-text",
        title: "Summary",
        data: { markdown: "Original local plan text." },
      },
    ],
  });
}

describe("update-local-plan-folder", () => {
  let tmpDir: string;
  let savedDir: string | undefined;
  let savedMode: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedAuthMode: string | undefined;
  let savedRepoRoot: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-local-action-"));
    savedDir = process.env.PLAN_LOCAL_DIR;
    savedMode = process.env.PLAN_LOCAL_MODE;
    savedNodeEnv = process.env.NODE_ENV;
    savedAuthMode = process.env.AUTH_MODE;
    savedRepoRoot = process.env.PLAN_REPO_ROOT;
    process.env.PLAN_LOCAL_DIR = tmpDir;
    process.env.PLAN_LOCAL_MODE = "1";
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_MODE;
    delete process.env.PLAN_REPO_ROOT;
  });

  afterEach(async () => {
    if (savedDir === undefined) delete process.env.PLAN_LOCAL_DIR;
    else process.env.PLAN_LOCAL_DIR = savedDir;
    if (savedMode === undefined) delete process.env.PLAN_LOCAL_MODE;
    else process.env.PLAN_LOCAL_MODE = savedMode;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = savedAuthMode;
    if (savedRepoRoot === undefined) delete process.env.PLAN_REPO_ROOT;
    else process.env.PLAN_REPO_ROOT = savedRepoRoot;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("applies structured content patches and writes them to the same local folder", async () => {
    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "checkout-review",
      planId: "local-checkout-review",
      title: content.title ?? "Checkout review",
      brief: content.brief,
      content,
      url: "/local-plans/checkout-review",
    });

    const result = await updateLocalPlanFolder.run({
      slug: "checkout-review",
      contentPatches: [
        {
          op: "update-rich-text",
          blockId: "summary",
          markdown: "Edited locally in the browser.",
        },
      ],
    });

    expect(result.localOnly).toBe(true);
    expect(result.slug).toBe("checkout-review");
    expect(result.folder).toBe(path.join(tmpDir, "checkout-review"));
    expect(result.access?.role).toBe("editor");
    expect(result.plan.content?.blocks[0]).toMatchObject({
      id: "summary",
      type: "rich-text",
      data: { markdown: "Edited locally in the browser." },
    });

    const planMdx = await fs.readFile(
      path.join(tmpDir, "checkout-review", "plan.mdx"),
      "utf-8",
    );
    expect(planMdx).toContain("Edited locally in the browser.");
  });

  it("preserves stored legacy blocks during an unrelated local folder update", async () => {
    const content = storedPlanContentSchema.parse({
      version: 2,
      title: "Legacy local plan",
      brief: "Keep old blocks intact.",
      blocks: [
        {
          id: "summary",
          type: "rich-text",
          data: { markdown: "Original summary." },
        },
        { id: "legacy-questions", type: "question-form", data: {} },
        { id: "legacy-tabs", type: "tabs", data: {} },
        { id: "legacy-model", type: "data-model", data: {} },
      ],
    });
    await writePlanLocalFolder({
      slug: "legacy-local-plan",
      planId: "local-legacy-local-plan",
      title: content.title ?? "Legacy local plan",
      brief: content.brief,
      content,
      url: "/local-plans/legacy-local-plan",
    });

    const result = await updateLocalPlanFolder.run({
      slug: "legacy-local-plan",
      contentPatches: [
        {
          op: "update-rich-text",
          blockId: "summary",
          markdown: "Updated summary.",
        },
      ],
    });
    const blocks = result.plan.content?.blocks;
    expect(blocks?.map((block) => block.type)).toEqual([
      "rich-text",
      "question-form",
      "tabs",
      "data-model",
    ]);

    const reread = await readPlanLocalFolder("legacy-local-plan");
    expect(reread.content.blocks.map((block) => block.type)).toEqual([
      "rich-text",
      "question-form",
      "tabs",
      "data-model",
    ]);
    expect(reread.content.blocks[0]).toMatchObject({
      id: "summary",
      type: "rich-text",
      data: { markdown: "Updated summary." },
    });
  });

  it("round-trips full content with unchanged stored legacy defaults", async () => {
    const content = storedPlanContentSchema.parse({
      version: 2,
      title: "Legacy local plan",
      brief: "Keep older blocks intact.",
      blocks: [
        {
          id: "summary",
          type: "rich-text",
          data: { markdown: "Original summary." },
        },
        { id: "legacy-questions", type: "question-form", data: {} },
        { id: "legacy-tabs", type: "tabs", data: {} },
        { id: "legacy-model", type: "data-model", data: {} },
      ],
    });
    await writePlanLocalFolder({
      slug: "legacy-full-update",
      planId: "local-legacy-full-update",
      title: content.title ?? "Legacy local plan",
      brief: content.brief,
      content,
      url: "/local-plans/legacy-full-update",
    });

    const replacement = storedPlanContentSchema.parse({
      ...content,
      blocks: content.blocks.map((block) =>
        block.id === "summary" && block.type === "rich-text"
          ? { ...block, data: { markdown: "Updated full content." } }
          : block,
      ),
    });
    const result = await updateLocalPlanFolder.run({
      slug: "legacy-full-update",
      content: replacement,
    });

    expect(result.plan.content?.blocks).toMatchObject([
      {
        id: "summary",
        type: "rich-text",
        data: { markdown: "Updated full content." },
      },
      {
        id: "legacy-questions",
        type: "question-form",
        data: { questions: [] },
      },
      { id: "legacy-tabs", type: "tabs", data: { tabs: [] } },
      { id: "legacy-model", type: "data-model", data: { entities: [] } },
    ]);
    const reread = await readPlanLocalFolder("legacy-full-update");
    expect(reread.content.blocks.map((block) => block.id)).toEqual(
      content.blocks.map((block) => block.id),
    );
  });

  it("migrates legacy full content before validating authored changes", async () => {
    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "legacy-full-content-update",
      planId: "local-legacy-full-content-update",
      title: content.title ?? "Checkout review",
      brief: content.brief,
      content,
      url: "/local-plans/legacy-full-content-update",
    });

    const result = await updateLocalPlanFolder.run({
      slug: "legacy-full-content-update",
      content: {
        title: "Migrated content",
        brief: "Legacy content shape.",
        blocks: [
          {
            id: "summary",
            type: "rich-text",
            data: { markdown: "Updated summary." },
          },
          {
            id: "legacy-wireframe",
            type: "sketch-wireframe",
            data: { regions: [] },
          },
          {
            id: "tabs",
            type: "tabs",
            data: {
              tabs: [
                {
                  label: "Overview",
                  blocks: [
                    {
                      type: "rich-text",
                      data: { markdown: "Migrated nested block." },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });

    expect(result.plan.content?.version).toBe(1);
    expect(result.plan.content?.blocks[1]?.type).toBe("legacy-wireframe");
    const tabs = result.plan.content?.blocks.find(
      (block) => block.id === "tabs",
    );
    expect(tabs).toMatchObject({
      type: "tabs",
      data: { tabs: [{ label: "Overview" }] },
    });
    if (tabs?.type !== "tabs") throw new Error("Expected migrated tabs.");
    expect(tabs.data.tabs[0]?.id).toEqual(expect.any(String));
    expect(tabs.data.tabs[0]?.blocks[0]?.id).toEqual(expect.any(String));
  });

  it("rejects newly authored empty blocks in a full local content update", async () => {
    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "new-empty-full-update",
      planId: "local-new-empty-full-update",
      title: content.title ?? "Checkout review",
      brief: content.brief,
      content,
      url: "/local-plans/new-empty-full-update",
    });
    const planPath = path.join(tmpDir, "new-empty-full-update", "plan.mdx");
    const originalPlanMdx = await fs.readFile(planPath, "utf-8");

    const replacement = storedPlanContentSchema.parse({
      ...content,
      blocks: [
        ...content.blocks,
        { id: "new-questions", type: "question-form", data: {} },
      ],
    });
    await expect(
      updateLocalPlanFolder.run({
        slug: "new-empty-full-update",
        content: replacement,
      }),
    ).rejects.toMatchObject({
      errorCode: "invalid_plan_content",
      statusCode: 422,
      message: expect.stringMatching(/require at least one questions entry/i),
    });
    expect(await fs.readFile(planPath, "utf-8")).toBe(originalPlanMdx);
  });

  it("blocks writes when a malformed source block was salvaged for reading", async () => {
    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "salvaged-source-write",
      planId: "local-salvaged-source-write",
      title: content.title ?? "Checkout review",
      brief: content.brief,
      content,
      url: "/local-plans/salvaged-source-write",
    });
    const planPath = path.join(tmpDir, "salvaged-source-write", "plan.mdx");
    const validSource = await fs.readFile(planPath, "utf-8");
    const malformedSource = `${validSource}\n<UnknownPlanBlock />\n`;
    await fs.writeFile(planPath, malformedSource, "utf-8");

    await expect(
      updateLocalPlanFolder.run({
        slug: "salvaged-source-write",
        title: "Changed title",
      }),
    ).rejects.toMatchObject({
      errorCode: "plan_source_salvage_write_blocked",
      statusCode: 422,
    });
    expect(await fs.readFile(planPath, "utf-8")).toBe(malformedSource);
  });

  it("rejects clearing a previously populated required field in a full update", async () => {
    const content = storedPlanContentSchema.parse({
      version: 2,
      blocks: [
        {
          id: "questions",
          type: "question-form",
          data: {
            questions: [{ id: "q1", title: "Question", mode: "freeform" }],
          },
        },
      ],
    });
    await writePlanLocalFolder({
      slug: "cleared-question-full-update",
      planId: "local-cleared-question-full-update",
      title: "Questions",
      brief: "Question form.",
      content,
      url: "/local-plans/cleared-question-full-update",
    });

    const replacement = storedPlanContentSchema.parse({
      ...content,
      blocks: [
        { id: "questions", type: "question-form", data: { questions: [] } },
      ],
    });
    await expect(
      updateLocalPlanFolder.run({
        slug: "cleared-question-full-update",
        content: replacement,
      }),
    ).rejects.toThrow(/require at least one questions entry/i);
  });

  it("writes back to an opened repo-relative local plan path", async () => {
    const repoRoot = path.join(tmpDir, "repo");
    process.env.PLAN_REPO_ROOT = repoRoot;
    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "checkout-review",
      path: "plans/checkout-review",
      planId: "local-checkout-review",
      title: content.title ?? "Checkout review",
      brief: content.brief,
      content,
      url: "/local-plans/checkout-review?path=plans%2Fcheckout-review",
    });

    const result = await updateLocalPlanFolder.run({
      slug: "checkout-review",
      path: "plans/checkout-review",
      contentPatches: [
        {
          op: "update-rich-text",
          blockId: "summary",
          markdown: "Edited in the repo folder.",
        },
      ],
    });

    expect(result.repoPath).toBe("plans/checkout-review");
    expect(result.path).toBe(
      "/local-plans/checkout-review?path=plans%2Fcheckout-review",
    );
    expect(result.folder).toBe(path.join(repoRoot, "plans/checkout-review"));

    const planMdx = await fs.readFile(
      path.join(repoRoot, "plans/checkout-review", "plan.mdx"),
      "utf-8",
    );
    expect(planMdx).toContain("Edited in the repo folder.");
  });

  it("refuses to write outside local Plan runtime", async () => {
    process.env.PLAN_LOCAL_MODE = "0";
    await expect(
      updateLocalPlanFolder.run({ slug: "checkout-review" }),
    ).rejects.toThrow(/only available in local Plan runtime/);
  });
});
