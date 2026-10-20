// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import {
  JoinedShareControl,
  ShareModeTabs,
  ShareTabs,
} from "./ShareControls.js";

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

    expect(
      container.querySelector('[data-slot="button-group"]')?.className,
    ).toContain(
      "[&>*:not([data-slot=button-group-separator]):not([data-button-group-ignore]):not(select[aria-hidden=true])]:!h-9",
    );
    const copy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy link"]',
    );
    expect(copy?.hasAttribute("data-blocked")).toBe(true);
    expect(copy?.disabled).toBe(false);
    await act(async () => copy!.click());
    expect(onCopy).toHaveBeenCalledOnce();
    expect(copy?.getAttribute("aria-label")).toBe("Copy link");
  });

  it("renders both compact share segments at the widget height", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <TooltipProvider>
          <JoinedShareControl
            trigger={<button type="button">Share</button>}
            copyLabel="Copy link"
            copiedLabel="Copied"
            onCopy={() => {}}
            size="sm"
          />
        </TooltipProvider>,
      );
    });

    const group = container.querySelector<HTMLElement>(
      '[data-slot="button-group"]',
    );
    const segments = group?.querySelectorAll<HTMLElement>("button");
    expect(segments).toHaveLength(2);
    expect(group?.className).toContain(
      "[&>*:not([data-slot=button-group-separator]):not([data-button-group-ignore]):not(select[aria-hidden=true])]:!h-8",
    );
  });

  it("renders underline tabs and shows only the selected tab's panel", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        <ShareTabs
          value="link"
          onValueChange={onValueChange}
          listLabel="Share options"
          tabs={[
            { value: "link", label: "Link", content: <div>Link body</div> },
            { value: "embed", label: "Embed", content: <div>Embed body</div> },
          ]}
        />,
      );
    });

    const list = container.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe("Share options");
    expect(list?.className).toContain("bg-transparent");
    expect(list?.className).not.toContain("bg-muted");
    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    for (const tab of tabs) {
      expect(tab.className).toContain("after:bg-foreground");
      expect(tab.className).toContain("data-[state=active]:bg-transparent");
    }
    expect(container.textContent).toContain("Link body");
    expect(container.textContent).not.toContain("Embed body");

    await act(async () => {
      tabs[1].dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    expect(onValueChange).toHaveBeenCalledWith("embed");
  });

  it("builds People and Agents on the same underline tabs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ShareModeTabs
          value="agents"
          onValueChange={() => {}}
          peopleLabel="People"
          agentsLabel="Agents"
          people={<div>Access</div>}
          agents={<div>Prompt</div>}
          extraTabs={[
            { value: "context", label: "Context", content: <div>Ctx</div> },
          ]}
        />,
      );
    });

    const tabs = Array.from(
      container.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "People",
      "Agents",
      "Context",
    ]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    for (const tab of tabs) expect(tab.className).toContain("after:h-0.5");
    expect(container.textContent).toContain("Prompt");
    expect(container.textContent).not.toContain("Access");
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
