import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writePlanLocalFolder } from "../server/lib/local-plan-files.js";
import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
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
