// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComposerContextBanner } from "./ComposerContextBanner.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("ComposerContextBanner", () => {
  it("renders localized context actions and calls add and dismiss handlers", async () => {
    const onAddContext = vi.fn();
    const onDismiss = vi.fn();

    await act(async () =>
      root.render(
        <ComposerContextBanner
          ariaLabel="Context guidance"
          addContextLabel="Add context"
          dismissLabel="Dismiss context guidance"
          onAddContext={onAddContext}
          onDismiss={onDismiss}
        >
          Improve answers by adding data definitions.
        </ComposerContextBanner>,
      ),
    );

    const banner = container.querySelector<HTMLElement>(
      '[data-agent-composer-slot="context-banner"]',
    )!;
    expect(banner.getAttribute("aria-label")).toBe("Context guidance");
    expect(banner.classList).toContain("gap-1.5");
    expect(banner.classList).toContain("px-2.5");
    expect(banner.classList).toContain("py-2");
    expect(banner.classList).toContain("rounded-lg");
    expect(banner.textContent).toContain(
      "Improve answers by adding data definitions.",
    );

    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Add context"))!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss context guidance"]',
        )!
        .click(),
    );

    expect(onAddContext).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("renders a host-provided decorative add-context icon", async () => {
    await act(async () =>
      root.render(
        <ComposerContextBanner
          ariaLabel="Context guidance"
          addContextLabel="Add context"
          addContextIcon={<svg data-testid="custom-action-icon" />}
          onAddContext={vi.fn()}
        >
          Improve answers by adding data definitions.
        </ComposerContextBanner>,
      ),
    );

    const button = container.querySelector<HTMLButtonElement>("button")!;
    const actionIcon = container.querySelector<SVGSVGElement>(
      '[data-testid="custom-action-icon"]',
    )!;

    expect(button.textContent).toBe("Add context");
    expect(button.classList).toContain("has-[>span>svg]:px-1.5");
    expect(Array.from(button.querySelectorAll("svg"))).toEqual([actionIcon]);
    expect(actionIcon.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });
});
