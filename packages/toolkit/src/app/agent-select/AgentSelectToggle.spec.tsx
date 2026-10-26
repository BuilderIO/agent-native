// @vitest-environment happy-dom

import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetAgentSelectForTests,
  getAgentSelectSnapshot,
  registerAgentSelectable,
} from "./agent-select.js";
import { AgentSelectToggle } from "./AgentSelectToggle.js";

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
  _resetAgentSelectForTests();
});

function render() {
  act(() =>
    root.render(
      <TooltipProvider>
        <AgentSelectToggle />
      </TooltipProvider>,
    ),
  );
}

function button() {
  return container.querySelector<HTMLButtonElement>(
    '[data-agent-composer-slot="select-button"]',
  );
}

describe("AgentSelectToggle", () => {
  it("stays hidden until the app registers something selectable", () => {
    render();
    expect(button()).toBeNull();

    let unregister = () => {};
    act(() => {
      unregister = registerAgentSelectable({
        kind: "slide",
        id: "s1",
        title: "Intro",
        getContext: () => "Slide s1",
        getElement: () => null,
      });
    });
    expect(button()?.getAttribute("aria-label")).toBe("Select");

    act(() => unregister());
    expect(button()).toBeNull();
  });

  it("toggles pick mode and reports it as pressed", () => {
    act(() => {
      registerAgentSelectable({
        kind: "slide",
        id: "s1",
        title: "Intro",
        getContext: () => "Slide s1",
        getElement: () => null,
      });
    });
    render();
    expect(button()?.getAttribute("aria-pressed")).toBe("false");

    act(() => button()!.click());
    expect(getAgentSelectSnapshot().active).toBe(true);
    expect(button()?.getAttribute("aria-pressed")).toBe("true");

    act(() => button()!.click());
    expect(getAgentSelectSnapshot().active).toBe(false);
    expect(button()?.getAttribute("aria-pressed")).toBe("false");
  });

  it("ends pick mode when the last toggle unmounts", () => {
    act(() => {
      registerAgentSelectable({
        kind: "slide",
        id: "s1",
        title: "Intro",
        getContext: () => "Slide s1",
        getElement: () => null,
      });
    });
    render();
    act(() => button()!.click());
    expect(getAgentSelectSnapshot().active).toBe(true);

    act(() => root.render(<TooltipProvider />));
    expect(getAgentSelectSnapshot().active).toBe(false);
  });
});
