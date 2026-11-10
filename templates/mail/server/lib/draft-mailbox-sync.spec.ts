import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appState: new Map<string, Record<string, unknown>>(),
  saveGmailDraft: vi.fn(),
  deleteGmailDraft: vi.fn(),
  findGmailDraftAccount: vi.fn(),
  isConnected: vi.fn(),
  createLocalSavedDraft: vi.fn(),
  deleteLocalSavedDraft: vi.fn(),
  updateLocalSavedDraft: vi.fn(),
  readAliases: vi.fn(),
  compareAndSetOverride: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: async (key: string) => mocks.appState.get(key) ?? null,
  compareAndSetAppState: async (
    key: string,
    expected: unknown,
    next: Record<string, unknown> | null,
  ) => {
    const override = mocks.compareAndSetOverride();
    if (override) return override;
    if ((mocks.appState.get(key) ?? null) !== expected) return false;
    if (next) mocks.appState.set(key, next);
    else mocks.appState.delete(key);
    return true;
  },
}));

vi.mock("./gmail-drafts.js", () => ({
  saveGmailDraft: mocks.saveGmailDraft,
  deleteGmailDraft: mocks.deleteGmailDraft,
  findGmailDraftAccount: mocks.findGmailDraftAccount,
}));

vi.mock("./google-auth.js", () => ({ isConnected: mocks.isConnected }));

vi.mock("./local-email-drafts.js", () => ({
  createLocalSavedDraft: mocks.createLocalSavedDraft,
  deleteLocalSavedDraft: mocks.deleteLocalSavedDraft,
  updateLocalSavedDraft: mocks.updateLocalSavedDraft,
}));

vi.mock("./local-email-store.js", () => ({ readLocalEmails: async () => [] }));

vi.mock("./aliases.js", () => ({ readAliases: mocks.readAliases }));

import { syncDraftToMailbox } from "./draft-mailbox-sync.js";
import { GmailQuotaRefusedError } from "./gmail-quota.js";

const OWNER = "owner@example.com";
const KEY = "compose-d1";

type GmailCopy = { to: string; subject: string; body: string };

/**
 * Gmail's drafts, where each save waits until the test releases it, so a spec
 * can choose the order overlapping saves land in.
 */
function fakeGmail() {
  const drafts = new Map<string, GmailCopy>();
  const waiting: Array<{ body: string; release: () => void }> = [];
  let created = 0;
  mocks.saveGmailDraft.mockImplementation(
    async (args: GmailCopy & { draftId?: string }) => {
      await new Promise<void>((release) =>
        waiting.push({ body: args.body, release }),
      );
      const copy = { to: args.to, subject: args.subject, body: args.body };
      if (args.draftId && drafts.has(args.draftId)) {
        drafts.set(args.draftId, copy);
        return {
          draftId: args.draftId,
          accountEmail: OWNER,
          created: false,
          updated: true,
        };
      }
      // A missing draft comes back as a new one, as Gmail's PUT 404 does.
      created += 1;
      const draftId = `g${created}`;
      drafts.set(draftId, copy);
      return { draftId, accountEmail: OWNER, created: true };
    },
  );
  mocks.deleteGmailDraft.mockImplementation(
    async ({ draftId }: { draftId: string }) => void drafts.delete(draftId),
  );
  const waitFor = (body: string) =>
    vi.waitFor(() => expect(waiting.map((save) => save.body)).toContain(body));
  return {
    drafts,
    /**
     * Stores a change to the draft and starts its sync, as manage-draft does,
     * and returns once that sync's Gmail write is on its way.
     */
    async save(fields: { body: string }) {
      mocks.appState.set(KEY, { ...mocks.appState.get(KEY)!, ...fields });
      const synced = syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" });
      await waitFor(fields.body);
      return { synced };
    },
    /** Lands the first waiting Gmail write that's carrying `body`. */
    async land(body: string) {
      await waitFor(body);
      const index = waiting.findIndex((save) => save.body === body);
      const [save] = waiting.splice(index, 1);
      if (!save) throw new Error(`No Gmail write is carrying "${body}"`);
      save.release();
    },
  };
}

function draft(fields: Record<string, unknown>) {
  return {
    id: "d1",
    to: "ivy@example.com",
    subject: "Refund",
    body: "v1",
    mode: "compose",
    ...fields,
  };
}

