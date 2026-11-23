import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";

import type { Page, Request, Response } from "@playwright/test";

export type FirstRunArtifacts = {
  runId: string;
  serverLogPath: string;
  failureScreenshotPath: string;
};

type NavigationEntry = {
  method: string;
  pathname: string;
  resourceType: string;
  started: number;
  ended?: number;
  status: number | null;
  state: "pending" | "finished" | "failed";
};

export function createFirstRunArtifacts(
  tmpDir: string,
  failureDir: string,
): FirstRunArtifacts {
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(failureDir, { recursive: true });
  for (let attempt = 0; attempt < 8; attempt++) {
    const runId = `${Date.now()}-${process.pid}-${randomBytes(4).toString("hex")}`;
    const serverLogPath = resolve(
      tmpDir,
      `analytics-2-first-run-server-${runId}.log`,
    );
    try {
      const fd = openSync(serverLogPath, "wx", 0o600);
      closeSync(fd);
      return {
        runId,
        serverLogPath,
        failureScreenshotPath: resolve(
          failureDir,
          `first-run-readiness-failure-${runId}.png`,
        ),
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not allocate unique first-run artifact paths");
}

export function observeFirstRunNavigation(
  page: Page,
  baseOrigin: string,
  clock = Date.now,
) {
  const originTime = clock();
  const entries = new Map<Request, NavigationEntry>();
  let omitted = 0;

  const onRequest = (request: Request) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url());
    } catch {
      return;
    }
    if (parsed.origin !== baseOrigin) return;
    if (entries.size >= 40) {
      omitted++;
      return;
    }
    entries.set(request, {
      method: request.method(),
      pathname: parsed.pathname,
      resourceType: request.resourceType(),
      started: clock(),
      status: null,
      state: "pending",
    });
  };

  const onResponse = (response: Response) => {
    const entry = entries.get(response.request());
    if (entry) entry.status = response.status();
  };

  const finish = (request: Request, state: "finished" | "failed") => {
    const entry = entries.get(request);
    if (entry) {
      entry.state = state;
      entry.ended = clock();
    }
  };

  const onFinished = (request: Request) => finish(request, "finished");
  const onFailed = (request: Request) => finish(request, "failed");

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);

  const format = (entry: NavigationEntry) => ({
    method: entry.method,
    pathname: entry.pathname,
    resourceType: entry.resourceType,
    status: entry.status,
    state: entry.state,
    startedMs: entry.started - originTime,
    elapsedMs: (entry.ended ?? clock()) - entry.started,
  });

  return {
    snapshot: () => {
      const all = [...entries.values()];
      const pending = all.filter((entry) => entry.state === "pending");
      const failed = all.filter((entry) => entry.state === "failed");
      return {
        pendingCount: pending.length,
        omitted,
        pending: pending.map(format),
        failed: failed.map(format),
      };
    },
    dispose: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    },
  };
}
