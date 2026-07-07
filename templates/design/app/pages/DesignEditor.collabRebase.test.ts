import { describe, expect, it } from "vitest";

import {
  resolveScreenCollabSyncTarget,
  shouldRebaseCollabDocFromStoredContent,
} from "./DesignEditor";

const OLD_HTML =
  '<!doctype html><html><body><div data-agent-native-node-id="an-1">old</div></body></html>';
const NEW_HTML =
  '<!doctype html><html><body><div data-agent-native-node-id="an-1">old</div><div data-agent-native-node-id="an-2">new</div></body></html>';

describe("shouldRebaseCollabDocFromStoredContent (§gesture-persistence collab-clobber fix)", () => {
  it("never rebases when the live doc already matches SQL", () => {
    expect(
      shouldRebaseCollabDocFromStoredContent({
        liveContent: NEW_HTML,
        storedContent: NEW_HTML,
        storedUpdatedAt: "2026-07-05T10:00:00.000Z",
        lastAppliedUpdatedAt: null,
        fileType: "html",
      }),
    ).toBe(false);
  });

  it("rebases a stale-but-well-formed live snapshot on first sync (no watermark yet) — the core clobber fix", () => {
    // This reproduces the browser-verified bug: a gesture edit persisted
    // NEW_HTML directly to design_files (SQL) while no Yjs doc was
    // connected. Later the Code panel connects a fresh doc whose
    // `_collab_docs` snapshot still holds OLD_HTML. Before this fix,
    // `shouldUseLiveFileContent` alone would say "OLD_HTML looks like valid
    // HTML" and the seed effect would adopt it as authoritative, silently
    // discarding the gesture edit. With no established watermark
    // (lastAppliedUpdatedAt === null) and SQL having a real updatedAt, SQL
    // must win.
    expect(
      shouldRebaseCollabDocFromStoredContent({
        liveContent: OLD_HTML,
        storedContent: NEW_HTML,
        storedUpdatedAt: "2026-07-05T10:05:00.000Z",
        lastAppliedUpdatedAt: null,
        fileType: "html",
      }),
    ).toBe(true);
  });

  it("does not rebase once a watermark is established and the live doc has since diverged legitimately", () => {
    // After the initial rebase, lastAppliedUpdatedAt is set. A subsequent
    // divergence between the live doc and SQL at this point is a genuine
    // in-flight edit (this client's own typing, or a peer's), not an
    // unproven stale snapshot, so it must NOT be force-rebased from SQL.
    expect(
      shouldRebaseCollabDocFromStoredContent({
        liveContent: NEW_HTML,
        storedContent: OLD_HTML,
        storedUpdatedAt: "2026-07-05T10:05:00.000Z",
        lastAppliedUpdatedAt: "2026-07-05T10:05:00.000Z",
        fileType: "html",
      }),
    ).toBe(false);
  });

  it("still rebases malformed/orphaned live content regardless of watermark state (preserves the original corruption guard)", () => {
    const malformed = ` data-agent-native-node-id="an-1"${NEW_HTML}`;
    expect(
      shouldRebaseCollabDocFromStoredContent({
        liveContent: malformed,
        storedContent: NEW_HTML,
        storedUpdatedAt: "2026-07-05T10:05:00.000Z",
        lastAppliedUpdatedAt: "2026-07-05T10:05:00.000Z",
        fileType: "html",
      }),
    ).toBe(true);
  });

  it("does not rebase on first sync when SQL has never been written (no storedUpdatedAt) — a brand-new doc's only content is the live one", () => {
    expect(
      shouldRebaseCollabDocFromStoredContent({
        liveContent: NEW_HTML,
        storedContent: OLD_HTML,
        storedUpdatedAt: null,
        lastAppliedUpdatedAt: null,
        fileType: "html",
      }),
    ).toBe(false);
  });

  it("defers entirely to the corruption guard for non-html files", () => {
    expect(
      shouldRebaseCollabDocFromStoredContent({
        liveContent: "body { color: red; }",
        storedContent: "body { color: blue; }",
        storedUpdatedAt: "2026-07-05T10:05:00.000Z",
        lastAppliedUpdatedAt: null,
        fileType: "css",
      }),
    ).toBe(false);
  });
});

describe("resolveScreenCollabSyncTarget (§gesture-persistence per-screen collab-sync fix)", () => {
  it("writes the live doc and skips the server-side syncCollab round-trip when the target screen is the connected overview presence doc", () => {
    expect(
      resolveScreenCollabSyncTarget({
        fileId: "file-a",
        overviewPresenceFileId: "file-a",
        overviewDocConnected: true,
      }),
    ).toEqual({ writeLiveDoc: true, syncCollab: false });
  });

  it("falls back to syncCollab: true when no doc is connected for this screen", () => {
    expect(
      resolveScreenCollabSyncTarget({
        fileId: "file-a",
        overviewPresenceFileId: null,
        overviewDocConnected: false,
      }),
    ).toEqual({ writeLiveDoc: false, syncCollab: true });
  });

  it("falls back to syncCollab: true when a different screen's doc is connected (not this one)", () => {
    // Regression guard: writing into the WRONG screen's live doc would be its
    // own clobber bug, so this must stay false even though a doc IS connected.
    expect(
      resolveScreenCollabSyncTarget({
        fileId: "file-b",
        overviewPresenceFileId: "file-a",
        overviewDocConnected: true,
      }),
    ).toEqual({ writeLiveDoc: false, syncCollab: true });
  });

  it("falls back to syncCollab: true when the presence doc id matches but it isn't actually synced yet", () => {
    expect(
      resolveScreenCollabSyncTarget({
        fileId: "file-a",
        overviewPresenceFileId: "file-a",
        overviewDocConnected: false,
      }),
    ).toEqual({ writeLiveDoc: false, syncCollab: true });
  });
});
