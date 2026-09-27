// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendToAgentChat } from "./agent-chat.js";
import {
  askUserQuestion,
  GuidedQuestionFlow,
  useGuidedQuestionFlow,
} from "./guided-questions.js";
import {
  bumpChangeVersion,
  _resetChangeVersionStoreForTests,
} from "./use-change-version.js";

vi.mock("./agent-chat.js", () => ({
  sendToAgentChat: vi.fn(),
}));

const sendToAgentChatMock = vi.mocked(sendToAgentChat);

const STATE_PREFIX = "/_agent-native/application-state/";
const BATCH_PREFIX = "/_agent-native/application-state?keys=";

function keyFromUrl(url: string): string {
  const idx = url.indexOf(STATE_PREFIX);
  return idx >= 0 ? url.slice(idx + STATE_PREFIX.length) : url;
}

function keysFromUrl(url: string): string[] {
  const idx = url.indexOf(BATCH_PREFIX);
  if (idx < 0) return [keyFromUrl(url)];
  return url
    .slice(idx + BATCH_PREFIX.length)
    .split(",")
    .map(decodeURIComponent);
}

function readResponse(url: string, lookup: (key: string) => string): Response {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const key of keysFromUrl(url)) {
    const raw = lookup(key);
    if (raw) values[key] = JSON.parse(raw);
    else missing.push(key);
  }
  return new Response(JSON.stringify({ values, missing }), { status: 200 });
}

const payload = {
  questions: [
    {
      id: "q1",
      type: "text-options" as const,
      question: "Which range?",
      options: [{ label: "7d", value: "7d" }],
    },
  ],
};

type HookResult = ReturnType<typeof useGuidedQuestionFlow>;

