// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { AssetFolderChips } from "./brand-kits.$id";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("counts only assets shown in the selected tab", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const props = {
    assets: [
      { id: "reference", status: "reference", folderId: null },
      { id: "saved", status: "saved", folderId: "folder-1" },
    ],
    folders: [{ id: "folder-1", title: "Folder one" }],
    activeFolderId: "all",
    onSelectFolder: vi.fn(),
  };
  await act(async () =>
    root.render(
      createElement(AssetFolderChips, { ...props, activeTab: "generated" }),
    ),
  );
  expect(host.textContent).toBe(
    "library.allAssets1library.unfiled0Folder one1",
  );
  await act(async () =>
    root.render(
      createElement(AssetFolderChips, { ...props, activeTab: "references" }),
    ),
  );
  expect(host.textContent).toBe(
    "library.allAssets1library.unfiled1Folder one0",
  );
  await act(async () => root.unmount());
});
