// @vitest-environment happy-dom

import type { ConversationSummary, EmailMessage } from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

import { useThreadSummaryPanel } from "./use-thread-summary";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function message(id: string, day: number): EmailMessage {
  return {
    id,
    threadId: "t",
    from: { name: "Ana", email: "ana@example.com" },
    to: [],
    subject: "Launch",
    snippet: "",
    body: "",
    date: new Date(Date.UTC(2026, 10, day)).toISOString(),
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
  };
}

function summary(threadId: string, lastMessageId: string): ConversationSummary {
  return {
    threadId,
    accountEmail: "me@example.com",
    line: "Launch moves to Friday.",
    points: ["Ana asked to ship Friday"],
    lastMessageId,
    messageCount: 1,
    updatedAt: 1,
  };
}

function serve(
  stored: ConversationSummary | null,
  summarize?: () => Promise<unknown>,
) {
  mocks.callAction.mockImplementation((name: string) => {
    if (name === "get-thread-summary") {
      return Promise.resolve({ summary: stored });
    }
    if (name === "summarize-thread" && summarize) return summarize();
    return Promise.reject(new Error(`unexpected ${name}`));
  });
}

function summarizeCalls() {
  return mocks.callAction.mock.calls.filter(
    ([name]) => name === "summarize-thread",
  ).length;
}

type PanelProps = { messages: EmailMessage[]; threadId?: string };

function renderPanel(threadId: string, messages: EmailMessage[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const initialProps: PanelProps = { messages };
  return renderHook(
    (props: PanelProps) =>
      useThreadSummaryPanel({
        accountEmail: "me@example.com",
        threadId: props.threadId ?? threadId,
        threadMessages: props.messages,
        messagesSettled: true,
      }),
    { wrapper, initialProps },
  );
}

describe("useThreadSummaryPanel", () => {
  it("stays closed until asked, then summarizes once and shows the result", async () => {
    serve(null, async () => ({
      summary: summary("t-ask", "m1"),
      cached: false,
    }));
    const { result } = renderPanel("t-ask", [message("m1", 1)]);
    await waitFor(() =>
      expect(mocks.callAction).toHaveBeenCalledWith(
        "get-thread-summary",
        { accountEmail: "me@example.com", threadId: "t-ask" },
        { method: "GET" },
      ),
    );
    expect(result.current.open).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    await waitFor(() =>
      expect(result.current.summary?.lastMessageId).toBe("m1"),
    );
    expect(summarizeCalls()).toBe(1);
  });

  it("shows a stored summary on open and refreshes it once per new message", async () => {
    serve(summary("t-stale", "m1"), () =>
      Promise.reject(new Error("model down")),
    );
    const { result, rerender } = renderPanel("t-stale", [
      message("m1", 1),
      message("m2", 2),
    ]);
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.open).toBe(true);
    expect(result.current.summary?.lastMessageId).toBe("m1");
    rerender({ messages: [message("m1", 1), message("m2", 2)] });
    await act(async () => {});
    expect(summarizeCalls()).toBe(1);

    rerender({
      messages: [message("m1", 1), message("m2", 2), message("m3", 3)],
    });
    await waitFor(() => expect(summarizeCalls()).toBe(2));
  });

  it("keeps each thread's run while another thread is summarized", async () => {
    const releases: Array<() => void> = [];
    mocks.callAction.mockImplementation(
      (name: string, input: { threadId: string }) => {
        if (name === "get-thread-summary") {
          return Promise.resolve({ summary: null });
        }
        return new Promise((resolve) => {
          releases.push(() =>
            resolve({ summary: summary(input.threadId, "m1"), cached: false }),
          );
        });
      },
    );
    const messages = [message("m1", 1)];
    const { result, rerender } = renderPanel("t-a", messages);
    act(() => result.current.toggle());
    expect(result.current.pending).toBe(true);

    rerender({ messages, threadId: "t-b" });
    expect(result.current.pending).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.pending).toBe(true);

    rerender({ messages, threadId: "t-a" });
    expect(result.current.pending).toBe(true);
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(summarizeCalls()).toBe(2);

    await act(async () => releases[0]?.());
    await waitFor(() => expect(result.current.summary?.threadId).toBe("t-a"));
    expect(result.current.pending).toBe(false);
  });

  it("keeps a hidden summary hidden, and shows it again without a model call", async () => {
    serve(summary("t-hide", "m1"));
    const { result } = renderPanel("t-hide", [message("m1", 1)]);
    await waitFor(() => expect(result.current.open).toBe(true));

    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    expect(summarizeCalls()).toBe(0);
  });
});
