import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { projectDocumentSchema } from "../app/lib/model/contracts.js";

export async function checkSqlAgentReview(
  page: Page,
  base: string,
  databaseUrl: string,
) {
  const stage = (name: string) => console.log(`SQL_REVIEW_STAGE ${name}`);
  stage("validate fixture");
  const url = new URL(databaseUrl);
  const appUrl = new URL(base);
  if (
    appUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(appUrl.hostname) ||
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "qa_analytics2" ||
    url.pathname !== "/qa_analytics2" ||
    process.env.DATABASE_URL !== databaseUrl
  )
    throw new Error("SQL review requires the isolated local QA database");
  stage("import server");
  const { runWithRequestContext } = await import("@agent-native/core/server");
  const { registerChatThreadsShareable } =
    await import("../../../packages/core/dist/chat-threads/store.js");
  registerChatThreadsShareable();
  stage("import database");
  const { closeDbExec, getDbExec } = await import("@agent-native/core/db");
  stage("import cell action");
  const { default: saveProjectCell } =
    await import("../actions/save-project-cell.js");
  stage("navigate home");
  await page.goto(base, { waitUntil: "load" });
  stage("wait for home network idle");
  await page.waitForLoadState("networkidle");
  stage("read identity");
  const action = async (
    name: string,
    data: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ) => {
    const result = await page.evaluate(
      async ([actionName, payload, verb]) => {
        const endpoint = `/_agent-native/actions/${actionName}`;
        const headers = {
          "x-agent-native-frontend": "1",
          "x-agent-native-csrf": "1",
          "content-type": "application/json",
        };
        const response =
          verb === "GET"
            ? await fetch(
                `${endpoint}?${new URLSearchParams(
                  Object.entries(JSON.parse(payload)).map(([k, v]) => [
                    k,
                    typeof v === "string" ? v : JSON.stringify(v),
                  ]),
                )}`,
                { headers, credentials: "same-origin" },
              )
            : await fetch(endpoint, {
                method: "POST",
                headers,
                credentials: "same-origin",
                body: payload,
              });
        return {
          ok: response.ok,
          status: response.status,
          body: await response.json(),
        };
      },
      [name, JSON.stringify(data), method] as const,
    );
    if (!result.ok) throw new Error(`${name}: HTTP ${result.status}`);
    return result.body;
  };
  const identity = z
    .object({
      user: z.object({ email: z.literal("qa-fleet@builder.io") }),
      workspace: z.object({ id: z.string().min(1) }),
    })
    .parse(await action("get-workspace-shell", {}, "GET"));
  stage("create project");
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(
      await action("create-project", { title: `SQL review ${randomUUID()}` }),
    );
  const read = async () =>
    z
      .object({ project: projectDocumentSchema })
      .parse(await action("get-project", { projectId: id }, "GET")).project;
  let primaryError: unknown;
  try {
    stage("create SQL cell");
    await action("add-project-cell", {
      projectId: id,
      kind: "sql",
      source: "select 1",
    });
    const head = z
      .object({
        notebook: z.object({ snapshot: z.object({ head: z.unknown() }) }),
      })
      .parse(await action("get-project", { projectId: id }, "GET")).notebook
      .snapshot.head;
    stage("create thread");
    const { threadId } = z.object({ threadId: z.string().min(1) }).parse(
      await action("create-notebook-thread", {
        projectId: id,
        head,
        opId: randomUUID(),
      }),
    );
    const runId = randomUUID();
    const turnId = randomUUID();
    stage("insert run");
    await getDbExec().execute({
      sql: "INSERT INTO agent_runs (id, thread_id, turn_id, status, started_at) VALUES (?, ?, ?, 'running', 1)",
      args: [runId, threadId, turnId],
    });
    stage("open project");
    await page.goto(
      `${base}/project/${encodeURIComponent(id)}/latest?threadId=${encodeURIComponent(threadId)}`,
      {
        waitUntil: "domcontentloaded",
      },
    );
    const slot = page.locator(".nb-cell-slot").first();
    const editor = slot.getByRole("textbox", { name: /^Edit / });
    const proposal = page.locator("[data-notebook-proposal]");
    await expect(editor).toBeVisible();
    const propose = async (source: string) => {
      const cell = (await read()).cells[0];
      if (!cell || cell.contents.kind !== "sql")
        throw new Error("Expected SQL cell");
      const contents = cell.contents;
      stage(`save proposal ${source}`);
      const result = await runWithRequestContext(
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
              projectId: id,
              cellId: cell.id,
              contents: { ...contents, source },
              expectedUpdatedAt: cell.updatedAt,
            },
            {
              caller: "tool",
              threadId,
              runId,
              turnId,
              toolCallId: randomUUID(),
              userEmail: identity.user.email,
              orgId: identity.workspace.id,
              appId: "analytics-2",
            },
          ),
      );
      expect(result.editStatus).toBe("pending_review");
      stage(`reload proposal ${source}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      stage(`wait for proposal ${source}`);
      await expect(proposal).toContainText(source);
    };
    stage("propose select 2");
    await propose("select 2");
    console.log("SQL_REVIEW_STAGE proposal visible");
    await page.screenshot({
      path: ".tmp/analytics-owner/sql-review-proposed.png",
    });
    await proposal.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await read()).cells[0]?.contents).toMatchObject({
      source: "select 1",
    });
    await propose("select 3");
    const humanCell = (await read()).cells[0];
    if (!humanCell || humanCell.contents.kind !== "sql")
      throw new Error("Expected SQL cell");
    await action("save-project-cell", {
      projectId: id,
      cellId: humanCell.id,
      contents: { ...humanCell.contents, source: "select 4" },
      expectedUpdatedAt: humanCell.updatedAt,
    });
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ source: "select 4" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      proposal.getByRole("button", { name: "Confirm", exact: true }),
    ).toBeDisabled();
    await proposal.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await propose("select 5");
    await proposal
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(proposal).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor).toContainText("select 5");
    const contents = (await read()).cells[0]?.contents;
    expect(contents).toMatchObject({ source: "select 5" });
    if (contents?.kind !== "sql" || contents.pendingEdit)
      throw new Error("Accepted proposal remains pending");
    await page.screenshot({
      path: ".tmp/analytics-owner/sql-review-accepted.png",
    });
    console.log("SQL_REVIEW_STAGE accepted proposal persisted");
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    stage("cleanup");
    const cleanupErrors: unknown[] = [];
    try {
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
      await action("trash-project", { projectId: id });
      await action("delete-project", { projectId: id });
      const deletedResponse = await page.request.get(
        `${base}/_agent-native/actions/get-project`,
        {
          headers: {
            "x-agent-native-frontend": "1",
            "x-agent-native-csrf": "1",
          },
          params: { projectId: id },
        },
      );
      expect(deletedResponse.status()).toBe(404);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await closeDbExec();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
        "SQL review cleanup failed",
      );
  }
}
