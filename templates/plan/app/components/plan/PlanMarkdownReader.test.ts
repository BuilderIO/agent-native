// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PlanMarkdownReader,
  buildPlanMarkdownSectionCopyUrl,
} from "./PlanMarkdownReader";
import { detectPlanTextDirection } from "./planTextDirection";

function RerenderHarness() {
  const [version, setVersion] = useState(0);

  return createElement(
    "div",
    null,
    createElement(
      "button",
      { type: "button", onClick: () => setVersion((current) => current + 1) },
      version,
    ),
    createElement(PlanMarkdownReader, {
      blockId: "intro",
      markdown: "## Heading\n\n```ts\nconst value = 1;\n```",
    }),
  );
}

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

  it("keeps markdown and code surfaces mounted across unrelated parent renders", () => {
    act(() => {
      root.render(createElement(RerenderHarness));
    });

    const heading = container.querySelector("h2");
    const codeSurface = container.querySelector(".plan-code-surface");
    const button = container.querySelector<HTMLButtonElement>("button");

    expect(heading).not.toBeNull();
    expect(codeSurface).not.toBeNull();
    expect(button).not.toBeNull();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("h2")).toBe(heading);
    expect(container.querySelector(".plan-code-surface")).toBe(codeSurface);
  });
});

describe("buildPlanMarkdownSectionCopyUrl", () => {
  it("removes local bridge tokens from copied section links", () => {
    expect(
      buildPlanMarkdownSectionCopyUrl(
        "https://plan.agent-native.com/local-plans/checkout?view=review#bridge=http%3A%2F%2F127.0.0.1%3A58201%2Flocal-plan.json%3Ftoken%3Dsecret",
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