describe("useGuidedQuestionFlow scoped reads", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    _resetChangeVersionStoreForTests();
    sendToAgentChatMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _resetChangeVersionStoreForTests();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }

  async function renderFlow(
    options: Parameters<typeof useGuidedQuestionFlow>[0],
  ): Promise<{ current: () => HookResult }> {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let latest: HookResult | null = null;
    function Harness() {
      latest = useGuidedQuestionFlow({
        providerStatusChecksEnabled: false,
        ...options,
      });
      return null;
    }
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    for (let i = 0; i < 20 && !latest?.questions; i += 1) {
      await flush();
    }
    return { current: () => latest as HookResult };
  }

  it("reads the tab-scoped key first when a browserTabId is provided", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(...keysFromUrl(String(input)));
        return readResponse(String(input), (key) =>
          key === "guided-questions:tab123" ? JSON.stringify(payload) : "",
        );
      }),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      refetchInterval: false,
    });

    expect(result.current().questions?.length).toBe(1);
    expect(seen).toContain("guided-questions:tab123");
  });

  it("reads the bare key (no `:undefined` suffix) when no tab id is provided", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(...keysFromUrl(String(input)));
      return readResponse(String(input), (key) =>
        key === "guided-questions" ? JSON.stringify(payload) : "",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });

    expect(result.current().questions?.length).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
    const requestedKeys = fetchMock.mock.calls.flatMap((call) =>
      keysFromUrl(String(call[0])),
    );
    expect(requestedKeys).toContain("guided-questions");
    expect(requestedKeys).not.toContain("guided-questions:undefined");
  });

  it("hides a question asked in another chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        readResponse(String(input), (key) =>
          key === "guided-questions:tab123"
            ? JSON.stringify({ ...payload, threadId: "chat-a" })
            : "",
        ),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      threadId: "chat-b",
      refetchInterval: false,
    });

    expect(result.current().questions).toBeNull();
    expect(result.current().payload).toBeNull();
  });

  it("renders a question in the chat that asked it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        readResponse(String(input), (key) =>
          key === "guided-questions:tab123"
            ? JSON.stringify({ ...payload, threadId: "chat-a" })
            : "",
        ),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      threadId: "chat-a",
      refetchInterval: false,
    });

    expect(result.current().questions?.length).toBe(1);
  });

  it("renders a payload with no threadId in any chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        readResponse(String(input), (key) =>
          key === "guided-questions:tab123" ? JSON.stringify(payload) : "",
        ),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      threadId: "chat-b",
      refetchInterval: false,
    });

    expect(result.current().questions?.length).toBe(1);
  });

  it("does not read application state when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await renderFlow({
      enabled: false,
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
    });

    expect(result.current().questions).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refetches on a key-specific DB-sync wakeup without fixed polling", async () => {
    let hasQuestion = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      readResponse(String(input), () =>
        hasQuestion ? JSON.stringify(payload) : "",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
    });
    expect(result.current().questions).toBeNull();
    const initialReads = fetchMock.mock.calls.length;

    hasQuestion = true;
    await act(async () => {
      bumpChangeVersion("app-state:guided-questions", 10);
      await Promise.resolve();
    });
    for (let i = 0; i < 20 && !result.current().questions; i += 1) {
      await flush();
    }

    expect(result.current().questions?.length).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(initialReads + 1);
  });

  it("confirms a question written after the caller's own trigger, without a DB-sync wakeup", async () => {
    let hasQuestion = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        readResponse(String(input), () =>
          hasQuestion ? JSON.stringify(payload) : "",
        ),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });
    expect(result.current().questions).toBeNull();

    hasQuestion = true;
    let stillWaiting = false;
    await act(async () => {
      stillWaiting = await result.current().refetchPendingQuestion();
    });

    expect(stillWaiting).toBe(true);
    for (let i = 0; i < 20 && !result.current().questions; i += 1) {
      await flush();
    }
    expect(result.current().questions?.length).toBe(1);
  });

  it("keeps active questions visible while a DB-sync refresh is pending", async () => {
    let reads = 0;
    let resolveRefresh: (() => void) | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      reads += 1;
      const body = () =>
        readResponse(String(input), () => JSON.stringify(payload));
      if (reads === 1) return Promise.resolve(body());
      return new Promise<Response>((resolve) => {
        resolveRefresh = () => resolve(body());
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
    });
    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      bumpChangeVersion("app-state:guided-questions", 10);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    for (let i = 0; i < 20 && fetchMock.mock.calls.length < 2; i += 1) {
      await flush();
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current().questions).toEqual(payload.questions);

    await act(async () => {
      resolveRefresh?.();
      await Promise.resolve();
    });
  });

  it("DELETEs the scoped key on clear so the card does not reappear", async () => {
    const deleted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          deleted.push(keyFromUrl(String(input)));
          return new Response("", { status: 200 });
        }
        return readResponse(String(input), (key) =>
          key === "guided-questions:tab123" ? JSON.stringify(payload) : "",
        );
      }),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      refetchInterval: false,
    });

    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      result.current().clear();
      await Promise.resolve();
    });
    await flush();

    expect(deleted).toContain("guided-questions:tab123");
  });

  // The agent ids every question it asks `q1`, so an answer that travels as
  // `q1: 7d` only means something while the turn that asked it survives
  // history trimming alongside it. When it did not, the agent re-asked the
  // same scope questions instead of proceeding. The submitted context must
  // carry the question itself.
  it("sends the question text and a settled marker with the answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        readResponse(String(input), (key) =>
          key === "guided-questions:tab123" ? JSON.stringify(payload) : "",
        ),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      refetchInterval: false,
    });
    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      result.current().handleSubmit({ q1: "7d" });
      await Promise.resolve();
    });

    expect(sendToAgentChatMock).toHaveBeenCalledTimes(1);
    const context = sendToAgentChatMock.mock.calls[0][0].context ?? "";
    expect(context).toContain("Q: Which range?");
    expect(context).toContain("A: 7d");
    expect(context).not.toContain("q1: 7d");
    expect(context.toLowerCase()).toContain("settled");
  });

  it("adds the settled instruction to custom submit contexts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        readResponse(String(input), (key) =>
          key === "guided-questions:tab123" ? JSON.stringify(payload) : "",
        ),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      browserTabId: "tab123",
      refetchInterval: false,
      buildSubmitContext: () => "Custom submit context",
    });

    await act(async () => {
      result.current().handleSubmit({ q1: "7d" });
      await Promise.resolve();
    });

    const context = sendToAgentChatMock.mock.calls[0][0].context ?? "";
    expect(context).toContain("Custom submit context");
    expect(context).toContain(
      "Treat every question below as settled: do not ask it again",
    );
  });

  function appStateFetchMock(store: Map<string, string>) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = keyFromUrl(String(input));
      const method = init?.method ?? "GET";
      if (method === "PUT") {
        store.set(key, String(init?.body ?? ""));
        return new Response("", { status: 200 });
      }
      if (method === "DELETE") {
        store.delete(key);
        return new Response("", { status: 200 });
      }
      return readResponse(String(input), (readKey) => store.get(readKey) ?? "");
    });
  }

  it("resolves with the selected value when the user submits", async () => {
    vi.stubGlobal("fetch", appStateFetchMock(new Map<string, string>()));

    const answer = askUserQuestion({
      question: "How long should this deck be?",
      options: [
        { label: "Short", value: "short" },
        { label: "Medium", value: "medium" },
      ],
      allowFreeText: false,
    });
    await flush();

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      providerStatusChecksEnabled: true,
      providerStatus: "missing",
      refetchInterval: false,
    });
    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      result.current().handleSubmit({ q1: "medium" });
      await Promise.resolve();
    });

    await expect(answer).resolves.toBe("medium");
  });

  it("blocks agent answers until provider status is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        readResponse(String(input), (key) =>
          key === "guided-questions" ? JSON.stringify(payload) : "",
        ),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      providerStatusChecksEnabled: true,
      providerStatus: "missing",
      refetchInterval: false,
    });

    await act(async () => {
      result.current().handleSubmit({ q1: "7d" });
      result.current().handleSkip();
      await Promise.resolve();
    });

    expect(result.current().isSubmissionBlocked).toBe(true);
    expect(sendToAgentChatMock).not.toHaveBeenCalled();
  });

  it("resolves null when the user skips", async () => {
    vi.stubGlobal("fetch", appStateFetchMock(new Map<string, string>()));

    const answer = askUserQuestion({
      question: "How long should this deck be?",
      options: [
        { label: "Short", value: "short" },
        { label: "Medium", value: "medium" },
      ],
      allowFreeText: false,
    });
    await flush();

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });
    expect(result.current().questions?.length).toBe(1);

    await act(async () => {
      result.current().handleSkip();
      await Promise.resolve();
    });

    await expect(answer).resolves.toBeNull();
  });

  it("submits a single-select answer immediately when requested", async () => {
    const onSubmit = vi.fn();

    await act(async () => {
      root.render(
        <GuidedQuestionFlow
          title="Pick a direction"
          questions={[
            {
              id: "variant",
              type: "text-options",
              question: "Which screen should I keep?",
              required: true,
              allowOther: false,
              includeExplore: false,
              includeDecide: false,
              submitOnSelect: true,
              options: [
                { label: "Pure White", value: "pure-white" },
                { label: "Soft Cards", value: "soft-cards" },
              ],
            },
          ]}
          onSubmit={onSubmit}
          onSkip={vi.fn()}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Soft Cards"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledWith({ variant: "soft-cards" });
  });

  it("disables question inputs and continuation controls while provider setup is required", async () => {
    const onSubmit = vi.fn();
    const onSkip = vi.fn();

    await act(async () => {
      root.render(
        <GuidedQuestionFlow
          questions={[
            {
              id: "variant",
              type: "text-options",
              question: "Which screen should I keep?",
              required: true,
              submitOnSelect: true,
              options: [{ label: "Soft Cards", value: "soft-cards" }],
            },
          ]}
          onSubmit={onSubmit}
          onSkip={onSkip}
          isSubmissionBlocked
          providerStatus="unavailable"
        />,
      );
    });

    const softCards = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Soft Cards"),
    );
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(container.textContent).toContain("Couldn't check AI connection.");

    await act(async () => {
      softCards?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("submits selected option values as authoritative context", async () => {
    const selectedInstruction =
      'Keep "Command Deck" (variant-command-deck.html, file id file-command). Then call edit-design with fileId file-command.';
    vi.stubGlobal(
      "fetch",
      appStateFetchMock(
        new Map([
          [
            "guided-questions",
            JSON.stringify({
              submitMessage: "Use this design direction.",
              questions: [
                {
                  id: "variant",
                  type: "text-options",
                  question: "Which screen should I keep?",
                  required: true,
                  allowOther: false,
                  includeExplore: false,
                  includeDecide: false,
                  submitOnSelect: true,
                  options: [
                    { label: "Command Deck", value: selectedInstruction },
                  ],
                },
              ],
            }),
          ],
        ]),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });

    await act(async () => {
      result.current().handleSubmit({ variant: selectedInstruction });
      await Promise.resolve();
    });

    expect(sendToAgentChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Use this design direction.",
        context: expect.stringContaining(
          "Use the selected option values below as authoritative",
        ),
      }),
    );
    expect(sendToAgentChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.stringContaining("file id file-command"),
      }),
    );
  });

  it("forwards the payload's submitContext to the continuation turn", async () => {
    vi.stubGlobal(
      "fetch",
      appStateFetchMock(
        new Map([
          [
            "guided-questions",
            JSON.stringify({
              submitMessage: "Use this design direction.",
              skipMessage: "Show another set.",
              submitContext:
                'Linked to design system "ds_flo". Call `get-design-system` before expanding.',
              questions: [
                {
                  id: "variant",
                  type: "text-options",
                  question: "Which screen should I keep?",
                  options: [{ label: "Command Deck", value: "keep-a" }],
                },
              ],
            }),
          ],
        ]),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
    });

    await act(async () => {
      result.current().handleSubmit({ variant: "keep-a" });
      await Promise.resolve();
    });

    expect(sendToAgentChatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.stringContaining("ds_flo"),
      }),
    );
  });

  it("lets an AgentKit host own answer delivery without using the legacy bridge", async () => {
    const onSubmitMessage = vi.fn();
    vi.stubGlobal(
      "fetch",
      appStateFetchMock(
        new Map([
          [
            "guided-questions",
            JSON.stringify({
              questions: [
                {
                  id: "format",
                  type: "text-options",
                  question: "Which format should I use?",
                  options: [{ label: "Summary", value: "summary" }],
                },
              ],
            }),
          ],
        ]),
      ),
    );
    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
      onSubmitMessage,
    });

    await act(async () => {
      result.current().handleSubmit({ format: "A concise memo" });
      await Promise.resolve();
    });

    expect(onSubmitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { format: "A concise memo" },
        formattedAnswers: "Q: Which format should I use?\nA: A concise memo",
        context: expect.stringContaining(
          "Treat every question below as settled",
        ),
      }),
    );
    expect(sendToAgentChatMock).not.toHaveBeenCalled();
  });

  it("keeps guided questions available when correlated delivery is rejected", async () => {
    let resolveDelivery!: (result: { delivered: boolean }) => void;
    const onSubmitMessage = vi.fn(
      () =>
        new Promise<{ delivered: boolean }>((resolve) => {
          resolveDelivery = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      appStateFetchMock(
        new Map([
          [
            "guided-questions",
            JSON.stringify({
              questions: [
                {
                  id: "format",
                  type: "text-options",
                  question: "Which format should I use?",
                  options: [{ label: "Summary", value: "summary" }],
                },
              ],
            }),
          ],
        ]),
      ),
    );

    const result = await renderFlow({
      stateKey: "guided-questions",
      queryKey: ["guided-questions"],
      refetchInterval: false,
      onSubmitMessage,
    });

    await act(async () => {
      result.current().handleSubmit({ format: "A concise memo" });
      await Promise.resolve();
    });
    expect(result.current().questions).toHaveLength(1);
    expect(result.current().isSubmitting).toBe(true);

    await act(async () => {
      resolveDelivery({ delivered: false });
      await Promise.resolve();
    });
    expect(result.current().questions).toHaveLength(1);
    expect(result.current().isSubmitting).toBe(false);
  });
});
