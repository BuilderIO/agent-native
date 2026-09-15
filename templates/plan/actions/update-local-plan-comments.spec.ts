import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writePlanLocalFolder } from "../server/lib/local-plan-files.js";
import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
import updateLocalPlanComments from "./update-local-plan-comments.js";

function sampleContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Checkout recap",
    brief: "Local MDX recap.",
    blocks: [
      {
        id: "summary",
        type: "rich-text",
        title: "Summary",
        data: { markdown: "Original local recap text." },
      },
    ],
  });
}

describe("update-local-plan-comments", () => {
  let tmpDir: string;
  let savedDir: string | undefined;
  let savedMode: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedAuthMode: string | undefined;
  let savedRepoRoot: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-comments-action-"));
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

  it("preserves local recap kind when saving comments", async () => {
    const content = sampleContent();
    await writePlanLocalFolder({
      slug: "checkout-recap",
      planId: "local-checkout-recap",
      title: content.title ?? "Checkout recap",
      brief: content.brief,
      content,
      url: "/local-plans/checkout-recap",
    });
    await fs.writeFile(
      path.join(tmpDir, "checkout-recap", ".plan-state.json"),
      `${JSON.stringify({ kind: "recap" }, null, 2)}\n`,
      "utf-8",
    );

    const result = await updateLocalPlanComments.run({
      slug: "checkout-recap",
      comments: [
        {
          kind: "annotation",
          status: "open",
          message: "Please follow up on this local recap.",
          anchor: JSON.stringify({ kind: "block", blockId: "summary" }),
          createdBy: "human",
        },
      ],
    });

    expect(result.localOnly).toBe(true);
    expect(result.plan.kind).toBe("recap");
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
      message: "Please follow up on this local recap.",
      resolutionTarget: "agent",
    });
  });
});
