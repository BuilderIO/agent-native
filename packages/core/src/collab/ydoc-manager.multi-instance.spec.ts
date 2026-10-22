import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

type Manager = typeof import("./ydoc-manager.js");

interface Instance {
  label: string;
  manager: Manager;
  storage: typeof import("./storage.js");
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
    instances.push({
      label,
      manager: await import("./ydoc-manager.js"),
      storage: await import("./storage.js"),
    });
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("causal collaboration catch-up", () => {
  it.each([
    ["warm-version", "state"],
    ["warm-version", "diff"],
    ["warm-record", "state"],
    ["warm-record", "diff"],
    ["cold-version", "state"],
    ["cold-version", "diff"],
  ] as const)(
    "reads after a reported commit behind an older %s read (%s)",
    async (overlap, response) => {
      const docId = `fleet:causal:${overlap}:${response}`;
      const [a, b] = instances;
      const client = new Y.Doc();
      const oldReadStarted = deferred();
      const releaseOldRead = deferred();
      const freshReadStarted = deferred();
      const releaseFreshRead = deferred();
      let oldReadReleased = false;
      let oldReadHeld = false;
      let freshVersionReads = 0;
      const requests: Promise<Uint8Array>[] = [];
      await b.manager.applyText(docId, "initial body");
      Y.applyUpdate(client, await b.manager.getState(docId));
      if (overlap !== "cold-version") await a.manager.getState(docId);
      if (overlap === "warm-record") {
        await b.manager.applyText(docId, "intermediate body");
      }

      const loadVersion = a.storage.loadYDocVersion;
      const loadRecord = a.storage.loadYDocRecord;
      const versionSpy = vi.spyOn(a.storage, "loadYDocVersion");
      const recordSpy = vi.spyOn(a.storage, "loadYDocRecord");
      versionSpy.mockImplementation(async (id) => {
        const version = await loadVersion(id);
        if (overlap !== "warm-record" && !oldReadHeld) {
          oldReadHeld = true;
          oldReadStarted.resolve();
          await releaseOldRead.promise;
        } else if (oldReadReleased) {
          freshVersionReads++;
          freshReadStarted.resolve();
          await releaseFreshRead.promise;
        }
        return version;
      });
      recordSpy.mockImplementation(async (id) => {
        const record = await loadRecord(id);
        if (overlap === "warm-record" && !oldReadHeld) {
          oldReadHeld = true;
          oldReadStarted.resolve();
          await releaseOldRead.promise;
        }
        return record;
      });

      try {
        const olderRequest = a.manager.getState(docId);
        requests.push(olderRequest);
        await oldReadStarted.promise;
        const reportedBody = "reported edit committed by the peer";
        await b.manager.applyText(docId, reportedBody);
        expect((await b.storage.loadYDocRecord(docId))?.version).toBe(
          overlap === "warm-record" ? 2 : 1,
        );

        const catchUps = Array.from({ length: 12 }, () =>
          response === "state"
            ? a.manager.getState(docId)
            : a.manager.getIncUpdate(docId, Y.encodeStateVector(client)),
        );
        requests.push(...catchUps);
        let returned = false;
        const completed = Promise.all(catchUps).then((states) => {
          returned = true;
          return states;
        });
        expect(returned).toBe(false);
        oldReadReleased = true;
        releaseOldRead.resolve();
        expect(
          await Promise.race([
            freshReadStarted.promise.then(() => "fresh read"),
            completed.then(() => "returned without a fresh read"),
          ]),
        ).toBe("fresh read");
        expect(returned).toBe(false);
        expect(freshVersionReads).toBe(1);
        releaseFreshRead.resolve();

        for (const state of await completed) {
          const joined = new Y.Doc();
          try {
            Y.applyUpdate(joined, Y.encodeStateAsUpdate(client));
            Y.applyUpdate(joined, state);
            expect(joined.getText("content").toString()).toBe(reportedBody);
          } finally {
            joined.destroy();
          }
        }
        expect(freshVersionReads).toBe(1);
        expect(recordSpy).toHaveBeenCalledTimes(
          overlap === "warm-record" || overlap === "cold-version" ? 2 : 1,
        );
      } finally {
        releaseOldRead.resolve();
        releaseFreshRead.resolve();
        await Promise.allSettled(requests);
        versionSpy.mockRestore();
        recordSpy.mockRestore();
        client.destroy();
        a.manager.releaseDoc(docId);
        b.manager.releaseDoc(docId);
      }
    },
  );

  it.each([
    ["warm", "older"],
    ["warm", "fresh"],
    ["cold", "older"],
    ["cold", "fresh"],
  ] as const)(
    "refuses catch-up when the %s cache's %s storage read fails",
    async (cache, failedRead) => {
      const docId = `fleet:causal-failure:${cache}:${failedRead}`;
      const [a, b] = instances;
      await b.manager.applyText(docId, "initial body");
      if (cache === "warm") await a.manager.getState(docId);
      const oldReadStarted = deferred();
      const releaseOldRead = deferred();
      const loadVersion = a.storage.loadYDocVersion;
      const failure = new a.storage.CollabStateMalformedError(
        docId,
        "version",
        "storage version is unreadable",
      );
      let held = false;
      const versionSpy = vi
        .spyOn(a.storage, "loadYDocVersion")
        .mockImplementation(async (id) => {
          const version = await loadVersion(id);
          if (!held) {
            held = true;
            oldReadStarted.resolve();
            await releaseOldRead.promise;
            if (failedRead === "older") throw failure;
          } else if (failedRead === "fresh") {
            throw failure;
          }
          return version;
        });
      const requests: Promise<unknown>[] = [];
      try {
        const older = a.manager.getState(docId);
        const olderResult = older.then(
          () => ({ status: "returned" as const }),
          (error: unknown) => ({ status: "failed" as const, error }),
        );
        requests.push(olderResult);
        await oldReadStarted.promise;
        await b.manager.applyText(docId, "reported edit");
        const catchUp = a.manager.getState(docId);
        const refused = expect(catchUp).rejects.toBe(failure);
        requests.push(refused);
        releaseOldRead.resolve();
        await refused;
        expect(await olderResult).toEqual(
          failedRead === "older"
            ? { status: "failed", error: failure }
            : { status: "returned" },
        );
      } finally {
        releaseOldRead.resolve();
        await Promise.allSettled(requests);
        versionSpy.mockRestore();
        a.manager.releaseDoc(docId);
        b.manager.releaseDoc(docId);
      }
    },
  );
});
