import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  emitNetlifyBrainExportCron,
  SCHEDULE,
  SCHEDULED_NAME,
  WORKER_NAME,
} from "./emit-netlify-brain-export-cron.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Netlify Clips Brain export emitter", () => {
  it("emits a scheduled trigger and a token-protected worker that rewrites only to the sweep route", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "clips-brain-export-"));
    cleanup.push(root);
    const serverDir = path.join(root, "server");
    const functionsDir = path.join(root, "functions");
    await writeFile(path.join(root, "placeholder"), "");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(serverDir, { recursive: true }),
    );
    await writeFile(
      path.join(serverDir, "main.mjs"),
      `export default async (request) => Response.json({ path: new URL(request.url).pathname, method: request.method });`,
    );
    await writeFile(path.join(serverDir, "server.mjs"), "unused");

    emitNetlifyBrainExportCron({
      functionsDir,
      serverDir,
      token: "test-cron-token",
    });

    const scheduled = await readFile(
      path.join(functionsDir, SCHEDULED_NAME, `${SCHEDULED_NAME}.mjs`),
      "utf8",
    );
    expect(scheduled).toContain(`schedule: ${JSON.stringify(SCHEDULE)}`);
    expect(scheduled).toContain("x-agent-native-clips-brain-export-cron");

    const workerFile = path.join(
      functionsDir,
      WORKER_NAME,
      `${WORKER_NAME}.mjs`,
    );
    const worker = (
      await import(`${pathToFileURL(workerFile).href}?test=${Date.now()}`)
    ).default as (request: Request) => Promise<Response>;
    expect(
      (
        await worker(
          new Request("https://clips.example/anything", { method: "POST" }),
        )
      ).status,
    ).toBe(401);
    const accepted = await worker(
      new Request("https://clips.example/not-the-route?ignored=yes", {
        method: "POST",
        headers: {
          "x-agent-native-clips-brain-export-cron": "test-cron-token",
        },
      }),
    );
    expect(await accepted.json()).toEqual({
      path: "/api/clips/brain-export/run",
      method: "POST",
    });
  });
});
