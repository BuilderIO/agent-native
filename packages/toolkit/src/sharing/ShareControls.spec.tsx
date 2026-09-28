// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { JoinedShareControl, ShareModeTabs } from "./ShareControls.js";

describe("JoinedShareControl", () => {
  const roots: ReturnType<typeof createRoot>[] = [];
  const containers: HTMLDivElement[] = [];

  afterEach(() => {
    for (const root of roots) root.unmount();
    for (const container of containers) container.remove();
    roots.length = 0;
    containers.length = 0;
  });

  it("keeps a blocked copy available for an explanation without showing success", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const onCopy = vi.fn(async () => false);

    await act(async () => {
      root.render(
        <TooltipProvider>
          <JoinedShareControl
            trigger={<button type="button">Share</button>}
            copyLabel="Copy link"
            copiedLabel="Copied"
            blocked
            onCopy={onCopy}
          />
        </TooltipProvider>,
      );
    });

    const copy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy link"]',
    );
    expect(copy?.hasAttribute("data-blocked")).toBe(true);
    expect(copy?.disabled).toBe(false);
    await act(async () => copy!.click());
    expect(onCopy).toHaveBeenCalledOnce();
    expect(copy?.getAttribute("aria-label")).toBe("Copy link");
  });

  it("keeps disabled extra share tabs unavailable", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ShareModeTabs
          value="people"
          onValueChange={() => {}}
          peopleLabel="People"
          agentsLabel="Agents"
          people={<div>Access</div>}
          agents={<div>Prompt</div>}
          extraTabs={[
            {
              value: "coming-soon",
              label: "Coming soon",
              content: <div>Later</div>,
              disabled: true,
            },
          ]}
        />,
      );
    });

    expect(
      container.querySelector<HTMLButtonElement>(
        '[role="tab"][data-state="inactive"]:last-child',
      )?.disabled,
    ).toBe(true);
  });
});
