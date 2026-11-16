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
vi.mock("@agent-native/core/client/hooks", () => ({
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
  const answers: ((response: Response) => void)[] = [];
  const answer = (index: number, response: Response) =>
    answers[index]?.(response);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        sent.push(JSON.parse(String(init.body)).next);
        return new Promise<Response>((resolve) => answers.push(resolve));
      }
      if (url.endsWith("/application-state/compose")) return asJson([stored]);
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
  return { id, stored, sent, answer, result, local };
}

describe("useComposeState", () => {
  let failures: Event[];
  const onFailure = (event: Event) => failures.push(event);

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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
