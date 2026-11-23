// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gates = vi.hoisted(() => ({ labs: false, contextStudio: true }));
vi.mock("./secondary-features", () => ({
  secondaryFeaturesEnabled: () => gates.labs,
}));
vi.mock("./contextStudioEntry", () => ({
  contextStudioEntryAvailable: () => gates.contextStudio,
}));

import { MoreMenu } from "./MoreMenu";
import type { WorkspaceShellFeatures } from "./types";

const features = (
  overrides: Partial<WorkspaceShellFeatures>,
): WorkspaceShellFeatures => ({
  contextStudio: false,
  isManagerOrAbove: false,
  threads: true,
  tasks: false,
  library: false,
  folders: false,
  developerTools: false,
  canCreateProject: true,
  canCreateThread: true,
  ...overrides,
});

describe("sidebar More menu", () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = (overrides: Partial<WorkspaceShellFeatures>) =>
    act(() => {
      root.render(
        <MemoryRouter>
          <MoreMenu features={features(overrides)} />
        </MemoryRouter>,
      );
    });
  const trigger = () =>
    [...host.querySelectorAll("button")].find((b) =>
      b.textContent.includes("More"),
    );
  const openMenuLabels = () => {
    act(() => trigger()?.click());
    return [...document.querySelectorAll("[role=menu] a, [role=menu] button")]
      .map((el) => el.textContent.trim())
      .filter(Boolean);
  };

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    gates.labs = false;
    gates.contextStudio = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  it("renders no trigger when nothing is enabled", () => {
    render({});
    expect(trigger()).toBeUndefined();
  });

  it("renders no trigger when Context Studio is on but its page is unavailable", () => {
    gates.contextStudio = false;
    render({ contextStudio: true });
    expect(trigger()).toBeUndefined();
  });

  it("lists only the entries the workspace enables", () => {
    render({ library: true });
    expect(openMenuLabels()).toEqual(["Library"]);
  });

  it("adds the Labs entries when Labs is on", () => {
    gates.labs = true;
    render({ library: true });
    expect(openMenuLabels()).toEqual(["Components", "Library"]);
  });
});
