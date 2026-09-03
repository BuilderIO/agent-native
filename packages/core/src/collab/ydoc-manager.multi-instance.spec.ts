import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Multi-instance regression suite for the beta 409 storm on
 * POST /_agent-native/actions/update-file.
 *
 * Prod is many serverless instances behind one hostname, each with its own
 * in-memory Y.Doc cache over one shared database. `vi.resetModules()` between
 * imports gives each `instance` its own module state — its own cache and its
 * own db client — which is the only thing that distinguishes two Lambdas.
 * A real SQLite file is the shared truth; the rest of the collab suite mocks
 * SQL, and a mock cannot express "another process wrote this row".
 *
 * Without a version re-check on cache hits, half of a drag's saves were
 * rejected: the guard read the caller's base against whatever text the
 * receiving instance happened to load first.
 */
type Manager = typeof import("./ydoc-manager.js");

interface Instance {
  label: string;
  manager: Manager;
}

let databaseDirectory: string;
const instances: Instance[] = [];

/** update-file's conflict guard for a syncCollab:true browser save. */
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
  process.env.DATABASE_URL = `file:${path.join(databaseDirectory, "fleet.db")}`;

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
    // b caches the doc as it would after serving any earlier request. A cold
    // instance reads the row and is correct by accident, so warming b first is
    // the whole precondition.
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

    // The browser's acked hash: the content it last saw the server persist.
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

    // Pre-fix this was [2, 4, 6, 8, 10, 12] — every save that landed on the
    // instance which never won a write, so never refreshed its cache.
    expect(rejected).toEqual([]);
    expect(await a.manager.getText(docId, "content")).toBe(frame(12 * -18));
    expect(await b.manager.getText(docId, "content")).toBe(frame(12 * -18));
  });
});
