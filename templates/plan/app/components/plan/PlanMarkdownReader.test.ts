// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PlanMarkdownReader,
  buildPlanMarkdownSectionCopyUrl,
} from "./PlanMarkdownReader";
import { detectPlanTextDirection } from "./planTextDirection";

describe("PlanMarkdownReader RTL rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("detects Persian prose as RTL while ignoring inline code", () => {
    expect(
      detectPlanTextDirection(
        "این مرحله با `Option::get($id)` اجرا می‌شود و خروجی را برمی‌گرداند.",
      ),
    ).toBe("rtl");
  });

  it("sets RTL on Persian prose and keeps inline code LTR", () => {
    act(() => {
      root.render(
        createElement(PlanMarkdownReader, {
          markdown: "این مرحله با `Option::get($id)` اجرا می‌شود.",
        }),
      );
    });

    const prose = container.querySelector<HTMLElement>(".an-rich-md-prose");
    const inlineCode = container.querySelector<HTMLElement>("code");

    expect(prose?.getAttribute("dir")).toBe("rtl");
    expect(inlineCode?.getAttribute("dir")).toBe("ltr");
    expect(inlineCode?.textContent).toBe("Option::get($id)");
  });
});

describe("buildPlanMarkdownSectionCopyUrl", () => {
  it("removes local bridge tokens from copied section links", () => {
    expect(
      buildPlanMarkdownSectionCopyUrl(
        "https://plan.agent-native.com/local-plans/checkout?bridge=http%3A%2F%2F127.0.0.1%3A58201%2Flocal-plan.json%3Ftoken%3Dsecret&view=review#old",
        "plan-heading-intro-0",
      ),
    ).toBe(
      "https://plan.agent-native.com/local-plans/checkout?view=review#plan-heading-intro-0",
    );
  });

  it("preserves normal copied section links", () => {
    expect(
      buildPlanMarkdownSectionCopyUrl(
        "https://plan.agent-native.com/plans/plan_123?comment=open",
        "plan-heading-details-2",
      ),
    ).toBe(
      "https://plan.agent-native.com/plans/plan_123?comment=open#plan-heading-details-2",
    );
  });
});
