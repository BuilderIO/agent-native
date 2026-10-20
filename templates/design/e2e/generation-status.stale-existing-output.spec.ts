import { sourceContentHash } from "../shared/source-workspace.js";
import { appPath } from "./helpers";
import { expect, test } from "./rails";

const PENDING_GENERATION_STALE_MS = 30 * 60_000;

test("restored stale generation with existing output keeps its stale warning", async ({
  app,
  page,
}) => {
  app.allowFailure(
    /error toast Generation may have stopped before creating files/,
    "restoring a stale generation should surface its retry warning",
  );
  const designId = await app.seed(
    "<!doctype html><html><body><main>Existing generated output</main></body></html>",
    { title: "stale-generation-output" },
  );
  await app.open(designId);
  const record = await app.savedRecord(designId);
  const file = record.files.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("seeded design has no index.html");

  const pendingKey = `design.pending-generation.${designId}`;
  await page.evaluate(
    ({ key, fileId, staleMs }) => {
      const staleAt = Date.now() - staleMs - 1;
      sessionStorage.setItem(
        key,
        JSON.stringify({
          createdAt: staleAt,
          startedAt: staleAt,
          runTabId: "e2e-existing-output",
          templateId: "e2e-template",
          templateBaselineFiles: [
            {
              id: fileId,
              contentHash: "older-output",
            },
          ],
        }),
      );
    },
    { key: pendingKey, fileId: file.id, staleMs: PENDING_GENERATION_STALE_MS },
  );

  let allowGetDesign!: () => void;
  let resolveGetDesignRequested!: () => void;
  let resolveGetDesignContinued!: () => void;
  const getDesignGate = new Promise<void>((resolve) => {
    allowGetDesign = resolve;
  });
  const getDesignRequested = new Promise<void>((resolve) => {
    resolveGetDesignRequested = resolve;
  });
  const getDesignContinued = new Promise<void>((resolve) => {
    resolveGetDesignContinued = resolve;
  });
  let firstGetDesignRequest = true;
  const getDesignRoute = /\/_agent-native\/actions\/get-design(?:\?|$)/;
  await page.route(getDesignRoute, async (route) => {
    if (!firstGetDesignRequest) {
      await route.continue();
      return;
    }
    firstGetDesignRequest = false;
    resolveGetDesignRequested();
    await getDesignGate;
    await route.continue();
    resolveGetDesignContinued();
  });

  await page.reload();
  try {
    await getDesignRequested;
    await expect
      .poll(() =>
        page.evaluate((key) => sessionStorage.getItem(key), pendingKey),
      )
      .not.toBeNull();
  } finally {
    allowGetDesign();
    if (!firstGetDesignRequest) await getDesignContinued;
    await page.unroute(getDesignRoute);
  }

  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), pendingKey))
    .toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __e2eErrorToasts?: string[] })
            .__e2eErrorToasts ?? [],
      ),
    )
    .toContain("Generation may have stopped before creating files.");
});

test("failed generation on an existing design keeps the retry path", async ({
  app,
  page,
}) => {
  const designId = await app.seed(
    '<!doctype html><html><body><main data-agent-native-node-id="existing-output">Existing design</main></body></html>',
    { title: "failed-generation-existing-output" },
  );
  await app.open(designId);
  const record = await app.savedRecord(designId);
  const file = record.files.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("seeded design has no index.html");

  const pendingKey = `design.pending-generation.${designId}`;
  const failedThreadId = await page.evaluate((id) => {
    const browserTabId = sessionStorage.getItem("agent-native:browser-tab-id");
    if (!browserTabId) return null;
    return localStorage.getItem(
      `agent-chat-active-thread:design:scope:design:${id}:tab:${browserTabId}`,
    );
  }, designId);
  if (!failedThreadId) {
    throw new Error("Design editor did not persist an active chat thread");
  }
  let retriedThreadId: string | null = null;
  let failureStatusReturned = false;
  const activeRunRoute = /\/_agent-native\/agent-chat\/runs\/active(?:\?|$)/;
  await page.route(activeRunRoute, async (route) => {
    const threadId = new URL(route.request().url()).searchParams.get(
      "threadId",
    );
    if (threadId === failedThreadId) {
      await route.fulfill({
        json: {
          active: false,
          status: "errored",
          runId: "e2e-failed-run",
          turnId: "e2e-failed-turn",
        },
      });
      failureStatusReturned = true;
      return;
    }
    if (failureStatusReturned && threadId && threadId !== failedThreadId) {
      const pending = await page.evaluate((key) => {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as { runTabId?: string }).runTabId : null;
      }, pendingKey);
      if (threadId === pending) {
        retriedThreadId = threadId;
        await route.fulfill({
          json: {
            active: true,
            status: "running",
            runId: "e2e-retry-run",
            turnId: "e2e-retry-turn",
          },
        });
        return;
      }
    }
    await route.continue();
  });
  await page.evaluate(
    ({ key, fileId, contentHash, runTabId }) => {
      const now = Date.now();
      sessionStorage.setItem(
        key,
        JSON.stringify({
          prompt: "Add a settings page",
          createdAt: now,
          startedAt: now,
          runTabId,
          currentRunId: "e2e-failed-run",
          currentTurnId: "e2e-failed-turn",
          previousRunBaselineVerified: true,
          outputBaselineFiles: [{ id: fileId, contentHash }],
        }),
      );
    },
    {
      key: pendingKey,
      fileId: file.id,
      contentHash: sourceContentHash(file.content ?? ""),
      runTabId: failedThreadId,
    },
  );

  await page.reload();
  await expect(app.node("existing-output")).toHaveText("Existing design");
  await page.evaluate(
    ({ tabId, runId, turnId }) => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId, runId, turnId },
        }),
      );
    },
    {
      tabId: failedThreadId,
      runId: "e2e-failed-run",
      turnId: "e2e-failed-turn",
    },
  );
  await expect.poll(() => retriedThreadId, { timeout: 20_000 }).not.toBeNull();
  expect(retriedThreadId).not.toBe(failedThreadId);
  await page.unroute(activeRunRoute);
});

