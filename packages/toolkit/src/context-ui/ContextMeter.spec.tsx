// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContextMeterView } from "./ContextMeter.js";
import { fallbackContextTranslate } from "./types.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const manifest = {
  totalTokens: 300,
  rawTokens: 300,
  reclaimedTokens: 0,
  tokenCountMethod: "exact" as const,
  enforceable: true,
  segments: [],
  systemTokens: 100,
  conversationTokens: 200,
};

describe("ContextMeterView localization", () => {
  it("interpolates the providerless English fallback", () => {
    expect(
      fallbackContextTranslate("agentChat.contextMeter.summary", {
        defaultValue: "Context {{percent}}% · {{totalTokens}}",
        percent: 25,
        totalTokens: "2.0k",
      }),
    ).toBe("Context 25% · 2.0k");
  });

  it("uses the supplied translator for its accessible label", () => {
    const translate = (key: string, options: Record<string, unknown> = {}) => {
      if (key === "agentChat.contextMeter.breakdown") return " AUFTEILUNG";
      if (key === "agentChat.contextMeter.ariaLabel") {
        return `Kontext ${options.percent}% ${options.totalTokens}${options.breakdown}`;
      }
      return String(options.defaultValue ?? key);
    };

    act(() => {
      root.render(
        <ContextMeterView
          manifest={manifest}
          contextWindow={1_200}
          open={false}
          onOpenChange={() => undefined}
          translate={translate}
        >
          <div>Panel</div>
        </ContextMeterView>,
      );
    });

    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Kontext 25% 300 AUFTEILUNG",
    );
  });
});
