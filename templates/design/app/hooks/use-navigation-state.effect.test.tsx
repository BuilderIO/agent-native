// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const coreClientMocks = vi.hoisted(() => ({
  getBrowserTabId: vi.fn(() => "tab-123"),
  setClientAppState: vi.fn(() => Promise.resolve(null)),
  useAgentRouteState: vi.fn(),
}));

vi.mock("@agent-native/core/client", () => coreClientMocks);

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
        <Probe enabled={enabled} />
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

  it("does not clear selection while route sync is disabled", async () => {
    await renderProbe("/", false);

    expect(coreClientMocks.setClientAppState).not.toHaveBeenCalled();
  });
});
