// @vitest-environment happy-dom

import { saveRevisionOf } from "@agent-native/core/save-conflict";
import type { ComposeAttachment, ComposeState } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  applyDraftSaveResult,
  DRAFT_SAVE_FAILED_EVENT,
  getDraftSaveMetadataUpdate,
  useComposeState,
} from "./use-compose-state";

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appApiPath: (path: string) => path,
}));
const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  getBrowserTabId: () => "tab",
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
}));

const asJson = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

const draftFile: ComposeAttachment = {
  id: "part-1",
  filename: "brief.pdf",
  originalName: "brief.pdf",
  mimeType: "application/pdf",
  size: 10,
  source: "gmail",
  gmailMessageId: "message-of-draft",
  gmailAttachmentId: "part-1",
  accountEmail: "owner@example.com",
};
const upload: ComposeAttachment = {
  id: "upload.pdf",
  filename: "upload.pdf",
  originalName: "upload.pdf",
  mimeType: "application/pdf",
  size: 6,
};
const moveOfDraftFile = {
  from: { gmailMessageId: "message-of-draft", gmailAttachmentId: "part-1" },
  to: { gmailMessageId: "message-2", gmailAttachmentId: "part-2" },
};

function reopened(attachments: ComposeAttachment[]): ComposeState {
  return {
    id: "reopened",
    to: "recipient@example.com",
    subject: "Brief",
    body: "Draft",
    mode: "compose",
    attachments,
    savedDraftId: "r-draft-7",
    savedDraftBackend: "gmail",
    savedDraftAccountEmail: "owner@example.com",
  };
}

describe("a Gmail save that moved the draft's files", () => {
  it("moves only the files the save sent, wherever they now sit", () => {
    const forwarded = {
      ...draftFile,
      id: "forwarded",
      gmailMessageId: "source-message",
      gmailAttachmentId: "forwarded",
    };
    const removed = { ...draftFile, id: "part-9", gmailAttachmentId: "part-9" };
    const sentWith = reopened([removed, forwarded, draftFile]);
    const now = { ...sentWith, attachments: [upload, forwarded, draftFile] };

    const saved = applyDraftSaveResult(now, {
      status: "saved",
      draftId: "r-draft-7",
      backend: "gmail",
      accountEmail: "owner@example.com",
      movedAttachments: [
        {
          from: {
            gmailMessageId: "message-of-draft",
            gmailAttachmentId: "part-9",
          },
          to: { gmailMessageId: "message-2", gmailAttachmentId: "part-0" },
        },
        moveOfDraftFile,
      ],
    });

    expect(saved.attachments).toEqual([
      upload,
      forwarded,
      { ...draftFile, ...moveOfDraftFile.to },
    ]);
  });

  it("stores the move even when the saved draft's ID didn't change", () => {
    const draft = reopened([draftFile]);

    const update = getDraftSaveMetadataUpdate(
      draft,
      {
        status: "saved",
        draftId: "r-draft-7",
        backend: "gmail",
        accountEmail: "owner@example.com",
        movedAttachments: [moveOfDraftFile],
      },
      false,
    );

    expect(update?.attachments).toEqual([
      { ...draftFile, ...moveOfDraftFile.to },
    ]);
  });
});

type Ref = { gmailMessageId: string; gmailAttachmentId: string };

const refsOf = (attachments: ComposeAttachment[] | undefined) =>
  (attachments ?? []).map(
    (file) => `${file.gmailMessageId}/${file.gmailAttachmentId}`,
  );

const unconfirmedMessage =
  "Gmail saved the draft, but Mail couldn't confirm where its attachments moved (Backend Error). Saving the draft again finds them.";

