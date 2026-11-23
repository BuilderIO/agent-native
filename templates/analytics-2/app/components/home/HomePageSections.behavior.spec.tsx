// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HomePage } from "./HomePage";

/**
 * sprint-analytics-2#146: Home on the served build showed three of the reference's four
 * lower headings (GET STARTED, JUMP BACK IN, YOUR FAVORITES) because CONTEXT MANAGEMENT
 * only renders when a suggestions object is passed, and the workspace page passed none.
 * The reference keeps that section with its own empty state ("No suggestions yet"),
 * so the check requires the heading to be there with no suggestions at all.
 */
describe("home lower sections", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const render = (props: { suggestions?: unknown }) =>
    act(() => {
      root.render(
        <MemoryRouter>
          <HomePage
            user={{
              id: "user-1",
              name: "Sam Reader",
              email: "reader@example.test",
            }}
            workspace={{ id: "workspace-1", name: "Workspace" }}
            popular={null}
            contextProgress={{
              enabled: false,
              progressPercent: 100,
              completedSteps: [],
              canDismiss: false,
            }}
            recents={{
              projects: {
                kind: "project",
                enabled: true,
                status: "ready",
                rows: [],
              },
              threads: {
                kind: "thread",
                enabled: true,
                status: "ready",
                rows: [],
              },
              explorations: {
                kind: "exploration",
                enabled: false,
                status: "ready",
                rows: [],
              },
              data: {
                kind: "data",
                enabled: false,
                status: "ready",
                rows: [],
              },
            }}
            favorites={{
              collectionsEnabled: true,
              status: "ready",
              projects: [],
              collections: [],
            }}
            agentComposer={<div data-testid="composer" />}
            callbacks={{
              onOpenContextStudio: () => undefined,
              onBrowseProjects: () => undefined,
            }}
            {...(props as object)}
          />
        </MemoryRouter>,
      );
    });

  it("keeps CONTEXT MANAGEMENT with its empty state when there are no suggestions", () => {
    render({ suggestions: { status: "ready", issues: [] } });
    const headings = [...host.querySelectorAll("h2")].map((h) =>
      (h.textContent ?? "").trim().toUpperCase(),
    );
    expect(headings).toContain("CONTEXT MANAGEMENT");
    expect(host.textContent).toContain("No suggestions yet");
  });

  it("drops the section when the page passes nothing, which is the served bug", () => {
    render({});
    const headings = [...host.querySelectorAll("h2")].map((h) =>
      (h.textContent ?? "").trim().toUpperCase(),
    );
    expect(headings).not.toContain("CONTEXT MANAGEMENT");
  });
});