const onGmail = {
  savedDraftId: "g0",
  savedDraftBackend: "gmail",
  savedDraftAccountEmail: OWNER,
  accountEmail: OWNER,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.appState.clear();
  mocks.isConnected.mockResolvedValue(true);
  mocks.readAliases.mockResolvedValue([]);
});

describe("syncDraftToMailbox with overlapping saves", () => {
  it("ends on the newer draft when the older save's Gmail write lands last", async () => {
    const gmail = fakeGmail();
    gmail.drafts.set("g0", {
      to: "ivy@example.com",
      subject: "Refund",
      body: "v1",
    });
    mocks.appState.set(KEY, draft({ ...onGmail }));

    const older = await gmail.save({ body: "v2" });
    const newer = await gmail.save({ body: "v3" });
    await gmail.land("v3");
    await expect(newer.synced).resolves.toMatchObject({ status: "synced" });
    await gmail.land("v2");
    // The older save sees Mail moved on, and writes what Mail stores now.
    await gmail.land("v3");

    await expect(older.synced).resolves.toMatchObject({
      status: "synced",
      draft: { body: "v3" },
    });
    expect(gmail.drafts.get("g0")?.body).toBe("v3");
  });

  it("ends on the newest of three saves, whatever order Gmail takes them in", async () => {
    const gmail = fakeGmail();
    gmail.drafts.set("g0", {
      to: "ivy@example.com",
      subject: "Refund",
      body: "v1",
    });
    mocks.appState.set(KEY, draft({ ...onGmail }));

    const first = await gmail.save({ body: "v2" });
    const second = await gmail.save({ body: "v3" });
    const third = await gmail.save({ body: "v4" });
    await gmail.land("v4");
    await gmail.land("v2");
    await gmail.land("v3");
    await gmail.land("v4");
    await gmail.land("v4");

    const results = await Promise.all(
      [first, second, third].map((save) => save.synced),
    );
    expect(results.map((result) => result.status)).toEqual([
      "synced",
      "synced",
      "synced",
    ]);
    expect(gmail.drafts.get("g0")?.body).toBe("v4");
  });

  it("keeps one Gmail draft when two saves each make one", async () => {
    const gmail = fakeGmail();
    mocks.appState.set(KEY, draft({}));

    const first = await gmail.save({ body: "v2" });
    const second = await gmail.save({ body: "v3" });
    await gmail.land("v3");
    await gmail.land("v2");
    // The first save's Gmail draft lost; it moves to the one Mail kept.
    await gmail.land("v3");
    await expect(
      Promise.all([first.synced, second.synced]),
    ).resolves.toMatchObject([
      { status: "synced", savedDraft: { draftId: "g1" } },
      { status: "synced", savedDraft: { draftId: "g1" } },
    ]);

    expect([...gmail.drafts.keys()]).toEqual(["g1"]);
    expect(gmail.drafts.get("g1")?.body).toBe("v3");
    expect(mocks.appState.get(KEY)).toMatchObject({
      savedDraftId: "g1",
      savedDraftBackend: "gmail",
      accountEmail: OWNER,
    });
  });

  it("doesn't bring back a draft deleted while its Gmail write was on the way", async () => {
    const gmail = fakeGmail();
    gmail.drafts.set("g0", {
      to: "ivy@example.com",
      subject: "Refund",
      body: "v1",
    });
    mocks.appState.set(KEY, draft({ ...onGmail }));

    const pending = await gmail.save({ body: "v2" });
    // Sending or discarding removes both copies of the draft.
    gmail.drafts.delete("g0");
    mocks.appState.delete(KEY);
    await gmail.land("v2");

    await expect(pending.synced).resolves.toEqual({ status: "gone" });
    expect(gmail.drafts.size).toBe(0);
  });

  it("leaves a draft that keeps changing to the save changing it", async () => {
    mocks.appState.set(KEY, draft({ ...onGmail }));
    let edits = 0;
    mocks.saveGmailDraft.mockImplementation(async () => {
      edits += 1;
      mocks.appState.set(KEY, {
        ...mocks.appState.get(KEY)!,
        body: `edit ${edits}`,
      });
      return { draftId: "g0", accountEmail: OWNER, created: false };
    });

    const result = await syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" });

    expect(result).toMatchObject({
      status: "pending",
      errorCode: "draft_mailbox_busy",
    });
    // The copy was already there, so there's no new one to report.
    expect(result).not.toHaveProperty("savedDraft");
    expect(mocks.saveGmailDraft).toHaveBeenCalledTimes(3);
  });
});

