// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/creative-context/client", () => ({
  useCreativeContextLab: () => false,
  CreativeContextShareSheet: () => null,
}));

import { AssetActionsMenu } from "./brand-kits.$id";

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it.each([
  { folderId: null, absent: "library.unfiled", present: "Folder one" },
  { folderId: "folder-1", absent: "Folder one", present: "library.unfiled" },
])(
  "does not offer the current folder as a move destination",
  async ({ folderId, absent, present }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        createElement(
          MemoryRouter,
          {},
          createElement(AssetActionsMenu, {
            asset: { id: "asset-1", folderId },
            folders: [{ id: "folder-1", title: "Folder one" }],
            updateAsset: { mutate: vi.fn() },
            onDelete: vi.fn(),
          }),
        ),
      );
    });
    const button = host.querySelector(
      'button[aria-label="library.assetActions"]',
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
    });
    const move = [...document.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent?.includes("library.moveTo"),
    );
    expect(move).toBeDefined();
    await act(async () => {
      move?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      move?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(present);
    expect(document.body.textContent).not.toContain(absent);
  },
);
