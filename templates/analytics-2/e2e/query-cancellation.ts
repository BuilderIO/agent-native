import { randomUUID } from "node:crypto";

import {
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { z } from "zod";

import { safeErrorDiagnostic } from "./failure-diagnostic.js";
import { shellRouteDiagnostic } from "./shell-route-diagnostic.js";

// This fixture controls the query transport, not a warehouse or server persistence.
export async function checkQueryCancellation(
  page: Page,
  context: BrowserContext,
  base: string,
  workspaceId: string,
) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  async function action(
    name: string,
    input: Record<string, string>,
    method = "POST",
  ) {
    const query = method === "GET" ? `?${new URLSearchParams(input)}` : "";
    const response = await context.request.fetch(
      `${base}/_agent-native/actions/${name}${query}`,
      { method, headers, ...(method === "POST" ? { data: input } : {}) },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  }
  const shell = z
    .object({
      user: z.object({ email: z.string() }),
      workspace: z.object({ id: z.string() }),
    })
    .parse(await action("get-workspace-shell", {}, "GET"));
  expect(shell.user.email).toBe("qa-fleet@builder.io");
  expect(shell.workspace.id).toBe(workspaceId);
  const project = z.object({ id: z.string(), href: z.string() }).parse(
    await action("create-project", {
      title: `QA cancellation ${randomUUID()}`,
      sampleDataset: "orders",
    }),
  );
  async function cleanup() {
    await action("trash-project", { projectId: project.id });
    await action("delete-project", { projectId: project.id });
    const readback = await context.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: project.id })}`,
      { headers },
    );
    expect(readback.status()).toBe(404);
  }
  const document = await (async () =>
    z
      .object({
        project: z.object({
          cells: z.array(
            z.object({
              id: z.string(),
              contents: z.object({ kind: z.string() }).passthrough(),
            }),
          ),
        }),
      })
      .parse(
        await action("get-project", { projectId: project.id }, "GET"),
      ))().catch(async (error: unknown) => {
    await cleanup();
    throw error;
  });
  const selectedCellId = document.project.cells.find(
    (cell) => cell.contents.kind === "sql",
  )?.id;
  if (!selectedCellId) {
    await cleanup();
    throw new Error("Cancellation fixture has no SQL cell");
  }
  const cellId: string = selectedCellId;
  let requestId = "";
  let runId = "";
  let startSeen = false;
  let releaseStart = () => {};
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let releaseCancel = () => {};
  let cancelGate: Promise<void> = Promise.resolve();
  const holdCancel = () => {
    cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
  };
  let completionRace = false;
  let state:
    | "unregistered"
    | "running"
    | "cancelling"
    | "cancelled"
    | "complete" = "unregistered";
  let snapshot: Record<string, unknown> = {};
  let attemptId = "";
  let outputGeneration = "";
  let resultId = "";
  let sequence = 1;
  const events: Array<{
    runId: string;
    sequence: string;
    event: { type: "attempt"; receipt: Record<string, unknown> };
  }> = [];
  let statusPolls = 0;
  let stopCalls = 0;
  let routeFailure: Error | undefined;
  let stage = "setup";
  let assertionStarted = 0;
  const inFlight = new Set<Promise<void>>();
  const transport: Array<{
    action: string;
    stage: string;
    startedAt: number;
    elapsedMs?: number;
    outcome?: "complete" | "failed";
    upstreamStatus?: number;
  }> = [];
  const matcher = (url: URL) =>
    [
      "get-actions-batch",
      "get-notebook-execution",
      "get-notebook-run",
      "get-notebook-result-page",
      "start-notebook-run",
      "cancel-notebook-run",
    ].some((name) => url.pathname.endsWith(`/_agent-native/actions/${name}`));
  const attemptState = () =>
    state === "complete"
      ? { status: "complete", resultIds: [resultId] }
      : { status: state === "cancelled" ? "cancelled" : "running" };
  const attempt = () => ({
    attempt: {
      cellId,
      outputGeneration,
      namespaceId: z
        .object({ namespace: z.object({ namespaceId: z.string() }) })
        .parse(snapshot).namespace.namespaceId,
      runId,
      attemptId,
    },
    state: attemptState(),
  });
  const receipt = () => ({
    status: "admitted",
    runId,
    request: {
      snapshot,
      requestId,
      cache: "reuse",
      mode: "cell-only",
      targetCellId: cellId,
      staleValues: "allow-compatible",
    },
    startedAt: new Date().toISOString(),
    plan: {
      admittedCellIds: [cellId],
      dependencyResultIds: [],
      rejectedCells: [],
    },
    attempts: [attempt()],
    cursor: String(sequence),
  });
  function transition(next: typeof state) {
    state = next;
    events.push({
      runId,
      sequence: String(++sequence),
      event: { type: "attempt", receipt: attempt() },
    });
  }
  const terminal = () => state === "cancelled" || state === "complete";
  function patchExecution(value: unknown) {
    const body = z
      .object({
        status: z.literal("found"),
        activeRunIds: z.array(z.string()),
        cells: z.record(z.string(), z.unknown()),
      })
      .passthrough()
      .parse(value);
    if (state === "unregistered") return body;
    body.activeRunIds = terminal() ? [] : [runId];
    body.cells[cellId] = {
      stale: false,
      resultId: state === "complete" ? resultId : null,
      attempt: attempt(),
      finishedAt: terminal() ? new Date().toISOString() : null,
    };
    return body;
  }
  function resultPage() {
    const ref = z.object({ ref: z.unknown() }).parse(snapshot) as {
      ref: unknown;
    };
    return {
      status: "ready",
      manifest: {
        status: "complete",
        rowCount: "1",
        fields: [
          { fieldId: "0", name: "result", type: "string", nullable: true },
        ],
        result: {
          resultId,
          snapshot: ref.ref,
          producer: { ...attempt().attempt, exportId: "result" },
          inputRevision: "0",
          dependencyFingerprint: "qa-cancellation",
          kernelGeneration: null,
          sourceGeneration: null,
        },
      },
      page: 1,
      rows: [["completed-row"]],
      view: { page: 1, viewRevision: "0" },
    };
  }
  async function handle(
    route: Route,
    fulfill: (options: Parameters<Route["fulfill"]>[0]) => Promise<void>,
    recordStatus: (status: number) => void,
  ) {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/start-notebook-run")) {
      const input = z
        .object({
          snapshot: z.record(z.string(), z.unknown()),
          requestId: z.string().min(1),
          mode: z.string(),
          targetCellId: z.string(),
        })
        .passthrough()
        .parse(route.request().postDataJSON());
      expect(input.targetCellId).toBe(cellId);
      requestId = input.requestId;
      snapshot = input.snapshot;
      startSeen = true;
      await startGate;
      runId = randomUUID();
      attemptId = randomUUID();
      outputGeneration = randomUUID();
      resultId = randomUUID();
      await fulfill({ json: receipt() });
      return;
    }
    if (url.pathname.endsWith("/cancel-notebook-run")) {
      const input = z
        .object({ runId: z.string(), cellId: z.string().optional() })
        .strict()
        .parse(route.request().postDataJSON());
      expect(input.runId).toBe(runId);
      if (input.cellId) expect(input.cellId).toBe(cellId);
      expect(state).toBe("running");
      stopCalls++;
      await cancelGate;
      if (completionRace) {
        transition("complete");
        await fulfill({
          json: { status: "completed", reason: "completion_won" },
        });
      } else {
        transition("cancelling");
        await fulfill({ json: { status: "pending" } });
      }
      return;
    }
    if (url.pathname.endsWith("/get-notebook-run")) {
      const input = z
        .object({ runId: z.string(), after: z.string().optional() })
        .parse(Object.fromEntries(url.searchParams));
      expect(input.runId).toBe(runId);
      statusPolls++;
      const after = BigInt(input.after ?? "0");
      await fulfill({
        json: {
          status: "found",
          run: receipt(),
          events: events.filter((item) => BigInt(item.sequence) > after),
          building: [],
          nextCursor: String(sequence),
        },
      });
      return;
    }
    if (
      url.pathname.endsWith("/get-notebook-result-page") &&
      url.searchParams.get("resultId") === resultId &&
      state === "complete"
    ) {
      await fulfill({ json: resultPage() });
      return;
    }
    const actual = await route.fetch();
    recordStatus(actual.status());
    if (!actual.ok())
      throw new Error(`Notebook fixture read: HTTP ${actual.status()}`);
    if (url.pathname.endsWith("/get-actions-batch")) {
      const request = z
        .object({
          requests: z.array(
            z.object({ action: z.string(), query: z.string() }),
          ),
        })
        .parse(route.request().postDataJSON());
      const body = z
        .object({
          results: z.array(
            z
              .object({ status: z.number(), body: z.unknown().optional() })
              .passthrough(),
          ),
        })
        .passthrough()
        .parse(await actual.json());
      expect(body.results).toHaveLength(request.requests.length);
      for (const [index, item] of request.requests.entries()) {
        if (
          item.action !== "get-notebook-execution" ||
          new URLSearchParams(item.query).get("projectId") !== project.id
        )
          continue;
        const result = body.results.at(index);
        if (!result || result.status >= 400)
          throw new Error("Owned notebook execution batch read failed");
        result.body = patchExecution(result.body);
      }
      await fulfill({ response: actual, json: body });
    } else if (
      url.pathname.endsWith("/get-notebook-execution") &&
      url.searchParams.get("projectId") === project.id
    )
      await fulfill({
        response: actual,
        json: patchExecution(await actual.json()),
      });
    else await fulfill({ response: actual });
  }
  const handler = (route: Route) => {
    let claimed = false;
    const requestStage = stage;
    const entry: (typeof transport)[number] = {
      action:
        new URL(route.request().url()).pathname.split("/").at(-1) ?? "unknown",
      stage: requestStage,
      startedAt: Date.now(),
    };
    transport.push(entry);
    if (transport.length > 60) transport.shift();
    const fulfill = (options: Parameters<Route["fulfill"]>[0]) => {
      claimed = true;
      return route.fulfill(options);
    };
    const task = handle(route, fulfill, (status) => {
      entry.upstreamStatus = status;
    })
      .then(() => {
        entry.outcome = "complete";
      })
      .catch(async (error: unknown) => {
        entry.outcome = "failed";
        if (!routeFailure) {
          routeFailure =
            error instanceof Error
              ? error
              : new Error("Cancellation transport failed");
          const method =
            routeFailure.message.match(
              /^(route\.(?:fetch|fulfill|abort|continue)):/,
            )?.[1] ?? "other";
          const line =
            routeFailure.stack?.match(
              /query-cancellation\.ts:(\d+):\d+/,
            )?.[1] ?? "unknown";
          console.error(
            `CANCELLATION ORIGINAL stage=${requestStage} observed=${stage} method=${method} file=query-cancellation.ts:${line}`,
          );
        }
        if (!claimed) {
          try {
            await route.abort();
          } catch {
            console.error("CANCELLATION ROUTE ABORT FAILED");
          }
        }
      })
      .finally(() => {
        entry.elapsedMs = Date.now() - entry.startedAt;
      });
    inFlight.add(task);
    void task.finally(() => inFlight.delete(task));
    return task;
  };
  try {
    await page.route(matcher, handler);
    await page.addInitScript(`(() => {
      const started = performance.now();
      const sample = () => {
        const editor = document.querySelector('[data-notebook-cell] .nb-sql-editor .cm-content, [data-notebook-cell] textarea.nb-cell-source');
        if (editor && editor.getClientRects().length) {
          window.__cancellationEditorVisibleMs = performance.now() - started;
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })()`);
    stage = "open";
    await page.goto(`${base}${project.href}`, {
      waitUntil: "domcontentloaded",
    });
    stage = "editor-visible";
    const editor = page
      .locator(
        "[data-notebook-cell] .nb-sql-editor .cm-content, [data-notebook-cell] textarea.nb-cell-source",
      )
      .first();
    assertionStarted = Date.now();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    console.log(
      `CANCELLATION EDITOR ASSERTION ms=${Date.now() - assertionStarted}`,
    );
    stage = "register";
    await expect
      .poll(
        async () => {
          if (!startSeen) await editor.press("ControlOrMeta+Enter");
          return startSeen;
        },
        { timeout: 20000, intervals: [1000] },
      )
      .toBe(true);
    const stop = page.getByRole("button", { name: /^Stop / });
    await expect(stop).toHaveCount(0);
    expect(stopCalls).toBe(0);
    holdCancel();
    releaseStart();
    await expect.poll(() => runId).not.toBe("");
    transition("running");
    await expect(stop).toBeEnabled();
    stage = "stop";
    await stop.click();
    await expect.poll(() => stopCalls).toBe(1);
    const cancelling = page.getByRole("button", {
      name: "Cancelling",
      exact: true,
    });
    await expect(cancelling).toBeDisabled();
    await expect(cancelling).toHaveAttribute("aria-busy", "true");
    await expect(stop).toHaveCount(0);
    releaseCancel();
    await expect.poll(() => state).toBe("cancelling");
    await expect.poll(() => statusPolls).toBeGreaterThan(0);
    stage = "pending-reload";
    const pollsBeforeReload = statusPolls;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => statusPolls, { timeout: 30_000 })
      .toBeGreaterThan(pollsBeforeReload);
    await expect(stop).toBeEnabled();
    expect(stopCalls).toBe(1);
    transition("cancelled");
    stage = "interrupted-visible";
    const run = page.getByRole("button", { name: /^Run / });
    const assertCancelled = async () => {
      await expect(run.first()).toBeEnabled();
      await expect(stop).toHaveCount(0);
      await expect(
        page.getByText("Your query could not be executed", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("completed-row", { exact: true }),
      ).toHaveCount(0);
    };
    await assertCancelled();
    stage = "interrupted-reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertCancelled();
    stage = "interrupted-stop-count";
    expect(stopCalls).toBe(1);
    stage = "completion-race";
    requestId = randomUUID();
    runId = randomUUID();
    attemptId = randomUUID();
    outputGeneration = randomUUID();
    resultId = randomUUID();
    events.length = 0;
    completionRace = true;
    holdCancel();
    releaseCancel();
    transition("running");
    stage = "completion-race-reload-running";
    await page.reload({ waitUntil: "domcontentloaded" });
    stage = "completion-race-stop-visible";
    await expect(stop).toBeVisible();
    stage = "completion-race-stop-click";
    await stop.click();
    stage = "completion-race-stop-request";
    await expect.poll(() => stopCalls).toBe(2);
    stage = "completion-race-result-visible";
    await expect(
      page.getByText("completed-row", { exact: true }),
    ).toBeVisible();
    stage = "completion-race-reload-result";
    await page.reload({ waitUntil: "domcontentloaded" });
    stage = "completion-race-result-readback";
    await expect(
      page.getByText("completed-row", { exact: true }),
    ).toBeVisible();
    stage = "completion-race-no-interrupted";
    await expect(
      page.getByText("Your query was interrupted", { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: ".tmp/analytics-owner/query-cancellation-transport.png",
    });
  } catch (error) {
    console.error(
      `CANCELLATION FAILURE stage=${stage} ${safeErrorDiagnostic(error)}`,
    );
    console.error("CANCELLATION TRANSPORT", JSON.stringify(transport));
    let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const editors = page.locator(
            "[data-notebook-cell] .nb-sql-editor .cm-content, [data-notebook-cell] textarea.nb-cell-source",
          );
          const count = await editors.count();
          const cdpStarted = Date.now();
          const visibleMs = await page.evaluate(
            () =>
              (window as Window & { __cancellationEditorVisibleMs?: number })
                .__cancellationEditorVisibleMs ?? null,
          );
          console.error(
            "CANCELLATION EDITOR",
            JSON.stringify({
              count,
              visible: count > 0 && (await editors.first().isVisible()),
              visibleMs,
              cdpRoundTripMs: Date.now() - cdpStarted,
              assertionElapsedMs: assertionStarted
                ? Date.now() - assertionStarted
                : null,
            }),
          );
          console.error(
            "CANCELLATION SHELL",
            JSON.stringify({
              ...shellRouteDiagnostic(page.url(), base, project.id),
              readyState: await page.evaluate(() => document.readyState),
            }),
          );
          await page.screenshot({
            path: ".tmp/analytics-owner/turn132x-cancellation-failure.png",
          });
        })(),
        new Promise<never>((_, reject) => {
          diagnosticTimer = setTimeout(
            () => reject(new Error("Cancellation diagnostic timed out")),
            3000,
          );
        }),
      ]);
    } catch (diagnosticError) {
      console.error(
        "CANCELLATION diagnostic unavailable",
        safeErrorDiagnostic(diagnosticError),
      );
    } finally {
      clearTimeout(diagnosticTimer);
    }
    throw error;
  } finally {
    stage = "cleanup";
    releaseStart();
    await page.unrouteAll({ behavior: "wait" });
    await Promise.all(inFlight);
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await cleanup();
    if (routeFailure) throw routeFailure;
  }
}
