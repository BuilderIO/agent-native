// @vitest-environment jsdom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";

import { HomeGetStartedGrid } from "./get-started";

/**
 * Row 146: Home renders a Get started section only when something is bound to it,
 * and nothing was — the heading existed with no grid. The two entries come from
 * the reference's own home copy and both reach surfaces this app already has.
 */
describe("get started grid", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("links Connect your data to the warehouse browser", () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid canAddConnection onCreateProject={vi.fn()} />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    const links = Array.from(
      host.querySelectorAll("a[href='/home/data?connect=1']"),
    );
    expect(links.length).toBeGreaterThan(0);
    expect(
      links.some((link) => link.textContent?.includes("Connect your data")),
    ).toBe(true);
  });

  it("keeps the Connect your data entry after the checklist is dismissed", () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid
              canAddConnection
              onCreateProject={vi.fn()}
              checklistDismissed
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    expect(host.querySelector("ol.ws-home-checklist-steps")).toBeNull();
    expect(
      host.querySelector("a[href='/home/data?connect=1']")?.textContent,
    ).toContain("Connect your data");
  });

  it("hides project creation and the connection picker when access is absent", () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid canAddConnection={false} />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    expect(host.textContent).not.toContain("Connect your data");
    expect(host.textContent).not.toContain("Start a new project");
  });

  it("runs the create-project action from Start a new project", () => {
    const onCreateProject = vi.fn();
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid
              canAddConnection
              onCreateProject={onCreateProject}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    const button = [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Start a new project"),
    );
    act(() => button?.click());
    expect(onCreateProject).toHaveBeenCalled();
  });
  it("renders the three-step checklist with progress and a dismiss control", () => {
    const onDismiss = vi.fn();
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid
              canAddConnection
              onCreateProject={vi.fn()}
              completedSteps={["connect"]}
              onDismiss={onDismiss}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    const items = host.querySelectorAll("li.ws-home-checklist-step");
    expect(items).toHaveLength(3);
    expect(host.querySelectorAll("li.is-complete")).toHaveLength(1);
    const progress = host.querySelector("[role='progressbar']");
    expect(progress?.getAttribute("aria-valuenow")).toBe("33");
    expect(host.textContent).toContain("1 of 3 complete");
    host
      .querySelector<HTMLButtonElement>("button[aria-label='Dismiss']")
      ?.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("wires each checklist step to its setup action", () => {
    const onCreateProject = vi.fn();
    const onAskAgent = vi.fn();
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid
              canAddConnection
              onCreateProject={onCreateProject}
              onAskAgent={onAskAgent}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    const connectStep = host.querySelector<HTMLAnchorElement>(
      ".ws-home-checklist-steps a[href='/home/data?connect=1']",
    );
    expect(connectStep?.textContent).toContain("Add a data source");
    const stepButtons = [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".ws-home-checklist-steps button",
      ),
    ];
    const projectStep = stepButtons.find((button) =>
      button.textContent?.includes("Create your first project"),
    );
    const askStep = stepButtons.find((button) =>
      button.textContent?.includes("Ask the agent a question"),
    );
    expect(projectStep).toBeDefined();
    expect(askStep).toBeDefined();
    act(() => {
      projectStep?.click();
      askStep?.click();
    });
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onAskAgent).toHaveBeenCalledTimes(1);
  });

  it("renders the first-step cards with their descriptions and runs each action", () => {
    const onCreateProject = vi.fn();
    const onCreateThread = vi.fn();
    const onImportProject = vi.fn();
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid
              canAddConnection
              onCreateProject={onCreateProject}
              onCreateThread={onCreateThread}
              onImportProject={onImportProject}
            />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    const cards = [
      ...host.querySelectorAll<HTMLElement>(".ws-home-card-grid .ws-home-card"),
    ];
    const byTitle = (title: string) =>
      cards.find((card) =>
        card.querySelector(".ws-home-card-title")?.textContent?.includes(title),
      );
    const thread = byTitle("Start a new thread");
    const project = byTitle("Start a new project");
    const importCard = byTitle("Import");
    expect(thread?.textContent).toContain("Get answers in seconds");
    expect(project?.textContent).toContain("Build an analysis from scratch");
    expect(importCard?.textContent).toContain("Start from an existing .ipynb");
    act(() => {
      thread?.querySelector<HTMLButtonElement>("button")?.click();
      project?.querySelector<HTMLButtonElement>("button")?.click();
      importCard?.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(onCreateThread).toHaveBeenCalledTimes(1);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onImportProject).toHaveBeenCalledTimes(1);
  });

  it("omits first-step cards whose action is not available", () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <MemoryRouter>
            <HomeGetStartedGrid canAddConnection onCreateProject={vi.fn()} />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
    expect(host.textContent).not.toContain("Start a new thread");
    expect(host.textContent).not.toContain("Start from an existing .ipynb");
    expect(host.textContent).toContain("Start a new project");
  });
});
