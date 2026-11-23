import { randomUUID } from "node:crypto";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import {
  getRunTurnRef,
  runWithRequestContext,
} from "@agent-native/core/server";
import { z } from "zod";

import { registerChatThreadsShareable } from "../../../../packages/core/dist/chat-threads/store.js";
import saveProjectCell from "../../actions/save-project-cell";
import { projectDocumentWithLayoutSchema } from "../../shared/project-document";
import { open, seed, stored } from "./dash.helpers";
import { expect, test } from "./fixtures";
import { cellAt, editorOf } from "./notebook.helpers";

let reviewProjectId: string | undefined;
test.afterEach(async ({ daily }) => {
  try {
    if (reviewProjectId) {
      const projectId = reviewProjectId;
      reviewProjectId = undefined;
      daily.createdProjects.delete(projectId);
      await daily.cleanupProject(projectId);
      const response = await daily.context.request.get(
        `${daily.server.base}/_agent-native/actions/get-project`,
        { params: { projectId } },
      );
      expect(response.status(), "review project cleanup readback").toBe(404);
      expect(await response.json()).toMatchObject({
        error: "That project is not in this workspace.",
      });
    }
  } finally {
    await closeDbExec();
  }
});

test("report 1794948257.991429: review agent SQL edits without losing a user's draft", async ({
  daily,
}) => {
  const stage = (name: string) => {
    daily.steps.push(`SQL review: ${name}`);
    console.log(`SQL_REVIEW_STAGE ${name}`);
  };
  stage("identity");
  registerChatThreadsShareable();
  const identity = z
    .object({
      user: z.object({ email: z.literal("qa-fleet@builder.io") }),
      workspace: z.object({ id: z.string().min(1) }),
    })
    .parse(await daily.action("get-workspace-shell", {}, "GET"));
  const nb = await seed(daily, [{ kind: "sql", text: "select 1" }]);
  reviewProjectId = nb.id;
  stage("open");
  await open(daily, nb);
  const cell = cellAt(daily.page, 0);
  const accepted = async () =>
    z
      .object({ project: projectDocumentWithLayoutSchema })
      .parse(await daily.action("get-project", { projectId: nb.id }, "GET"))
      .project;
  const head = (await accepted()).draftHead;
  if (!head) throw new Error("Expected the accepted draft head");
  const { threadId } = z.object({ threadId: z.string() }).parse(
    await daily.action("create-notebook-thread", {
      projectId: nb.id,
      head,
      opId: randomUUID(),
    }),
  );
  const runId = randomUUID();
  const turnId = randomUUID();
  await getRunTurnRef(runId);
  await getDbExec().execute({
    sql: "INSERT INTO agent_runs (id, thread_id, status, started_at, turn_id) VALUES (?, ?, 'completed', ?, ?)",
    args: [runId, threadId, Date.now(), turnId],
  });
  await daily.open(
    `/project/${nb.id}/latest?threadId=${encodeURIComponent(threadId)}`,
  );
  const proposal = daily.page.locator("[data-notebook-proposal]");
  const propose = async (source: string) => {
    stage(`propose ${source}`);
    const target = (await accepted()).cells[0];
    if (!target || target.contents.kind !== "sql")
      throw new Error("Expected SQL fixture");
    await runWithRequestContext(
      {
        userEmail: identity.user.email,
        authUserId: identity.user.email,
        orgId: identity.workspace.id,
        userName: "QA",
        isSyntheticTraffic: true,
      },
      () =>
        saveProjectCell.run(
          {
            projectId: nb.id,
            cellId: target.id,
            contents: { ...target.contents, source },
            expectedUpdatedAt: target.updatedAt,
          },
          {
            caller: "tool",
            userEmail: identity.user.email,
            orgId: identity.workspace.id,
            appId: "analytics-2",
            threadId,
            runId,
            turnId,
            toolCallId: randomUUID(),
          },
        ),
    );
    await daily.reload();
    await expect(proposal).toBeVisible();
    stage(`proposal visible ${source}`);
  };
  await propose("select 2");
  await expect(proposal).toContainText("select 1");
  await expect(proposal).toContainText("select 2");
  await daily.page.screenshot({
    path: ".tmp/analytics-owner/s5-review-pending.png",
  });
  await daily.open(`/project/${nb.id}/latest`);
  await expect(proposal).toHaveCount(0);
  await expect(editorOf(cell)).toContainText("select 1");
  await daily.open(
    `/project/${nb.id}/latest?threadId=${encodeURIComponent(threadId)}`,
  );
  await proposal.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(proposal).toHaveCount(0);
  await daily.reload();
  expect((await stored(daily, nb.id))[0]?.source).toBe("select 1");
  stage("undone proposal persisted");

  await propose("select 3");
  const humanCell = (await accepted()).cells[0];
  if (!humanCell || humanCell.contents.kind !== "sql")
    throw new Error("Expected SQL fixture");
  await daily.action("save-project-cell", {
    projectId: nb.id,
    cellId: humanCell.id,
    contents: { ...humanCell.contents, source: "select 4" },
    expectedUpdatedAt: humanCell.updatedAt,
  });
  await expect
    .poll(async () => (await stored(daily, nb.id))[0]?.source)
    .toBe("select 4");
  stage("user edit persisted");
  await daily.reload();
  await expect(
    proposal.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeDisabled();
  await proposal.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(proposal).toHaveCount(0);
  await propose("select 5");
  const confirmAll = daily.page
    .locator(".nb-pending-panel")
    .getByRole("button", { name: "Confirm all", exact: true });
  await confirmAll.click();
  await expect(daily.page.getByText("Saved a version")).toBeVisible();
  await expect(proposal).toHaveCount(0);
  await daily.reload();
  await expect(editorOf(cell)).toContainText("select 5");
  expect((await stored(daily, nb.id))[0]?.source).toBe("select 5");
  stage("confirmed proposal persisted");
  await daily.page.screenshot({
    path: ".tmp/analytics-owner/s5-review-after.png",
  });
});
