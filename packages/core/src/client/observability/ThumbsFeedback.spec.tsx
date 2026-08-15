// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentNativeI18nProvider } from "../i18n.js";
import { ThumbsFeedback } from "./ThumbsFeedback.js";

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
