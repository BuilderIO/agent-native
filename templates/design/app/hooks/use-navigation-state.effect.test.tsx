// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const coreClientMocks = vi.hoisted(() => ({
  getBrowserTabId: vi.fn(() => "tab-123"),
  setClientAppState: vi.fn(() => Promise.resolve(null)),
  useAgentRouteState: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: coreClientMocks.getBrowserTabId,
  setClientAppState: coreClientMocks.setClientAppState,
}));

vi.mock("@agent-native/core/client/route-state", () => ({
  useAgentRouteState: coreClientMocks.useAgentRouteState,
}));

import { useNavigationState } from "./use-navigation-state";

function Probe({ enabled = true }: { enabled?: boolean }) {
  useNavigationState(enabled);
  return null;
}

async function renderProbe(pathname: string, enabled = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route
            path="/visual-edit/:id"
            element={<Probe enabled={enabled} />}
          />
          <Route path="*" element={<Probe enabled={enabled} />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  root.unmount();
  container.remove();
}

describe("useNavigationState selection cleanup", () => {
  beforeEach(() => {
    coreClientMocks.getBrowserTabId.mockReturnValue("tab-123");
    coreClientMocks.setClientAppState.mockClear();
    coreClientMocks.useAgentRouteState.mockClear();
  });

  it("clears stale editor selection outside design editor routes", async () => {
    await renderProbe("/");

    expect(coreClientMocks.setClientAppState.mock.calls).toEqual([
      ["design-selection:tab-123", null],
    ]);
  });

  it("keeps editor selection while the design editor route is active", async () => {
    await renderProbe("/design/design-123");

    expect(coreClientMocks.setClientAppState).not.toHaveBeenCalled();
  });

  it("keeps editor selection and navigation state on canonical visual-edit routes", async () => {
    await renderProbe("/visual-edit/design-123?editorView=overview");

    expect(coreClientMocks.setClientAppState).not.toHaveBeenCalled();
    const routeStateCalls = coreClientMocks.useAgentRouteState.mock.calls;
    const config = routeStateCalls[routeStateCalls.length - 1]?.[0];
    expect(
      config.getNavigationState({
        pathname: "/visual-edit/design-123",
        search: "?editorView=overview",
      }),
    ).toEqual({
      view: "editor",
      designId: "design-123",
      editorView: "overview",
    });
  });

  it("accepts the legacy view query on persisted editor routes", async () => {
    await renderProbe("/visual-edit/design-123?view=overview");

    const routeStateCalls = coreClientMocks.useAgentRouteState.mock.calls;
    const config = routeStateCalls[routeStateCalls.length - 1]?.[0];
    expect(
      config.getNavigationState({
        pathname: "/visual-edit/design-123",
        search: "?view=overview",
      }),
    ).toMatchObject({ editorView: "overview" });
  });

  it("keeps the canonical editor view when a legacy query conflicts after reload", async () => {
    await renderProbe(
      "/visual-edit/design-123?editorView=overview&view=single",
    );

    const routeStateCalls = coreClientMocks.useAgentRouteState.mock.calls;
    const config = routeStateCalls[routeStateCalls.length - 1]?.[0];
    expect(
      config.getNavigationState({
        pathname: "/visual-edit/design-123",
        search: "?editorView=overview&view=single",
      }),
    ).toMatchObject({ editorView: "overview" });
  });

  it("keeps the Builder shell out of persisted editor navigation state", async () => {
    await renderProbe("/visual-edit/shell?view=overview");

    expect(coreClientMocks.setClientAppState).toHaveBeenCalledWith(
      "design-selection:tab-123",
      null,
    );
    const routeStateCalls = coreClientMocks.useAgentRouteState.mock.calls;
    const config = routeStateCalls[routeStateCalls.length - 1]?.[0];
    expect(
      config.getNavigationState({
        pathname: "/visual-edit/shell",
        search: "?view=overview",
      }),
    ).toEqual({ view: "list" });
  });

  it("does not clear selection while route sync is disabled", async () => {
    await renderProbe("/", false);

    expect(coreClientMocks.setClientAppState).not.toHaveBeenCalled();
  });

  it("includes a selected template on both the Templates and New Design views", async () => {
    await renderProbe("/?templateId=saved-template");

    const calls = coreClientMocks.useAgentRouteState.mock.calls;
    const config = calls[calls.length - 1]?.[0];
    expect(
      config.getNavigationState({
        pathname: "/",
        search: "?templateId=saved-template",
      }),
    ).toEqual({ view: "list", templateId: "saved-template" });
    expect(
      config.getNavigationState({
        pathname: "/templates",
        search: "?templateId=preset-social-square",
      }),
    ).toEqual({
      view: "templates",
      templateId: "preset-social-square",
    });
  });
});
