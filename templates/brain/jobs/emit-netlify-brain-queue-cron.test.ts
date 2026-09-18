import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  emitNetlifyBrainQueueCron,
  ROUTE_PATH,
  SCHEDULE,
  SCHEDULED_NAME,
  WORKER_NAME,
} from "./emit-netlify-brain-queue-cron.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Netlify Brain queue emitter", () => {
  it("emits a per-minute trigger and token-protected worker that rewrites only to the queue route", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "brain-queue-cron-"));
    cleanup.push(root);
    const serverDir = path.join(root, "server");
    const functionsDir = path.join(root, "functions");
    await mkdir(serverDir, { recursive: true });
    await writeFile(
      path.join(serverDir, "main.mjs"),
      `export default async (request) => Response.json({ path: new URL(request.url).pathname, method: request.method });`,
    );
    await writeFile(path.join(serverDir, "server.mjs"), "unused");

    emitNetlifyBrainQueueCron({
      functionsDir,
      serverDir,
      token: "test-cron-token",
    });

    const scheduled = await readFile(
      path.join(functionsDir, SCHEDULED_NAME, `${SCHEDULED_NAME}.mjs`),
      "utf8",
    );
    expect(scheduled).toContain(`schedule: ${JSON.stringify(SCHEDULE)}`);
    expect(scheduled).toContain("x-agent-native-brain-cron");

    const workerFile = path.join(
      functionsDir,
      WORKER_NAME,
      `${WORKER_NAME}.mjs`,
    );
    const worker = (
      await import(`${pathToFileURL(workerFile).href}?test=${Date.now()}`)
    ).default as (request: Request) => Promise<Response>;
    const rejected = await worker(
      new Request("https://brain.example/anything", { method: "POST" }),
    );
    expect(rejected.status).toBe(401);

    const accepted = await worker(
      new Request("https://brain.example/not-the-route?ignored=yes", {
        method: "POST",
        headers: { "x-agent-native-brain-cron": "test-cron-token" },
      }),
    );
    expect(await accepted.json()).toEqual({
      path: ROUTE_PATH,
      method: "POST",
    });
  });
});
