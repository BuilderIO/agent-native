// @vitest-environment happy-dom

import {
  SaveOverlapError,
  type SaveOverlap,
} from "@agent-native/core/save-conflict";
import type { ComposeState } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DRAFT_SAVE_FAILED_EVENT,
  setDraftOverlapResolver,
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

let nextDraft = 0;

/** A mounted compose hook over a server that holds each save until released. */
async function mounted() {
  nextDraft += 1;
  const id = `refetched-${nextDraft}`;
  const stored: ComposeState = {
    id,
    to: "",
    subject: "A",
    body: "B",
    mode: "compose",
    savedDraftId: "saved",
    savedDraftBackend: "local",
  };
  const sent: ComposeState[] = [];
  const posted: Record<string, unknown>[] = [];
  const answers: ((response: Response) => void)[] = [];
  const answer = (index: number, response: Response) =>
    answers[index]?.(response);
  const drops: ((error: Error) => void)[] = [];
  const drop = (index: number) =>
    drops[index]?.(new TypeError("Failed to fetch"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        sent.push(JSON.parse(String(init.body)).next);
        return new Promise<Response>((resolve, reject) => {
          answers.push(resolve);
          drops.push(reject);
        });
      }
      if (url.endsWith("/application-state/compose")) return asJson([stored]);
      if (init?.method === "POST") posted.push(JSON.parse(String(init.body)));
      return asJson({ draftId: "saved", backend: "local" });
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
      ?.find((one) => one.id === id);
  return { id, stored, sent, posted, answer, drop, result, local };
}

describe("useComposeState", () => {
  let failures: Event[];
  const onFailure = (event: Event) => failures.push(event);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.callAction.mockReset();
    failures = [];
    window.addEventListener(DRAFT_SAVE_FAILED_EVENT, onFailure);
  });

  afterEach(() => {
    window.removeEventListener(DRAFT_SAVE_FAILED_EVENT, onFailure);
    setDraftOverlapResolver(undefined);
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps an edit through a refetch while its save waits behind another", async () => {
    const { id, sent, answer, result, local } = await mounted();

    act(() => result.current.update(id, { subject: "B" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    act(() => {
      result.current.update(id, { subject: "C" });
      void result.current.flush(id);
    });
    await act(async () => {
      await result.current.refetch();
    });
    expect(local()?.subject).toBe("C");

    act(() => answer(0, asJson({ error: "down" }, 500)));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.subject).toBe("C");

    act(() => answer(1, asJson({ value: sent[1], revision: "rev_saved" })));
  });

  it("lets a refetch replace a draft once nothing is waiting to save", async () => {
    const { id, stored, sent, answer, result, local } = await mounted();

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      answer(0, asJson({ value: sent[0], revision: "rev_saved" }));
    });

    stored.subject = "Another tab";
    await waitFor(async () => {
      await act(async () => {
        await result.current.refetch();
      });
      expect(local()?.subject).toBe("Another tab");
    });
  });

  it("doesn't report a failed save twice when the prompt already said so", async () => {
    const { id, stored, sent, answer, result } = await mounted();
    const asked = vi.fn(async (overlap: SaveOverlap<ComposeState>) => {
      throw new SaveOverlapError(overlap);
    });
    setDraftOverlapResolver(asked);

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const theirs = { ...stored, subject: "Theirs" };
    await act(async () => {
      answer(
        0,
        asJson(
          {
            error: "stale",
            errorCode: "save_conflict",
            details: { current: theirs, currentRevision: "rev_theirs" },
          },
          409,
        ),
      );
    });

    await waitFor(() => expect(asked).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(failures).toHaveLength(0);
  });

  it("reports an overlap nobody was there to answer", async () => {
    const { id, stored, sent, answer, result } = await mounted();

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const theirs = { ...stored, subject: "Theirs" };
    await act(async () => {
      answer(
        0,
        asJson(
          {
            error: "stale",
            errorCode: "save_conflict",
            details: { current: theirs, currentRevision: "rev_theirs" },
          },
          409,
        ),
      );
    });

    await waitFor(() => expect(failures).toHaveLength(1));
  });

  it("doesn't save the draft again after a sync gives it a new mailbox copy", async () => {
    const { id, sent, answer, result, local } = await mounted();
    mocks.callAction.mockResolvedValue({
      status: "synced",
      savedDraft: {
        draftId: "gmail-new",
        backend: "gmail",
        accountEmail: "me@example.com",
      },
    });

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      answer(0, asJson({ value: sent[0], revision: "rev_saved" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(local()?.savedDraftId).toBe("gmail-new"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(mocks.callAction).toHaveBeenCalledWith("sync-draft-mailbox", { id });
    // A write here would store text the sync never copied, and nothing syncs after it.
    expect(sent).toHaveLength(1);
    expect(local()?.subject).toBe("Mine");
  });

  it("saves the text on screen to the mailbox when the store refuses the draft", async () => {
    const { id, sent, posted, answer, result } = await mounted();

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      answer(0, asJson({ error: "refused" }, 500));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ subject: "Mine", draftId: "saved" });
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("saves the text on screen to the mailbox when the write never reaches the store", async () => {
    const { id, sent, posted, drop, result } = await mounted();

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      drop(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ subject: "Mine", draftId: "saved" });
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("waits for a queued write before choosing how to save the mailbox copy", async () => {
    const { id, sent, posted, answer, result } = await mounted();

    act(() => {
      result.current.update(id, { subject: "Mine" });
      void result.current.flush(id)?.catch(() => undefined);
    });
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      answer(0, asJson({ error: "refused" }, 500));
    });

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("goes back to the sync once the store takes the draft", async () => {
    const { id, sent, posted, answer, result } = await mounted();
    mocks.callAction.mockResolvedValue({
      status: "synced",
      savedDraft: { draftId: "saved", backend: "local" },
    });

    act(() => result.current.update(id, { subject: "Refused" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      answer(0, asJson({ error: "refused" }, 500));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(posted).toHaveLength(1));

    act(() => result.current.update(id, { subject: "Stored" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    await act(async () => {
      answer(1, asJson({ value: sent[1], revision: "rev_saved" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith("sync-draft-mailbox", {
        id,
      }),
    );
    expect(posted).toHaveLength(1);
  });

  it("syncs after losing a conflict, even if the store refused an earlier write", async () => {
    const { id, stored, sent, posted, answer, result } = await mounted();
    mocks.callAction.mockResolvedValue({
      status: "synced",
      savedDraft: { draftId: "saved", backend: "local" },
    });

    act(() => result.current.update(id, { subject: "Refused" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      answer(0, asJson({ error: "refused" }, 500));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    await waitFor(() => expect(posted).toHaveLength(1));

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    await act(async () => {
      answer(
        1,
        asJson(
          {
            error: "stale",
            errorCode: "save_conflict",
            details: {
              current: { ...stored, subject: "Theirs" },
              currentRevision: "rev_theirs",
            },
          },
          409,
        ),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // Sending "Mine" here is what would leave a losing save's text in Gmail.
    await waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith("sync-draft-mailbox", {
        id,
      }),
    );
    expect(posted).toHaveLength(1);
  });

  it("reports any other failed save", async () => {
    const { id, sent, answer, result } = await mounted();

    act(() => result.current.update(id, { subject: "Mine" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(async () => {
      answer(0, asJson({ error: "down" }, 500));
    });

    await waitFor(() => expect(failures).toHaveLength(1));
  });
});
