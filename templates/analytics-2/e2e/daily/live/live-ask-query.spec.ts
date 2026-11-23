import { randomUUID } from "node:crypto";

import { safeRequest } from "../../safe-request.js";
import { expect, test } from "./fixtures";

test("report K-ANA-4-1: a fresh chat resolves 'that query' with no project open", async ({
  page,
  context,
  base,
}) => {
  test.setTimeout(300_000);
  const tag = randomUUID().slice(0, 8);
  const queryTitle = `QA K-ANA-4-1 orders ${tag}`;
  const action = async (
    name: string,
    body: Record<string, unknown>,
    method: "GET" | "POST" = "POST",
  ) => {
    const url = `${base}/_agent-native/actions/${name}`;
    const response = await safeRequest(`${method} ${name}`, () =>
      method === "GET"
        ? context.request.get(url, { params: body as Record<string, string> })
        : context.request.post(url, { data: body }),
    );
    if (!response.ok())
      throw new Error(
        `${name} HTTP ${response.status()}: ${(await response.text()).slice(0, 300)}`,
      );
    return await response.json();
  };
  const cell = {
    label: null,
    hidden: false,
    gridX: 0,
    gridY: 0,
    gridWidth: 6,
    gridHeight: 2,
    kind: "sql",
    source:
      "select order_date from (values (date '2023-03-01'), (date '2024-03-01')) as t(order_date)",
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: "data",
    outputResult: true,
  };
  page.on("response", async (response) => {
    if (response.url().includes("/_agent-native/agent-chat") && !response.ok())
      console.log(
        `AGENT CHAT HTTP ${response.status()}: ${(await response.text().catch(() => "")).slice(0, 400)}`,
      );
  });
  const created: string[] = [];
  let threadId: string | null = null;
  try {
    const query = await action("create-project", {
      requestId: randomUUID(),
      title: queryTitle,
      starter: { kind: "cells", cells: [cell] },
    });
    created.push(query.id);
    const empty = await action("create-project", {
      requestId: randomUUID(),
      title: `QA K-ANA-4-1 empty ${tag}`,
    });
    created.push(empty.id);

    await page.goto(`${base}/home/data`);
    await expect(page).toHaveURL(/\/home\/data/);
    await page.getByRole("button", { name: "Thread", exact: true }).click();
    const editor = page
      .locator(
        '[data-agent-composer-slot="editor-input"][contenteditable="true"]',
      )
      .last();
    await expect(editor).toBeEditable();
    await editor.fill("change that query to only include 2025");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page).toHaveURL(/\/thread\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    threadId = new URL(page.url()).pathname.split("/").at(-1) ?? null;

    const replies = page.locator(
      'article.agentkit-message[data-role="assistant"]',
    );
    await expect(replies.first()).toBeVisible({ timeout: 120_000 });
    let last = "";
    let stableSince = Date.now();
    await expect
      .poll(
        async () => {
          const text = (await replies.allInnerTexts()).join("\n").trim();
          if (text !== last) {
            last = text;
            stableSince = Date.now();
          }
          return text.length > 0 && Date.now() - stableSince > 15_000;
        },
        { timeout: 200_000, intervals: [2_000] },
      )
      .toBe(true);
    console.log(`AGENT REPLY: ${last}`);

    expect(last).not.toMatch(/which (project|query)|no project (is )?open/i);
    const project = await action("get-project", { projectId: query.id }, "GET");
    expect(JSON.stringify(project)).toContain("2025");
  } finally {
    if (threadId)
      await action("delete-thread", { threadId }).catch(() => undefined);
    for (const projectId of created) {
      await action("trash-project", { projectId }).catch(() => undefined);
      await action("delete-project", { projectId }).catch(() => undefined);
    }
  }
});