test("failed generation after changed template output keeps its retry path", async ({
  app,
  page,
}) => {
  const initialHtml =
    '<!doctype html><html><body><main data-agent-native-node-id="existing-output">Existing design</main></body></html>';
  const designId = await app.seed(initialHtml, {
    title: "failed-generation-with-output",
  });
  await app.open(designId);
  const record = await app.savedRecord(designId);
  const file = record.files.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("seeded design has no index.html");
  const templateBaselineFiles = record.files.map((candidate) => ({
    id: candidate.id,
    contentHash: sourceContentHash(candidate.content ?? ""),
  }));
  expect(
    record.files.some((candidate) => {
      const baseline = templateBaselineFiles.find(
        (entry) => entry.id === candidate.id,
      );
      return (
        !baseline ||
        baseline.contentHash !== sourceContentHash(candidate.content ?? "")
      );
    }),
  ).toBe(false);

  const pendingKey = `design.pending-generation.${designId}`;
  const failedThreadId = await page.evaluate((id) => {
    const browserTabId = sessionStorage.getItem("agent-native:browser-tab-id");
    if (!browserTabId) return null;
    return localStorage.getItem(
      `agent-chat-active-thread:design:scope:design:${id}:tab:${browserTabId}`,
    );
  }, designId);
  if (!failedThreadId) {
    throw new Error("Design editor did not persist an active chat thread");
  }
  let retriedThreadId: string | null = null;
  let outputChanged = false;
  let failedThreadObserved = false;
  let failureStatusReturned = false;
  const activeRunRoute = /\/_agent-native\/agent-chat\/runs\/active(?:\?|$)/;
  await page.route(activeRunRoute, async (route) => {
    const threadId = new URL(route.request().url()).searchParams.get(
      "threadId",
    );
    if (threadId === failedThreadId) {
      failedThreadObserved = true;
      if (!outputChanged) {
        await route.fulfill({
          json: {
            active: true,
            status: "running",
            runId: "e2e-failed-output-run",
            turnId: "e2e-failed-output-turn",
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          active: false,
          status: "errored",
          runId: "e2e-failed-output-run",
          turnId: "e2e-failed-output-turn",
        },
      });
      failureStatusReturned = true;
      return;
    }
    if (failureStatusReturned && threadId) {
      retriedThreadId = threadId;
      await route.fulfill({
        json: {
          active: true,
          status: "running",
          runId: "e2e-unexpected-retry-run",
          turnId: "e2e-unexpected-retry-turn",
        },
      });
      return;
    }
    await route.continue();
  });

  await page.evaluate(
    ({ key, templateBaselineFiles, runTabId }) => {
      const now = Date.now();
      sessionStorage.setItem(
        key,
        JSON.stringify({
          prompt: "Add a settings page",
          createdAt: now,
          startedAt: now,
          runTabId,
          currentRunId: "e2e-failed-output-run",
          currentTurnId: "e2e-failed-output-turn",
          previousRunBaselineVerified: true,
          templateId: "e2e-template",
          templateBaselineFiles,
        }),
      );
    },
    {
      key: pendingKey,
      templateBaselineFiles,
      runTabId: failedThreadId,
    },
  );

  await page.reload();
  const generatedHtml =
    '<!doctype html><html><body><main data-agent-native-node-id="attempt-output">Generated attempt output</main></body></html>';
  try {
    await expect(app.node("existing-output")).toHaveText("Existing design");
    await page.evaluate(
      ({ tabId, runId, turnId }) => {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { isRunning: true, tabId, runId, turnId },
          }),
        );
      },
      {
        tabId: failedThreadId,
        runId: "e2e-failed-output-run",
        turnId: "e2e-failed-output-turn",
      },
    );
    await expect
      .poll(() => failedThreadObserved, { timeout: 20_000 })
      .toBe(true);
    const updateResponse = await page.request.post(
      appPath("/_agent-native/actions/update-file"),
      { data: { id: file.id, content: generatedHtml } },
    );
    expect(updateResponse.ok(), `update-file ${updateResponse.status()}`).toBe(
      true,
    );
    await expect
      .poll(() => app.savedHtml(designId))
      .toContain("Generated attempt output");
    await expect(app.node("attempt-output")).toHaveText(
      "Generated attempt output",
    );
    outputChanged = true;
    await page.evaluate((tabId) => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, reason: "run.failed", tabId },
        }),
      );
    }, failedThreadId);

    await expect
      .poll(() => failureStatusReturned, { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate((key) => sessionStorage.getItem(key), pendingKey),
      )
      .toBeNull();
    await expect
      .poll(() => retriedThreadId, { timeout: 20_000 })
      .not.toBeNull();
    expect(retriedThreadId).not.toBe(failedThreadId);
  } finally {
    await page.unroute(activeRunRoute);
  }
});
