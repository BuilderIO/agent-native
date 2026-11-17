// @vitest-environment happy-dom

import type { ComposeAttachment, ComposeState } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab",
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
}));

const asJson = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

// A draft reopened from Drafts holds files read from the Gmail message it had
// then, and Gmail replaces that message every time the draft is saved.
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
    // While the save ran, another file was removed and an upload added.
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

/**
 * A mounted compose hook over a Mail server whose Gmail, like the real one,
 * moves the draft's file to a new message on every save and can't read it
 * from the old one.
 */
async function mounted() {
  let version = 1;
  const saves: { status: number; refs: string[] }[] = [];
  let hold: Promise<void> | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const next = JSON.parse(String(init.body)).next;
        return asJson({ value: next, revision: `rev-${Date.now()}` });
      }
      if (url.endsWith("/application-state/compose")) {
        return asJson([reopened([draftFile])]);
      }
      if (url.endsWith("/api/emails/draft")) {
        await hold;
        const sent: ComposeAttachment[] =
          JSON.parse(String(init?.body)).attachments ?? [];
        const refs = sent.map(
          (file) => `${file.gmailMessageId}/${file.gmailAttachmentId}`,
        );
        const current =
          version === 1
            ? "message-of-draft/part-1"
            : `message-${version}/part-${version}`;
        if (refs[0] !== current) {
          saves.push({ status: 400, refs });
          return asJson(
            { error: "One or more attachments could not be read" },
            400,
          );
        }
        saves.push({ status: 200, refs });
        const from = current.split("/");
        version += 1;
        return asJson({
          draftId: "r-draft-7",
          backend: "gmail",
          accountEmail: "owner@example.com",
          updated: true,
          movedAttachments: [
            {
              from: { gmailMessageId: from[0], gmailAttachmentId: from[1] },
              to: {
                gmailMessageId: `message-${version}`,
                gmailAttachmentId: `part-${version}`,
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  );

  const qc = new QueryClient();
  const { result } = renderHook(() => useComposeState(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(result.current.drafts).toHaveLength(1));
  const local = () =>
    qc
      .getQueryData<ComposeState[]>(["compose-drafts"])
      ?.find((one) => one.id === "reopened");
  const holdSaves = () => {
    let release = () => {};
    hold = new Promise<void>((resolve) => (release = resolve));
    return release;
  };
  return { result, local, saves, holdSaves };
}

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

  it("keeps the file through two saves", async () => {
    const { result, local, saves } = await mounted();

    act(() => result.current.update("reopened", { body: "First edit" }));
    await autosave();
    await waitFor(() =>
      expect(local()?.attachments?.[0]?.gmailMessageId).toBe("message-2"),
    );
    act(() => result.current.update("reopened", { body: "Second edit" }));
    await autosave();
    await waitFor(() =>
      expect(local()?.attachments?.[0]?.gmailMessageId).toBe("message-3"),
    );

    expect(saves).toEqual([
      { status: 200, refs: ["message-of-draft/part-1"] },
      { status: 200, refs: ["message-2/part-2"] },
    ]);
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
    expect(saves).toEqual([{ status: 200, refs: ["message-of-draft/part-1"] }]);
  });

  it("updates the same Gmail draft and finds the file after Mail lost where a save moved it", async () => {
    const saves: { draftId?: string; refs: string[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const next = JSON.parse(String(init.body)).next;
          return asJson({ value: next, revision: `rev-${Date.now()}` });
        }
        if (url.endsWith("/application-state/compose")) {
          return asJson([
            { ...reopened([draftFile]), savedDraftId: "message-of-draft" },
          ]);
        }
        if (url.endsWith("/api/emails/draft")) {
          const sent = JSON.parse(String(init?.body));
          saves.push({
            draftId: sent.draftId,
            refs: (sent.attachments as ComposeAttachment[]).map(
              (file) => `${file.gmailMessageId}/${file.gmailAttachmentId}`,
            ),
          });
          // Gmail took the first update, then Mail couldn't read its parts.
          if (saves.length === 1) {
            return Response.json(
              {
                error:
                  "Gmail saved the draft, but Mail couldn't confirm where its attachments moved (Backend Error). Saving the draft again finds them.",
                errorCode: "draft_attachments_unconfirmed",
                draftId: "r-draft-7",
                backend: "gmail",
                accountEmail: "owner@example.com",
              },
              { status: 502 },
            );
          }
          // A save naming the draft finds the file in its current message.
          if (sent.draftId !== "r-draft-7") {
            return asJson({ error: "Saved Gmail draft was not found" }, 409);
          }
          return asJson({
            draftId: "r-draft-7",
            backend: "gmail",
            accountEmail: "owner@example.com",
            updated: true,
            movedAttachments: [
              {
                from: moveOfDraftFile.from,
                to: {
                  gmailMessageId: "message-3",
                  gmailAttachmentId: "part-3",
                },
              },
            ],
          });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const failures: string[] = [];
    const onFailure = (event: Event) =>
      failures.push((event as CustomEvent<{ draftId: string }>).detail.draftId);
    window.addEventListener(DRAFT_SAVE_FAILED_EVENT, onFailure);
    const qc = new QueryClient();
    const { result } = renderHook(() => useComposeState(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.drafts).toHaveLength(1));
    const local = () =>
      qc
        .getQueryData<ComposeState[]>(["compose-drafts"])
        ?.find((one) => one.id === "reopened");

    act(() => result.current.update("reopened", { body: "First edit" }));
    await autosave();
    await waitFor(() => expect(local()?.savedDraftId).toBe("r-draft-7"));
    expect(failures).toEqual(["reopened"]);
    expect(local()?.attachments).toEqual([draftFile]);

    act(() => result.current.update("reopened", { body: "Second edit" }));
    await autosave();
    await waitFor(() =>
      expect(local()?.attachments?.[0]?.gmailMessageId).toBe("message-3"),
    );
    window.removeEventListener(DRAFT_SAVE_FAILED_EVENT, onFailure);

    expect(saves).toEqual([
      { draftId: "message-of-draft", refs: ["message-of-draft/part-1"] },
      { draftId: "r-draft-7", refs: ["message-of-draft/part-1"] },
    ]);
    expect(local()?.attachments).toEqual([
      {
        ...draftFile,
        gmailMessageId: "message-3",
        gmailAttachmentId: "part-3",
      },
    ]);
  });
});

describe("sending a draft whose last save couldn't confirm where its file moved", () => {
  const unconfirmed = () =>
    Response.json(
      {
        error:
          "Gmail saved the draft, but Mail couldn't confirm where its attachments moved (Backend Error). Saving the draft again finds them.",
        errorCode: "draft_attachments_unconfirmed",
        draftId: "r-draft-7",
        backend: "gmail",
        accountEmail: "owner@example.com",
      },
      { status: 502 },
    );

  /**
   * A mounted compose hook whose first mailbox save Gmail keeps without Mail
   * learning where the file went. Each later save answers with `later` in
   * turn: "found" heals the file's refs to message-3, "failed" fails again.
   */
  async function afterUnconfirmedSave(later: ("found" | "failed")[]) {
    const saves: { draftId?: string; refs: string[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          const next = JSON.parse(String(init.body)).next;
          return asJson({ value: next, revision: `rev-${Date.now()}` });
        }
        if (url.endsWith("/application-state/compose")) {
          return asJson([
            { ...reopened([draftFile]), savedDraftId: "message-of-draft" },
          ]);
        }
        if (url.endsWith("/api/emails/draft")) {
          const sent = JSON.parse(String(init?.body));
          saves.push({
            draftId: sent.draftId,
            refs: (sent.attachments as ComposeAttachment[]).map(
              (file) => `${file.gmailMessageId}/${file.gmailAttachmentId}`,
            ),
          });
          if (saves.length === 1) return unconfirmed();
          if (later[saves.length - 2] !== "found") return unconfirmed();
          return asJson({
            draftId: "r-draft-7",
            backend: "gmail",
            accountEmail: "owner@example.com",
            updated: true,
            movedAttachments: [
              {
                from: moveOfDraftFile.from,
                to: {
                  gmailMessageId: "message-3",
                  gmailAttachmentId: "part-3",
                },
              },
            ],
          });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const qc = new QueryClient();
    const { result } = renderHook(() => useComposeState(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.drafts).toHaveLength(1));
    const local = () =>
      qc
        .getQueryData<ComposeState[]>(["compose-drafts"])
        ?.find((one) => one.id === "reopened");

    act(() => result.current.update("reopened", { body: "Edited" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(local()?.savedDraftId).toBe("r-draft-7"));
    expect(local()?.attachments).toEqual([draftFile]);
    return { result, local, saves };
  }

  const healed = {
    ...draftFile,
    gmailMessageId: "message-3",
    gmailAttachmentId: "part-3",
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("saves once more and sends the file from where that save found it", async () => {
    const { result, local, saves } = await afterUnconfirmedSave(["found"]);
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
  });

  it("doesn't send when that save fails too", async () => {
    const { result, local, saves } = await afterUnconfirmedSave(["failed"]);
    const staged = local();
    act(() => result.current.stageForSend("reopened"));

    let settled: Promise<ComposeState> | undefined;
    act(() => {
      settled = staged && result.current.settleForSend(staged);
    });

    await expect(settled).rejects.toMatchObject({
      name: "DraftSaveIncompleteError",
    });
    expect(saves).toHaveLength(2);
    expect(local()?.attachments).toEqual([draftFile]);
  });

  it("sends without another save once a later save found the file", async () => {
    const { result, local, saves } = await afterUnconfirmedSave(["found"]);
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
});