async function mounted({
  savedDraftId = "r-draft-7",
  answers = [],
  refuseStore = false,
  afterAdopt,
}: {
  savedDraftId?: string;
  answers?: ("moved" | "unconfirmed" | "busy")[];
  refuseStore?: boolean | number;
  afterAdopt?: (edit: (fields: Partial<ComposeState>) => void) => Promise<void>;
} = {}) {
  localStorage.clear();
  let refusals = refuseStore === true ? Infinity : refuseStore || 0;
  let version = 1;
  const current = (): Ref =>
    version === 1
      ? { gmailMessageId: "message-of-draft", gmailAttachmentId: "part-1" }
      : {
          gmailMessageId: `message-${version}`,
          gmailAttachmentId: `part-${version}`,
        };
  let stored: ComposeState = { ...reopened([draftFile]), savedDraftId };
  const saves: { draftId: string | undefined; refs: string[] }[] = [];
  const writes: ComposeState[] = [];
  let conflicts = 0;
  let secondDrafts = 0;
  let hold: Promise<void> | undefined;
  const metadata = {
    draftId: "r-draft-7",
    backend: "gmail",
    accountEmail: "owner@example.com",
  } as const;

  const saveToGmail = async (sent: ComposeState) => {
    await hold;
    saves.push({ draftId: sent.savedDraftId, refs: refsOf(sent.attachments) });
    if (
      sent.savedDraftId !== "r-draft-7" &&
      sent.savedDraftId !== current().gmailMessageId
    ) {
      secondDrafts += 1;
    }
    const answer = answers.shift() ?? "moved";
    const file = sent.attachments?.[0];
    const from: Ref = {
      gmailMessageId: file?.gmailMessageId ?? "",
      gmailAttachmentId: file?.gmailAttachmentId ?? "",
    };
    version += 1;
    const moved = [{ from, to: current() }];
    return answer === "unconfirmed"
      ? { answer, moved: undefined }
      : { answer, moved };
  };

  mocks.callAction.mockReset();
  mocks.callAction.mockImplementation(async (name: string) => {
    if (name !== "sync-draft-mailbox") throw new Error(`Unexpected ${name}`);
    const { answer, moved } = await saveToGmail(stored);
    const edit = (fields: Partial<ComposeState>) => {
      stored = { ...stored, ...fields };
    };
    if (answer === "busy") {
      await afterAdopt?.(edit);
      return {
        status: "pending",
        errorCode: "draft_mailbox_busy",
        message:
          "The draft kept changing while its mailbox copy was saved, so Mail's copy doesn't name Gmail draft r-draft-7 yet and still names the message Gmail replaced.",
        savedDraft: { ...metadata, movedAttachments: moved },
        unrecordedGmailDraftId: "r-draft-7",
      };
    }
    stored = applyDraftSaveResult(stored, {
      status: "saved",
      ...metadata,
      ...(moved ? { movedAttachments: moved } : {}),
    });
    await afterAdopt?.(edit);
    return moved
      ? {
          status: "synced",
          savedDraft: { ...metadata, movedAttachments: moved },
        }
      : {
          status: "pending",
          errorCode: "draft_attachments_unconfirmed",
          message: unconfirmedMessage,
          savedDraft: metadata,
        };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        if (refusals > 0) {
          refusals -= 1;
          return asJson({ error: "refused" }, 500);
        }
        const { expectedRevision, next } = JSON.parse(String(init.body)) as {
          expectedRevision: string | null;
          next: ComposeState;
        };
        if (expectedRevision !== saveRevisionOf(stored)) {
          conflicts += 1;
          return asJson(
            {
              error: "The draft changed since it was read",
              errorCode: "save_conflict",
              details: {
                current: stored,
                currentRevision: saveRevisionOf(stored),
              },
            },
            409,
          );
        }
        writes.push(next);
        stored = next;
        return asJson({ value: next, revision: saveRevisionOf(next) });
      }
      if (url.endsWith("/application-state/compose")) {
        return asJson([stored]);
      }
      if (url.endsWith("/api/emails/draft")) {
        const sent = JSON.parse(String(init?.body));
        const { moved } = await saveToGmail({
          ...stored,
          savedDraftId: sent.draftId,
          attachments: sent.attachments,
        });
        return moved
          ? asJson({ ...metadata, updated: true, movedAttachments: moved })
          : Response.json(
              {
                error: unconfirmedMessage,
                errorCode: "draft_attachments_unconfirmed",
                ...metadata,
              },
              { status: 502 },
            );
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  );

  const failures: string[] = [];
  const onFailure = (event: Event) =>
    failures.push((event as CustomEvent<{ draftId: string }>).detail.draftId);
  window.addEventListener(DRAFT_SAVE_FAILED_EVENT, onFailure);
  onTestFinished(() =>
    window.removeEventListener(DRAFT_SAVE_FAILED_EVENT, onFailure),
  );

  const open = async () => {
    const qc = new QueryClient();
    const page = renderHook(() => useComposeState(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(page.result.current.drafts).toHaveLength(1));
    const local = () =>
      qc
        .getQueryData<ComposeState[]>(["compose-drafts"])
        ?.find((one) => one.id === "reopened");
    return { ...page, local };
  };
  const { result, local, unmount } = await open();
  const reload = async () => {
    unmount();
    return open();
  };
  const holdSaves = () => {
    let release = () => {};
    hold = new Promise<void>((resolve) => (release = resolve));
    return release;
  };
  return {
    result,
    local,
    saves,
    writes,
    failures,
    holdSaves,
    reload,
    stored: () => stored,
    conflicts: () => conflicts,
    secondDrafts: () => secondDrafts,
  };
}

const fileAt = (version: number) => ({
  ...draftFile,
  gmailMessageId: `message-${version}`,
  gmailAttachmentId: `part-${version}`,
});

describe("useComposeState with a reopened Gmail draft's file", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const autosave = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

  it("keeps the file through two saves, without writing the draft again after each", async () => {
    const { result, local, saves, writes, stored } = await mounted();

    act(() => result.current.update("reopened", { body: "First edit" }));
    await autosave();
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(2)]));
    const writesAfterSync = writes.length;
    await autosave();
    expect(writes).toHaveLength(writesAfterSync);
    expect(saves).toHaveLength(1);

    act(() => result.current.update("reopened", { body: "Second edit" }));
    await autosave();
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(3)]));

    expect(saves).toEqual([
      { draftId: "r-draft-7", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-2/part-2"] },
    ]);
    expect(refsOf(writes[writes.length - 1]?.attachments)).toEqual([
      "message-2/part-2",
    ]);
    expect(stored().attachments).toEqual([fileAt(3)]);
  });

  it("sends the file from where a save running at send time moved it", async () => {
    const { result, local, saves, holdSaves } = await mounted();

    act(() => result.current.update("reopened", { body: "Edited" }));
    const staged = local();
    expect(staged?.attachments).toEqual([draftFile]);
    act(() => result.current.stageForSend("reopened"));
    const release = holdSaves();
    await autosave();

    let sendable: Promise<ComposeState> | undefined;
    act(() => {
      sendable = staged && result.current.settleForSend(staged);
    });
    release();

    await expect(sendable).resolves.toEqual({
      ...staged,
      attachments: [{ ...draftFile, ...moveOfDraftFile.to }],
    });
    expect(saves).toEqual([
      { draftId: "r-draft-7", refs: ["message-of-draft/part-1"] },
    ]);
  });

  it("updates the same Gmail draft and finds the file after Mail lost where a save moved it", async () => {
    const { result, local, saves, failures } = await mounted({
      savedDraftId: "message-of-draft",
      answers: ["unconfirmed"],
    });

    act(() => result.current.update("reopened", { body: "First edit" }));
    await autosave();
    await waitFor(() => expect(local()?.savedDraftId).toBe("r-draft-7"));
    expect(failures).toEqual(["reopened"]);
    expect(local()?.attachments).toEqual([draftFile]);

    act(() => result.current.update("reopened", { body: "Second edit" }));
    await autosave();
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(3)]));

    expect(saves).toEqual([
      { draftId: "message-of-draft", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-of-draft/part-1"] },
    ]);
  });

  it("updates the Gmail draft a sync couldn't record, without making a second", async () => {
    const { result, local, saves, stored, failures, secondDrafts } =
      await mounted({ savedDraftId: "message-of-draft", answers: ["busy"] });

    act(() => result.current.update("reopened", { body: "First edit" }));
    await autosave();
    await waitFor(() => expect(stored().savedDraftId).toBe("r-draft-7"));
    expect(stored().attachments).toEqual([fileAt(2)]);
    expect(failures).toEqual([]);

    act(() => result.current.update("reopened", { body: "Second edit" }));
    await autosave();
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(3)]));

    expect(saves).toEqual([
      { draftId: "message-of-draft", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-2/part-2"] },
    ]);
    expect(secondDrafts()).toBe(0);
  });

  it("records the Gmail draft a sync couldn't record over another writer's edit", async () => {
    const { result, local, saves, stored, secondDrafts } = await mounted({
      savedDraftId: "message-of-draft",
      answers: ["busy"],
      afterAdopt: async (edit) => edit({ subject: "Agent's subject" }),
    });

    act(() => result.current.update("reopened", { body: "First edit" }));
    await autosave();
    await waitFor(() => expect(stored().savedDraftId).toBe("r-draft-7"));
    expect(stored()).toMatchObject({
      subject: "Agent's subject",
      attachments: [fileAt(2)],
    });

    act(() => result.current.update("reopened", { body: "Second edit" }));
    await autosave();
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(3)]));
    expect(saves[1]).toEqual({
      draftId: "r-draft-7",
      refs: ["message-2/part-2"],
    });
    expect(secondDrafts()).toBe(0);
  });

  it("keeps a sync's moved file and Gmail draft ID when the person's next write conflicts with it", async () => {
    let adopted = () => {};
    const syncAdopted = new Promise<void>((resolve) => (adopted = resolve));
    let reply = () => {};
    const replyHeld = new Promise<void>((resolve) => (reply = resolve));
    const { result, local, stored, conflicts } = await mounted({
      savedDraftId: "message-of-draft",
      afterAdopt: async () => {
        adopted();
        await replyHeld;
      },
    });

    act(() => result.current.update("reopened", { body: "First edit" }));
    await autosave();
    await syncAdopted;
    act(() => result.current.update("reopened", { body: "Second edit" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(stored().body).toBe("Second edit"));

    expect(conflicts()).toBe(1);
    expect(stored()).toMatchObject({
      savedDraftId: "r-draft-7",
      attachments: [fileAt(2)],
    });
    reply();
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(2)]));
    expect(local()?.savedDraftId).toBe("r-draft-7");
  });
});

