import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDbExec } from "../db/client.js";
import { orgStore } from "../org/schema-store.js";
import { ForbiddenError } from "../sharing/access.js";
import * as store from "./store.js";

const owner = "viewer-state-owner@example.test";
const viewer = "viewer-state-viewer@example.test";
const other = "viewer-state-other@example.test";
const options = (email: string) => ({ ownerEmail: email });
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

beforeAll(async () => {
  await orgStore.ready();
  await store.ensureChatThreadTables();
  store.registerChatThreadsShareable();
});
beforeEach(async () => {
  for (const id of ["viewer-state-a", "viewer-state-b"]) {
    await store.deleteThread(id, owner);
    await store.createThread(owner, {
      id,
      title: "Viewer state plan",
      orgId: null,
      initialData: { threadData: "{}", preview: "Plan", messageCount: 1 },
    });
    await store.grantThreadUserShare(id, viewer, "viewer", owner);
    await store.grantThreadUserShare(id, other, "admin", owner);
  }
  await getDbExec().execute({
    sql: "UPDATE chat_threads SET updated_at = CASE WHEN id = ? THEN 10 ELSE 20 END WHERE id IN (?, ?)",
    args: ["viewer-state-a", "viewer-state-a", "viewer-state-b"],
  });
});

describe("shared chat viewer state", () => {
  it("never exposes or sorts by the owner's pin on shared rows", async () => {
    await store.setThreadPinned("viewer-state-a", true, options(owner));
    expect(ids(await store.listThreads(owner))).toEqual([
      "viewer-state-a",
      "viewer-state-b",
    ]);
    for (const email of [viewer, other]) {
      const rows = await store.listThreads(email, { ownership: "shared" });
      expect(ids(rows)).toEqual(["viewer-state-b", "viewer-state-a"]);
      expect(rows.map((row) => row.pinnedAt)).toEqual([null, null]);
      expect(
        (await store.resolveThreadAccess(email, "viewer-state-a"))?.pinnedAt,
      ).toBeNull();
      expect(
        (await store.resolveThreadsAccess(email, ["viewer-state-a"])).get(
          "viewer-state-a",
        )?.pinnedAt,
      ).toBeNull();
    }
  });

  it("pins only for the caller in list, search, and single reads", async () => {
    const before = await store.getThread("viewer-state-a");
    expect(
      await store.setThreadPinned("viewer-state-a", true, options(viewer)),
    ).toBe(true);
    for (const rows of [
      await store.listThreads(viewer),
      await store.searchThreads(viewer, "plan"),
    ]) {
      expect(ids(rows)).toEqual(["viewer-state-a", "viewer-state-b"]);
      expect(rows[0].pinnedAt).toEqual(expect.any(Number));
    }
    expect(
      (await store.resolveThreadAccess(viewer, "viewer-state-a"))?.pinnedAt,
    ).toEqual(expect.any(Number));
    expect(await store.getThread("viewer-state-a")).toEqual(before);
    expect(ids(await store.listThreads(other))).toEqual([
      "viewer-state-b",
      "viewer-state-a",
    ]);
    expect(ids(await store.listThreads(owner))).toEqual([
      "viewer-state-b",
      "viewer-state-a",
    ]);
    await store.setThreadPinned("viewer-state-a", false, options(viewer));
    expect(ids(await store.listThreads(viewer))).toEqual([
      "viewer-state-b",
      "viewer-state-a",
    ]);
  });

  it("hides only from the caller's lists, includes hidden explicitly, and opens by id", async () => {
    expect(
      await store.setThreadHidden("viewer-state-b", true, options(viewer)),
    ).toBe(true);
    expect(ids(await store.listThreads(viewer))).toEqual(["viewer-state-a"]);
    expect(ids(await store.searchThreads(viewer, "plan"))).toEqual([
      "viewer-state-a",
    ]);
    for (const rows of [
      await store.listThreads(viewer, { includeHidden: true }),
      await store.searchThreads(viewer, "plan", 50, { includeHidden: true }),
    ]) {
      expect(ids(rows)).toEqual(["viewer-state-b", "viewer-state-a"]);
      expect(rows[0].hiddenAt).toEqual(expect.any(Number));
    }
    expect(
      (await store.resolveThreadAccess(viewer, "viewer-state-b"))?.hiddenAt,
    ).toEqual(expect.any(Number));
    for (const email of [owner, other])
      expect(ids(await store.listThreads(email))).toEqual([
        "viewer-state-b",
        "viewer-state-a",
      ]);
    await store.setThreadHidden("viewer-state-b", false, options(viewer));
    expect(ids(await store.listThreads(viewer))).toEqual([
      "viewer-state-b",
      "viewer-state-a",
    ]);
  });

  it("refuses owner hide and inaccessible pin/hide without persisting state", async () => {
    const before = await store.getThread("viewer-state-a");
    await expect(
      store.setThreadHidden("viewer-state-a", true, options(owner)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    for (const email of ["outsider@example.test", ""]) {
      await expect(
        store.setThreadPinned("viewer-state-a", true, options(email)),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        store.setThreadHidden("viewer-state-a", true, options(email)),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await store.getThread("viewer-state-a")).toEqual(before);
    const { rows } = await getDbExec().execute({
      sql: "SELECT thread_id FROM chat_thread_viewer_state WHERE thread_id = ?",
      args: ["viewer-state-a"],
    });
    expect(rows).toEqual([]);
  });

  it("keeps archive and rename owner-only even for share admins", async () => {
    const before = await store.getThread("viewer-state-a");
    for (const email of [viewer, other]) {
      await expect(
        store.setThreadArchived("viewer-state-a", true, options(email)),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        store.renameThread("viewer-state-a", "Changed", options(email)),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await store.getThread("viewer-state-a")).toEqual(before);
  });

  it("retains viewer state after revocation without granting access and cleans it on deletion", async () => {
    await store.setThreadPinned("viewer-state-a", true, options(viewer));
    await store.setThreadHidden("viewer-state-a", true, options(viewer));
    await getDbExec().execute({
      sql: "DELETE FROM chat_thread_shares WHERE resource_id = ? AND principal_id = ?",
      args: ["viewer-state-a", viewer],
    });
    expect(
      ids(await store.listThreads(viewer, { includeHidden: true })),
    ).toEqual(["viewer-state-b"]);
    expect(
      ids(
        await store.searchThreads(viewer, "plan", 50, { includeHidden: true }),
      ),
    ).toEqual(["viewer-state-b"]);
    expect(
      await store.resolveThreadAccess(viewer, "viewer-state-a"),
    ).toBeNull();
    expect(
      (await store.resolveThreadsAccess(viewer, ["viewer-state-a"])).size,
    ).toBe(0);
    await expect(
      store.setThreadPinned("viewer-state-a", false, options(viewer)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      store.setThreadHidden("viewer-state-a", false, options(viewer)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const read = () =>
      getDbExec().execute({
        sql: "SELECT pinned_at, hidden_at FROM chat_thread_viewer_state WHERE thread_id = ? AND user_email = ?",
        args: ["viewer-state-a", viewer],
      });
    expect((await read()).rows).toEqual([
      { pinned_at: expect.any(Number), hidden_at: expect.any(Number) },
    ]);
    await store.deleteThread("viewer-state-a", owner);
    expect((await read()).rows).toEqual([]);
  });
});
