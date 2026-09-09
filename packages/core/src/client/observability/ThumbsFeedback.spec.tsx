// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentNativeI18nProvider } from "../i18n.js";
import { ThumbsFeedback } from "./ThumbsFeedback.js";

vi.mock("../use-session.js", () => ({
  useSession: () => ({
    session: { email: "user@example.com" },
    isLoading: false,
    status: "authenticated",
    error: null,
    retry: vi.fn(),
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ThumbsFeedback localization", () => {
  it("renders localized accessible labels and explanation copy", async () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="de-DE"
          initialPreference="de-DE"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector('[aria-label="Daumen hoch"]'),
        container.innerHTML,
      ).not.toBeNull();
    });
    const down = container.querySelector(
      '[aria-label="Daumen runter"]',
    ) as HTMLButtonElement;

    act(() => down.click());

    expect(document.body.textContent).toContain("Was ist schiefgelaufen?");
    expect(document.body.textContent).not.toContain("Ungenau");
    expect(document.body.textContent).not.toContain("Falsches Tool");
  });

  it("focuses the explanation and submits free text with Cmd+Enter", async () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    const down = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Thumbs down"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });

    act(() => down.click());

    const textarea = await vi.waitFor(() => {
      const input = document.body.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);
      return input!;
    });

    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "The answer used the wrong source.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          metaKey: true,
        }),
      );
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      messageSeq: 1,
      feedbackType: "text",
      value: "The answer used the wrong source.",
    });
    expect(
      (fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ],
    ).toEqual(expect.any(String));
  });

  it("also sends chat text feedback to the shared form with request context", async () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_FEEDBACK_URL",
      "https://forms.agent-native.com/f/agent-native-feedback/_16ewV",
    );
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/forms/public/")) {
        return {
          ok: true,
          json: async () => ({
            id: "form-1",
            fields: [{ id: "feedback", type: "textarea" }],
          }),
        } as Response;
      }
      return { ok: true } as Response;
    });

    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    const down = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Thumbs down"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });
    act(() => down.click());

    const textarea = await vi.waitFor(() => {
      const input = document.body.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input!;
    });
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "The answer used the wrong source.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => textarea.form?.requestSubmit());

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("/api/submit/"),
        ),
      ).toBe(true);
    });

    const observabilityCall = fetchMock.mock.calls.find(([input, init]) => {
      if (!String(input).includes("/_agent-native/observability/feedback")) {
        return false;
      }
      return JSON.parse(String(init?.body)).feedbackType === "text";
    });
    expect(observabilityCall).toBeDefined();
    expect(JSON.parse(String(observabilityCall?.[1]?.body))).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      messageSeq: 1,
      feedbackType: "text",
      value: "The answer used the wrong source.",
    });

    const formCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/submit/"),
    );
    expect(formCall).toBeDefined();
    expect(JSON.parse(String(formCall?.[1]?.body))).toMatchObject({
      data: { feedback: "The answer used the wrong source." },
      _t: expect.any(Number),
      _meta: {
        submitterEmail: "user@example.com",
        chatSessionIds: ["thread-1"],
        activeRunId: "run-1",
        clientSurface: "web",
      },
    });
    expect(JSON.parse(String(formCall?.[1]?.body))._t).toBeGreaterThan(0);
    expect(
      (formCall?.[1]?.headers as Record<string, string> | undefined)?.[
        "Idempotency-Key"
      ],
    ).toEqual(expect.any(String));
  });

  it("retries failed observability without duplicating shared feedback", async () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_FEEDBACK_URL",
      "https://forms.agent-native.com/f/agent-native-feedback/_16ewV",
    );
    const fetchMock = vi.mocked(globalThis.fetch);
    let observabilityAttempts = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/forms/public/")) {
        return {
          ok: true,
          json: async () => ({
            id: "form-1",
            fields: [{ id: "feedback", type: "textarea" }],
          }),
        } as Response;
      }
      if (url.includes("/_agent-native/observability/feedback")) {
        const body = JSON.parse(String(init?.body));
        if (body.feedbackType === "text") observabilityAttempts += 1;
        return {
          ok: body.feedbackType !== "text" || observabilityAttempts > 1,
          status:
            body.feedbackType !== "text" || observabilityAttempts > 1
              ? 200
              : 503,
        } as Response;
      }
      return { ok: true } as Response;
    });

    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    const down = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Thumbs down"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });
    act(() => down.click());

    const textarea = await vi.waitFor(() => {
      const input = document.body.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input!;
    });
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "The answer was not useful.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.form?.requestSubmit();
      textarea.form?.requestSubmit();
    });
    expect(textarea.disabled).toBe(true);

    const formSubmitCalls = await vi.waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/submit/"),
      );
      expect(calls).toHaveLength(1);
      return calls;
    });
    const observabilityTextCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/_agent-native/observability/feedback") &&
        JSON.parse(String(init?.body)).feedbackType === "text",
    );
    expect(observabilityTextCalls).toHaveLength(1);
    expect(
      (observabilityTextCalls[0]?.[1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ],
    ).toEqual(expect.any(String));
    expect(JSON.parse(String(formSubmitCalls[0]?.[1]?.body))).toMatchObject({
      _meta: { submitterEmail: "user@example.com" },
    });
    expect(document.body.querySelector("textarea")).not.toBeNull();

    act(() => textarea.form?.requestSubmit());
    await vi.waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/api/submit/"),
      );
      expect(calls).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input).includes("/_agent-native/observability/feedback") &&
            JSON.parse(String(init?.body)).feedbackType === "text",
        ),
      ).toHaveLength(2);
    });
    const observabilityCallsAfterRetry = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).includes("/_agent-native/observability/feedback") &&
        JSON.parse(String(init?.body)).feedbackType === "text",
    );
    expect(
      (observabilityCallsAfterRetry[1]?.[1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ],
    ).toBe(
      (observabilityCallsAfterRetry[0]?.[1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ],
    );
    await vi.waitFor(() => {
      expect(document.body.querySelector("textarea")).toBeNull();
    });
  });

  it("retries failed shared feedback without duplicating observability", async () => {
    vi.stubEnv(
      "VITE_AGENT_NATIVE_FEEDBACK_URL",
      "https://forms.agent-native.com/f/agent-native-feedback/_16ewV",
    );
    const fetchMock = vi.mocked(globalThis.fetch);
    let formAttempts = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/forms/public/")) {
        return {
          ok: true,
          json: async () => ({
            id: "form-1",
            fields: [{ id: "feedback", type: "textarea" }],
          }),
        } as Response;
      }
      if (url.includes("/api/submit/")) {
        formAttempts += 1;
        if (formAttempts === 1) {
          return {
            ok: false,
            status: 502,
            text: async () => "Bad Gateway",
          } as Response;
        }
      }
      return { ok: true } as Response;
    });

    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    const down = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Thumbs down"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });
    act(() => down.click());

    const textarea = await vi.waitFor(() => {
      const input = document.body.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input!;
    });
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "The answer was not useful.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.form?.requestSubmit();
    });

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes("/api/submit/"),
        ),
      ).toHaveLength(1);
    });
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).includes("/_agent-native/observability/feedback") &&
          JSON.parse(String(init?.body)).feedbackType === "text",
      ),
    ).toHaveLength(1);
    expect(document.body.querySelector("textarea")).not.toBeNull();

    act(() => textarea.form?.requestSubmit());
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes("/api/submit/"),
        ),
      ).toHaveLength(2);
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            String(input).includes("/_agent-native/observability/feedback") &&
            JSON.parse(String(init?.body)).feedbackType === "text",
        ),
      ).toHaveLength(1);
    });
    const formCallsAfterRetry = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/api/submit/"),
    );
    expect(
      (
        formCallsAfterRetry[1]?.[1]?.headers as
          | Record<string, string>
          | undefined
      )?.["Idempotency-Key"],
    ).toBe(
      (
        formCallsAfterRetry[0]?.[1]?.headers as
          | Record<string, string>
          | undefined
      )?.["Idempotency-Key"],
    );
    await vi.waitFor(() => {
      expect(document.body.querySelector("textarea")).toBeNull();
    });
  });

  it("records the negative sentiment before a dismissed popover", async () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    const down = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Thumbs down"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });

    act(() => down.click());

    const fetchMock = vi.mocked(globalThis.fetch);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      messageSeq: 1,
      feedbackType: "thumbs_down",
      value: "",
    });

    act(() => down.click());
    await vi.waitFor(() => {
      expect(document.body.querySelector("textarea")).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats non-ok responses as failed and allows a thumbs-up retry", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    const up = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Thumbs up"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });

    act(() => up.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(up.className).toContain("text-muted-foreground"),
    );

    act(() => up.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({ feedbackType: "thumbs_up" });
    await vi.waitFor(() => expect(up.className).toContain("text-foreground"));
  });

  it("keeps text feedback available when a non-ok response fails", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });

    act(() => {
      root.render(
        <AgentNativeI18nProvider
          initialLocale="en-US"
          initialPreference="en-US"
          persistPreference={false}
        >
          <ThumbsFeedback threadId="thread-1" runId="run-1" messageSeq={1} />
        </AgentNativeI18nProvider>,
      );
    });

    const down = await vi.waitFor(() => {
      const button = container.querySelector(
        '[aria-label="Thumbs down"]',
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      return button!;
    });
    act(() => down.click());

    const textarea = await vi.waitFor(() => {
      const input = document.body.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      expect(input).not.toBeNull();
      return input!;
    });
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "The answer was not useful.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => textarea.form?.requestSubmit());

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(document.body.querySelector("textarea")).not.toBeNull();
    expect(document.body.textContent).toContain("The answer was not useful.");
  });
});