describe("syncDraftToMailbox when adopting a copy", () => {
  const made = { draftId: "g1", accountEmail: OWNER, created: true };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  /** A store whose first compare-and-set runs `landed`, then throws. */
  function throwAfterWrite(landed: () => void) {
    mocks.compareAndSetOverride.mockImplementationOnce(async () => {
      landed();
      throw new Error("connection lost");
    });
  }

  it("writes newer text to the copy when a save lands just after the adoption", async () => {
    mocks.appState.set(KEY, draft({}));
    mocks.saveGmailDraft
      .mockResolvedValueOnce(made)
      .mockResolvedValueOnce({ ...made, created: false });
    mocks.compareAndSetOverride.mockImplementationOnce(async () => {
      mocks.appState.set(
        KEY,
        draft({ ...onGmail, savedDraftId: "g1", body: "newer" }),
      );
      return true;
    });

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "synced",
      draft: { body: "newer" },
    });
    expect(mocks.saveGmailDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ draftId: "g1", body: "newer" }),
    );
  });

  it("says which copy it made when the draft keeps changing after the adoption", async () => {
    mocks.appState.set(KEY, draft({}));
    let writes = 0;
    mocks.saveGmailDraft.mockImplementation(async () => {
      writes += 1;
      if (writes === 1) return made;
      mocks.appState.set(KEY, {
        ...mocks.appState.get(KEY)!,
        body: `edit ${writes}`,
      });
      return { ...made, created: false };
    });
    mocks.compareAndSetOverride.mockImplementationOnce(async () => {
      mocks.appState.set(
        KEY,
        draft({ ...onGmail, savedDraftId: "g1", body: "newer" }),
      );
      return true;
    });

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "pending",
      errorCode: "draft_mailbox_busy",
      savedDraft: { draftId: "g1", backend: "gmail", accountEmail: OWNER },
    });
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
  });

  it("says which copy it made when a later write fails", async () => {
    mocks.appState.set(KEY, draft({}));
    mocks.saveGmailDraft
      .mockResolvedValueOnce(made)
      .mockRejectedValueOnce(new Error("Gmail is down"));
    mocks.compareAndSetOverride.mockImplementationOnce(async () => {
      mocks.appState.set(
        KEY,
        draft({ ...onGmail, savedDraftId: "g1", body: "newer" }),
      );
      return true;
    });

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "pending",
      errorCode: "draft_mailbox_save_failed",
      savedDraft: { draftId: "g1", backend: "gmail", accountEmail: OWNER },
    });
  });

  it("counts a write that landed before it threw as adopted", async () => {
    mocks.appState.set(KEY, draft({}));
    mocks.saveGmailDraft.mockResolvedValue(made);
    throwAfterWrite(() =>
      mocks.appState.set(KEY, draft({ ...onGmail, savedDraftId: "g1" })),
    );

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "synced",
      savedDraft: { draftId: "g1" },
    });
    expect(mocks.saveGmailDraft).toHaveBeenCalledTimes(1);
  });

  it("writes newer text to the copy when a save landed after the adoption", async () => {
    mocks.appState.set(KEY, draft({}));
    mocks.saveGmailDraft
      .mockResolvedValueOnce(made)
      .mockResolvedValueOnce({ ...made, created: false });
    throwAfterWrite(() =>
      mocks.appState.set(
        KEY,
        draft({ ...onGmail, savedDraftId: "g1", body: "newer" }),
      ),
    );

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "synced",
      draft: { body: "newer" },
    });
    expect(mocks.saveGmailDraft).toHaveBeenCalledTimes(2);
    expect(mocks.saveGmailDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ draftId: "g1", body: "newer" }),
    );
    expect(mocks.deleteGmailDraft).not.toHaveBeenCalled();
  });
});

