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
  it("renders localized accessible labels and category copy", async () => {
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

    expect(document.body.textContent).toContain("Ungenau");
    expect(document.body.textContent).toContain("Falsches Tool");
  });
});