describe("sending a draft whose last save couldn't confirm where its file moved", () => {
  async function afterUnconfirmedSave(
    later: ("moved" | "unconfirmed" | "busy")[],
    options: { refuseStore?: boolean } = {},
  ) {
    const mail = await mounted({
      savedDraftId: "message-of-draft",
      answers: ["unconfirmed", ...later],
      ...options,
    });
    act(() => mail.result.current.update("reopened", { body: "Edited" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(mail.local()?.savedDraftId).toBe("r-draft-7"));
    expect(mail.local()?.attachments).toEqual([draftFile]);
    return mail;
  }

  const healed = fileAt(3);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("saves once more and sends the file from where that save found it", async () => {
    const { result, local, saves } = await afterUnconfirmedSave(["moved"]);
    const staged = local();
    act(() => result.current.stageForSend("reopened"));

    let sendable: ComposeState | undefined;
    await act(async () => {
      sendable = staged && (await result.current.settleForSend(staged));
    });

    expect(saves).toEqual([
      { draftId: "message-of-draft", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-of-draft/part-1"] },
    ]);
    expect(sendable?.attachments).toEqual([healed]);
    expect(local()?.attachments).toEqual([healed]);
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
  });

  it("still saves once more when Mail was reloaded since", async () => {
    const { reload, saves } = await afterUnconfirmedSave(["moved"]);
    const { result, local } = await reload();
    const staged = local();
    expect(staged?.attachments).toEqual([draftFile]);
    act(() => result.current.stageForSend("reopened"));

    let sendable: ComposeState | undefined;
    await act(async () => {
      sendable = staged && (await result.current.settleForSend(staged));
    });

    expect(saves).toEqual([
      { draftId: "message-of-draft", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-of-draft/part-1"] },
    ]);
    expect(sendable?.attachments).toEqual([healed]);
  });

  it("doesn't send when that save fails too", async () => {
    const { result, local, saves } = await afterUnconfirmedSave([
      "unconfirmed",
    ]);
    const staged = local();
    act(() => result.current.stageForSend("reopened"));

    let settled: Promise<ComposeState> | undefined;
    act(() => {
      settled = staged && result.current.settleForSend(staged);
    });

    await expect(settled).rejects.toMatchObject({
      errorCode: "draft_attachments_unconfirmed",
    });
    expect(saves).toHaveLength(2);
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(local()?.attachments).toEqual([draftFile]);
  });

  it("sends without another save once a later save found the file", async () => {
    const { result, local, saves } = await afterUnconfirmedSave(["moved"]);
    act(() => result.current.update("reopened", { body: "Edited again" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(local()?.attachments).toEqual([healed]));
    const staged = local();
    act(() => result.current.stageForSend("reopened"));

    let sendable: ComposeState | undefined;
    await act(async () => {
      sendable = staged && (await result.current.settleForSend(staged));
    });

    expect(saves).toHaveLength(2);
    expect(sendable?.attachments).toEqual([healed]);
  });

  it("sends without another save once the person removed the file", async () => {
    const { result, local, saves, stored } = await afterUnconfirmedSave([
      "unconfirmed",
    ]);
    act(() => result.current.update("reopened", { attachments: [] }));
    await waitFor(() => expect(stored().attachments).toEqual([]));
    const staged = local();
    act(() => result.current.stageForSend("reopened"));

    let sendable: ComposeState | undefined;
    await act(async () => {
      sendable = staged && (await result.current.settleForSend(staged));
    });

    expect(sendable?.attachments).toEqual([]);
    expect(saves).toHaveLength(1);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });

  it("doesn't send a draft Mail's store refused when Mail's draft route can't find the file either", async () => {
    const { result, local, saves } = await afterUnconfirmedSave(
      ["unconfirmed"],
      { refuseStore: true },
    );
    const staged = local();
    act(() => result.current.stageForSend("reopened"));

    let settled: Promise<ComposeState> | undefined;
    act(() => {
      settled = staged && result.current.settleForSend(staged);
    });

    await expect(settled).rejects.toMatchObject({
      name: "DraftSaveIncompleteError",
    });
    expect(saves).toEqual([
      { draftId: "message-of-draft", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-of-draft/part-1"] },
    ]);
    expect(mocks.callAction).not.toHaveBeenCalled();
  });
});

describe("useComposeState when Mail's store refuses a reopened draft", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("saves the text on screen to the same Gmail draft and keeps its moved file", async () => {
    const { result, local, saves } = await mounted({
      savedDraftId: "message-of-draft",
      refuseStore: true,
    });

    act(() => result.current.update("reopened", { body: "First edit" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(2)]));
    expect(local()?.savedDraftId).toBe("r-draft-7");

    act(() => result.current.update("reopened", { body: "Second edit" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(local()?.attachments).toEqual([fileAt(3)]));

    expect(saves).toEqual([
      { draftId: "message-of-draft", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-2/part-2"] },
    ]);
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("stores the Gmail draft's ID from a route save whose file Mail couldn't confirm", async () => {
    const { result, local, stored } = await mounted({
      savedDraftId: "message-of-draft",
      answers: ["unconfirmed"],
      refuseStore: 1,
    });

    act(() => result.current.update("reopened", { body: "First edit" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(stored().savedDraftId).toBe("r-draft-7"));

    expect(stored()).toMatchObject({
      body: "First edit",
      attachments: [draftFile],
    });
    expect(local()?.savedDraftId).toBe("r-draft-7");
    expect(mocks.callAction).not.toHaveBeenCalled();
  });
});
