// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  pathname: "/home",
  useDbSync: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useLocation: () => ({ pathname: mocks.pathname }),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useDbSync: mocks.useDbSync,
}));

import { DbSyncSetup, isPrivateDesignEditorPath } from "./root";

async function renderAt(pathname: string) {
  mocks.pathname = pathname;
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <DbSyncSetup />
      </QueryClientProvider>,
    );
  });
  await act(async () => root.unmount());
  return mocks.useDbSync.mock.lastCall?.[0] as {
    realtime?: { reason: string };
  };
}

describe("design realtime sync opt-in", () => {
  beforeEach(() => {
    mocks.useDbSync.mockClear();
  });

  it("opens the shared transport while a design is open so collaborators' saves arrive without a refresh", async () => {
    const options = await renderAt("/design/abc123");
    expect(options.realtime?.reason).toBeTruthy();
  });

  it("stays opted out on routes where nobody else edits the open page", async () => {
    for (const pathname of ["/home", "/templates", "/design-systems"]) {
      expect((await renderAt(pathname)).realtime).toBeUndefined();
    }
  });

  it("matches only the design editor path", () => {
    expect(isPrivateDesignEditorPath("/design/abc123")).toBe(true);
    expect(isPrivateDesignEditorPath("/design-systems")).toBe(false);
    expect(isPrivateDesignEditorPath("/")).toBe(false);
  });
});
