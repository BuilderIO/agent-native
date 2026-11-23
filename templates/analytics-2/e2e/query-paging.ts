import { randomUUID } from "node:crypto";

import {
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { z } from "zod";

import { safeErrorDiagnostic } from "./failure-diagnostic.js";

export async function checkEmptyQueryContinuation({
  page,
  context,
  base,
  workspaceId,
}: {
  page: Page;
  context: BrowserContext;
  base: string;
  workspaceId: string;
}) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const action = async (
    name: string,
    input: Record<string, string>,
    method = "POST",
  ) => {
    const query = method === "GET" ? `?${new URLSearchParams(input)}` : "";
    const response = await context.request.fetch(
      `${base}/_agent-native/actions/${name}${query}`,
      {
        method,
        headers,
        ...(method === "POST" ? { data: input } : {}),
      },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
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
      title: `QA empty continuation ${randomUUID()}`,
      sampleDataset: "orders",
    }),
  );
  let routeInstalled = false;
  let state: "initial" | "terminal" | "unavailable" = "initial";
  let intercepted = 0;
  let barrier: { promise: Promise<void>; release: () => void } | undefined;
  const armBarrier = () => {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    barrier = { promise, release };
  };
  const releaseBarrier = () => {
    barrier?.release();
    barrier = undefined;
  };
  const matcher = (url: URL) =>
    url.pathname.endsWith("/_agent-native/actions/get-notebook-result-page");
  const pageBody = z
    .object({
      status: z.literal("ready"),
      manifest: z
        .object({ fields: z.array(z.object({}).passthrough()).min(1) })
        .passthrough(),
      page: z.number(),
      rows: z.array(z.array(z.unknown())),
      view: z.object({}).passthrough(),
    })
    .passthrough();
  const patchPage = async (url: URL, value: unknown) => {
    const requested = url.searchParams.get("page");
    const resultId = z.string().parse(url.searchParams.get("resultId"));
    if (requested !== null && requested !== "1") {
      await barrier?.promise;
      intercepted++;
      if (state === "terminal")
        return { status: "out_of_range", resultId, lastPage: 1 };
      if (state === "unavailable")
        return { status: "unreadable", reason: "read_failed" };
      return value;
    }
    const body = pageBody.parse(value);
    const [field] = body.manifest.fields;
    body.manifest.fields = [
      { ...field, name: "fixture_value", type: "string" },
    ];
    body.rows = Array.from({ length: 50 }, (_, i) => [`owned-row-${i}`]);
    intercepted++;
    return body;
  };
  let routeFailure: Error | undefined;
  const inFlightRoutes = new Set<Promise<void>>();
  const handleRoute = async (
    route: Route,
    fulfill: (options: Parameters<Route["fulfill"]>[0]) => Promise<void>,
  ) => {
    const request = route.request();
    const actual = await context.request.fetch(request.url(), {
      method: request.method(),
      headers: { ...request.headers(), ...headers },
    });
    if (!actual.ok())
      throw new Error(`Query fixture read: HTTP ${actual.status()}`);
    await fulfill({
      response: actual,
      json: await patchPage(new URL(request.url()), await actual.json()),
    });
  };
  const handler = (route: Route) => {
    let claimed = false;
    const fulfill = (options: Parameters<Route["fulfill"]>[0]) => {
      claimed = true;
      return route.fulfill(options);
    };
    const task = handleRoute(route, fulfill).catch(async (error: unknown) => {
      routeFailure ??=
        error instanceof Error ? error : new Error(safeErrorDiagnostic(error));
      if (!claimed) {
        try {
          await route.abort();
        } catch (abortError) {
          console.error(
            "PAGER ROUTE ABORT FAILED",
            safeErrorDiagnostic(abortError),
          );
        }
      }
    });
    inFlightRoutes.add(task);
    void task.finally(() => inFlightRoutes.delete(task));
    return task;
  };
  try {
    const projectDocument = z
      .object({
        project: z.object({ cells: z.array(z.object({ id: z.string() })) }),
      })
      .parse(await action("get-project", { projectId: project.id }, "GET"));
    expect(projectDocument.project.cells).toHaveLength(1);
    await page.route(matcher, handler);
    routeInstalled = true;
    const executionRead = page
      .waitForResponse(
        (response) =>
          response
            .url()
            .includes("/_agent-native/actions/get-notebook-execution") ||
          response.url().includes("/_agent-native/actions/get-actions-batch"),
      )
      .catch(() => undefined);
    await page.goto(`${base}${project.href}`, {
      waitUntil: "domcontentloaded",
    });
    const editor = page
      .locator(
        "[data-notebook-cell] .nb-sql-editor .cm-content, [data-notebook-cell] textarea.nb-cell-source",
      )
      .first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await executionRead;
    let started = false;
    page.on("request", (request) => {
      if (request.url().includes("/_agent-native/actions/start-notebook-run"))
        started = true;
    });
    await expect
      .poll(
        async () => {
          if (!started) await editor.press("ControlOrMeta+Enter");
          return started;
        },
        { timeout: 20000, intervals: [1000] },
      )
      .toBe(true);
    const cells = page.locator("tbody tr td:first-of-type");
    await expect(cells).toHaveCount(50, { timeout: 30000 });
    const expectedRows = Array.from({ length: 50 }, (_, i) => `owned-row-${i}`);
    await expect(cells).toHaveText(expectedRows);
    const next = page.getByRole("button", { name: "Next page", exact: true });
    await expect(next).toBeEnabled();
    const beforeTerminal = intercepted;
    armBarrier();
    try {
      await next.click();
      state = "terminal";
    } catch (error) {
      const count = await next.count();
      const hit = count
        ? await next.first().evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const top = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            return {
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              targetIsHit: top === element || element.contains(top),
              hitTag: top?.tagName,
              hitRole: top?.getAttribute("role"),
            };
          })
        : null;
      console.error(
        "PAGER CLICK HIT",
        JSON.stringify({ count, hit, intercepted, state }),
      );
      await page.screenshot({
        path: ".tmp/analytics-owner/report-pager-failure.png",
        fullPage: true,
      });
      throw error;
    } finally {
      releaseBarrier();
    }
    await expect.poll(() => intercepted).toBeGreaterThan(beforeTerminal);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Couldn\u2019t load this page." }),
    ).toBeVisible();
    await expect(cells).toHaveText(expectedRows);
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.nb-output[aria-busy="true"]')).toHaveCount(0);
    const beforeReload = intercepted;
    state = "initial";
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => intercepted, { timeout: 30000 })
      .toBeGreaterThan(beforeReload);
    await expect(cells).toHaveText(expectedRows, { timeout: 30000 });
    await expect(next).toBeEnabled();
    const beforeUnavailable = intercepted;
    armBarrier();
    try {
      await next.click();
      state = "unavailable";
    } finally {
      releaseBarrier();
    }
    await expect.poll(() => intercepted).toBeGreaterThan(beforeUnavailable);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Couldn\u2019t load this page." }),
    ).toBeVisible();
    await expect(cells).toHaveText(expectedRows);
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.nb-output[aria-busy="true"]')).toHaveCount(0);
    expect(intercepted).toBeGreaterThanOrEqual(4);
    await page.screenshot({
      path: ".tmp/analytics-owner/report-pager-empty-continuation.png",
      fullPage: true,
    });
  } catch (error) {
    console.error(
      "PAGER FAILURE",
      JSON.stringify({
        state,
        intercepted,
        nextCount: await page
          .getByRole("button", { name: "Next page", exact: true })
          .count(),
      }),
    );
    await page.screenshot({
      path: ".tmp/analytics-owner/report-pager-failure.png",
      fullPage: true,
    });
    throw error;
  } finally {
    releaseBarrier();
    if (routeInstalled) await page.unrouteAll({ behavior: "wait" });
    await Promise.all(inFlightRoutes);
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await action("trash-project", { projectId: project.id });
    await action("delete-project", { projectId: project.id });
    const readback = await context.request.get(
      `${base}/_agent-native/actions/get-project?projectId=${encodeURIComponent(project.id)}`,
      { headers },
    );
    expect(readback.status()).toBe(404);
    console.log(`CLEANED pager project ${project.id}: HTTP 404`);
    if (routeFailure) throw routeFailure;
  }
}