describe("syncDraftToMailbox", () => {
  it("copies nothing for a draft Mail doesn't store", async () => {
    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toEqual({ status: "gone" });
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
  });

  it("says Gmail's copy is pending when Mail's Gmail budget refuses the write", async () => {
    const stored = draft({ ...onGmail });
    mocks.appState.set(KEY, stored);
    mocks.saveGmailDraft.mockRejectedValue(new GmailQuotaRefusedError(5_000));

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "pending",
      errorCode: "gmail_quota_cooldown",
      retryAfterMs: 5_000,
    });
    expect(mocks.appState.get(KEY)).toBe(stored);
  });

  it("says Gmail's copy is pending when the write fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.appState.set(KEY, draft({ ...onGmail }));
    mocks.saveGmailDraft.mockRejectedValue(new Error("Gmail is down"));

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toEqual({
      status: "pending",
      errorCode: "draft_mailbox_save_failed",
      message: "Gmail is down",
    });
    consoleError.mockRestore();
  });

  it("writes a group's addresses to Gmail and keeps the group in Mail", async () => {
    mocks.readAliases.mockResolvedValue([
      { id: "team", name: "Team", emails: ["a@example.com", "b@example.com"] },
    ]);
    const stored = draft({
      ...onGmail,
      to: "alias:team, c@example.com",
      cc: "alias:team",
    });
    mocks.appState.set(KEY, stored);
    mocks.saveGmailDraft.mockResolvedValue({
      draftId: "g0",
      accountEmail: OWNER,
      created: false,
    });

    await syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" });

    expect(mocks.saveGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com, b@example.com, c@example.com",
        cc: "a@example.com, b@example.com",
      }),
    );
    expect(mocks.appState.get(KEY)).toBe(stored);
  });

  it("updates an existing local draft from Mail's copy", async () => {
    mocks.appState.set(
      KEY,
      draft({ savedDraftId: "local-1", savedDraftBackend: "local" }),
    );
    mocks.updateLocalSavedDraft.mockResolvedValue(true);

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "synced",
      savedDraft: { draftId: "local-1", backend: "local" },
    });
    expect(mocks.updateLocalSavedDraft).toHaveBeenCalledWith(
      // No attachments, said outright, so ones the copy had are removed.
      expect.objectContaining({
        draftId: "local-1",
        body: "v1",
        attachments: [],
      }),
    );
    expect(mocks.saveGmailDraft).not.toHaveBeenCalled();
  });

  it("makes a new local draft when the one it points at has gone", async () => {
    mocks.appState.set(
      KEY,
      draft({ savedDraftId: "local-1", savedDraftBackend: "local" }),
    );
    mocks.updateLocalSavedDraft.mockResolvedValue(false);
    mocks.createLocalSavedDraft.mockResolvedValue("local-2");

    await expect(
      syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
    ).resolves.toMatchObject({
      status: "synced",
      savedDraft: { draftId: "local-2", backend: "local" },
    });
    expect(mocks.appState.get(KEY)).toMatchObject({ savedDraftId: "local-2" });
  });

  it("saves a reply to Gmail even when it can't thread it", async () => {
    mocks.appState.set(KEY, draft({ replyToId: "message-1" }));
    mocks.saveGmailDraft.mockResolvedValue({
      draftId: "g1",
      accountEmail: OWNER,
      created: true,
    });

    await syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" });

    expect(mocks.saveGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToId: "message-1",
        replyHeadersOptional: true,
      }),
    );
  });

  describe("for an owner with no Gmail account", () => {
    beforeEach(() => {
      mocks.saveGmailDraft.mockResolvedValue(null);
      mocks.isConnected.mockResolvedValue(false);
      mocks.createLocalSavedDraft.mockResolvedValue("local-1");
      mocks.appState.set(KEY, draft({}));
    });

    it("makes no copy unless asked to keep a local one", async () => {
      await expect(
        syncDraftToMailbox({ ownerEmail: OWNER, id: "d1" }),
      ).resolves.toEqual({ status: "unavailable" });
      expect(mocks.createLocalSavedDraft).not.toHaveBeenCalled();
    });

    it("keeps a local draft and points Mail's copy at it", async () => {
      await expect(
        syncDraftToMailbox({
          ownerEmail: OWNER,
          id: "d1",
          localFallback: true,
        }),
      ).resolves.toMatchObject({
        status: "synced",
        savedDraft: { draftId: "local-1", backend: "local" },
      });
      expect(mocks.appState.get(KEY)).toMatchObject({
        savedDraftId: "local-1",
        savedDraftBackend: "local",
      });
    });

    it("keeps no local draft when Gmail is connected but couldn't save", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mocks.isConnected.mockResolvedValue(true);

      await expect(
        syncDraftToMailbox({
          ownerEmail: OWNER,
          id: "d1",
          localFallback: true,
        }),
      ).resolves.toMatchObject({ status: "pending" });
      expect(mocks.createLocalSavedDraft).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
