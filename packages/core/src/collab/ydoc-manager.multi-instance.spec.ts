import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Manager = typeof import("./ydoc-manager.js");

interface Instance {
  label: string;
  manager: Manager;
}

let databaseDirectory: string;
const instances: Instance[] = [];

function sourceContentHash(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

function frame(left: number): string {
  return `<!DOCTYPE html><html><body><div data-agent-native-node-id="draft-rect" style="left: ${left}px"></div></body></html>`;
}

beforeAll(async () => {
  databaseDirectory = mkdtempSync(path.join(tmpdir(), "an-collab-fleet-"));
  process.env.DATABASE_URL = `pglite:${path.join(databaseDirectory, "fleet")}`;

  for (const label of ["lambda-a", "lambda-b"]) {
    vi.resetModules();
    instances.push({ label, manager: await import("./ydoc-manager.js") });
  }
});

afterAll(() => {
  rmSync(databaseDirectory, { recursive: true, force: true });
});

describe("ydoc-manager across serverless instances", () => {
  it("shows a peer instance's write to an already-warm cache", async () => {
    const docId = "fleet:peer-visibility";
    const [a, b] = instances;

    await a.manager.applyText(docId, frame(0), "content", "seed");
    expect(await b.manager.getText(docId, "content")).toBe(frame(0));

    await a.manager.applyText(docId, frame(-18), "content", "agent");

    expect(await b.manager.getText(docId, "content")).toBe(frame(-18));
  });

  it("accepts every save of a drag routed round-robin across instances", async () => {
    const docId = "fleet:drag-sequence";
    const [a, b] = instances;
    await a.manager.applyText(docId, frame(0), "content", "seed");
    for (const instance of instances) {
      await instance.manager.getText(docId, "content");
    }

    let ackedContent = frame(0);
    const rejected: number[] = [];

    for (let save = 1; save <= 12; save += 1) {
      const instance = save % 2 === 0 ? a : b;
      const nextContent = frame(save * -18);
      const expectedVersionHash = sourceContentHash(ackedContent);

      const liveContent = await instance.manager.getText(docId, "content");
      const isConflict =
        liveContent !== nextContent &&
        sourceContentHash(liveContent) !== expectedVersionHash;
      if (isConflict) {
        rejected.push(save);
        continue;
      }

      await instance.manager.applyText(docId, nextContent, "content", "agent");
      ackedContent = nextContent;
    }

    expect(rejected).toEqual([]);
    expect(await a.manager.getText(docId, "content")).toBe(frame(12 * -18));
    expect(await b.manager.getText(docId, "content")).toBe(frame(12 * -18));
  });
});
