import { sourceContentHash } from "../shared/source-workspace.js";
import { expect, test } from "./rails";

const PENDING_GENERATION_STALE_MS = 30 * 60_000;

test("restored generation with existing output clears without a stale warning", async ({
  app,
  page,
}) => {
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
    .toEqual([]);
});

test("failed generation on an existing design keeps the retry path", async ({
  app,
  page,
}) => {
  const designId = await app.seed(
    "<!doctype html><html><body><main>Existing design</main></body></html>",
    { title: "failed-generation-existing-output" },
  );
  await app.open(designId);
  const record = await app.savedRecord(designId);
  const file = record.files.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("seeded design has no index.html");

  const pendingKey = `design.pending-generation.${designId}`;
  const failedThreadId = "e2e-failed-generation";
  let retriedThreadId: string | null = null;
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
      return;
    }
    if (threadId) {
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
  await expect.poll(() => retriedThreadId, { timeout: 20_000 }).not.toBeNull();
  expect(retriedThreadId).not.toBe(failedThreadId);
  await page.unroute(activeRunRoute);
});
