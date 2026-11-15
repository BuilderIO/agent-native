// @vitest-environment happy-dom

import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from "./trace.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(node: ReactNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

function step(keepMounted?: boolean) {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status="running">
          <TraceTitle>Reading file</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted={keepMounted}>
        File contents
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

describe("Trace", () => {
  it("mounts closed content only while open by default", () => {
    const view = render(step());
    const trigger = view.querySelector("button")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    expect(view.textContent).not.toContain("File contents");

    act(() => trigger.click());
    const content = view.querySelector<HTMLElement>(
      '[data-slot="trace-collapsible-content"]',
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);
    expect(content.textContent).toBe("File contents");

    act(() => trigger.click());
    expect(view.textContent).not.toContain("File contents");
  });

  it("keeps closed content findable and opens on a find-in-page match", () => {
    const view = render(step(true));
    const trigger = view.querySelector("button")!;
    const content = view.querySelector<HTMLElement>(
      '[data-slot="trace-collapsible-content"]',
    )!;
    expect(content.getAttribute("hidden")).toBe("until-found");
    expect(content.textContent).toBe("File contents");
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);

    act(() => content.dispatchEvent(new Event("beforematch")));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(content.hidden).toBe(false);
  });

  it("follows a controlled open state", () => {
    let setOpen: (open: boolean) => void = () => undefined;
    const changes: boolean[] = [];
    function Controlled() {
      const [open, update] = useState(false);
      setOpen = update;
      return (
        <TraceCollapsible
          open={open}
          onOpenChange={(next) => {
            changes.push(next);
            update(next);
          }}
        >
          <TraceCollapsibleTrigger>Step</TraceCollapsibleTrigger>
          <TraceCollapsibleContent>Detail</TraceCollapsibleContent>
        </TraceCollapsible>
      );
    }
    const view = render(<Controlled />);
    act(() => setOpen(true));
    expect(view.textContent).toContain("Detail");
    act(() => view.querySelector("button")!.click());
    expect(changes).toEqual([false]);
    expect(view.textContent).not.toContain("Detail");
  });

  it("keeps the trace status apart from a row's protocol status", () => {
    const view = render(step());
    const line = view.querySelector('[data-slot="trace-line"]')!;
    expect(line.getAttribute("data-trace-status")).toBe("running");
    expect(line.hasAttribute("data-status")).toBe(false);
  });
});
