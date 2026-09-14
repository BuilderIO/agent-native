// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveLanding, useLastLocationTitleHint } = vi.hoisted(() => ({
  resolveLanding: {
    mutateAsync: vi.fn(),
    isError: false,
    isPending: false,
    reset: vi.fn(),
  },
  useLastLocationTitleHint: vi.fn(
    () => null as null | { documentId: string; title: string },
  ),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => resolveLanding,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-optimistic-document-title", () => ({
  useLastLocationTitleHint,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

const navigate = vi.fn();

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/home", search: "", hash: "" }),
  useNavigate: () => navigate,
}));

import {
  peekLandingTitleHint,
  stashLandingTitleHint,
} from "@/lib/document-title-hint";

import HomeRoute from "./_app.home";

function renderHome(root: Root) {
  act(() => {
    root.render(<HomeRoute />);
  });
}

describe("home landing route optimistic title", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resolveLanding.mutateAsync.mockReset();
    resolveLanding.isError = false;
    useLastLocationTitleHint.mockReturnValue(null);
    navigate.mockReset();
    stashLandingTitleHint(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resolveLanding.reset.mockClear();
  });

  it("keeps the plain skeleton when nothing knows the title", async () => {
    resolveLanding.mutateAsync.mockResolvedValue({
      documentId: "doc-1",
      resolution: "restored",
    });
    renderHome(root);
    expect(container.textContent).not.toContain("Quarterly planning notes");
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/page/doc-1", search: "", hash: "" },
      { replace: true },
    );
  });

  it("paints the persisted title immediately and hands it to the editor", async () => {
    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    resolveLanding.mutateAsync.mockResolvedValue({
      documentId: "doc-1",
      resolution: "restored",
    });
    renderHome(root);
    expect(container.textContent).toContain("Quarterly planning notes");
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/page/doc-1", search: "", hash: "" },
      { replace: true },
    );
    expect(peekLandingTitleHint("doc-1")).toEqual({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    expect(peekLandingTitleHint("doc-2")).toBeNull();
  });

  it("never hands a title forward when the resolver restores another page", async () => {
    useLastLocationTitleHint.mockReturnValue({
      documentId: "doc-1",
      title: "Quarterly planning notes",
    });
    resolveLanding.mutateAsync.mockResolvedValue({
      documentId: "welcome-1",
      resolution: "fallback",
      fallbackReason: "saved-document-unavailable",
    });
    renderHome(root);
    expect(container.textContent).toContain("Quarterly planning notes");
    await act(async () => {
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledWith(
      { pathname: "/page/welcome-1", search: "", hash: "" },
      { replace: true },
    );
    expect(peekLandingTitleHint("welcome-1")).toBeNull();
    expect(peekLandingTitleHint("doc-1")).toBeNull();
  });
});
