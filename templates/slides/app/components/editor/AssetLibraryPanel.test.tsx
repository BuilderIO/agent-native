// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (path: string) => path,
}));
vi.mock("@/hooks/use-slide-file-storage-status", () => ({
  useSlideFileStorageStatus: () => ({
    data: { configured: true },
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/editor/UploadStorageGate", () => ({
  UploadStorageGate: () => null,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";

import AssetLibraryPanel from "./AssetLibraryPanel";

const asset = {
  id: "a1",
  url: "https://cdn.example.test/a1.png",
  filename: "a1.png",
  type: "image/png",
  size: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("<AssetLibraryPanel>", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows an error state, not an empty library, when the list request fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    render(
      <AssetLibraryPanel open onOpenChange={vi.fn()} onSelectAsset={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("raw.assetLoadFailed")).toBeTruthy(),
    );
    expect(screen.queryByText("raw.noAssetsYet")).toBeNull();
  });

  it("treats a non-list body as a failed load", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 200 }),
    );
    render(
      <AssetLibraryPanel open onOpenChange={vi.fn()} onSelectAsset={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("raw.assetLoadFailed")).toBeTruthy(),
    );
  });

  it("treats rows that are not assets as a failed load", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([{ error: "proxy" }]), { status: 200 }),
    );
    render(
      <AssetLibraryPanel open onOpenChange={vi.fn()} onSelectAsset={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByText("raw.assetLoadFailed")).toBeTruthy(),
    );
  });

  it("keeps the panel open and reports when the selection applied nothing", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([asset]), { status: 200 }),
    );
    const onOpenChange = vi.fn();
    const onSelectAsset = vi.fn(() => false);
    render(
      <AssetLibraryPanel
        open
        onOpenChange={onOpenChange}
        onSelectAsset={onSelectAsset}
      />,
    );
    const tile = await screen.findByAltText("a1.png");
    fireEvent.click(tile.closest("button")!);
    expect(onSelectAsset).toHaveBeenCalledWith(asset.url);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toast.error).toHaveBeenCalledWith("raw.assetSelectNoChange");
  });

  it("closes the panel when the selection applied", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify([asset]), { status: 200 }),
    );
    const onOpenChange = vi.fn();
    render(
      <AssetLibraryPanel
        open
        onOpenChange={onOpenChange}
        onSelectAsset={() => true}
      />,
    );
    const tile = await screen.findByAltText("a1.png");
    fireEvent.click(tile.closest("button")!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
