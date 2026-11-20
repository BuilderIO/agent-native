// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageUpload } from "./ImageUpload";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  status: { isSuccess: true, isError: false, isPending: false } as Record<
    string,
    unknown
  >,
  upload: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: mocks.upload,
  useFileUploadStatus: () => ({ ...mocks.status, refetch: mocks.refetch }),
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: ({ open }: { open: boolean }) =>
    open ? <div data-testid="storage-setup" /> : null,
}));
vi.mock("@/components/ui/sonner", () => ({ sonnerToast: { error: vi.fn() } }));

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <ImageUpload
        uploadLabel="Upload"
        removeLabel="Remove"
        url={undefined}
        onUploaded={vi.fn()}
        onRemove={vi.fn()}
      />,
    ),
  );
  const click = vi.spyOn(
    host.querySelector<HTMLInputElement>("input[type=file]") as HTMLElement,
    "click",
  );
  const button = host.querySelector<HTMLButtonElement>("button");
  act(() => button?.click());
  return { host, root, click };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("ImageUpload storage gate", () => {
  it("opens the setup popover and starts no upload when storage is not configured", () => {
    mocks.status = {
      isSuccess: true,
      isError: false,
      isPending: false,
      data: { configured: false },
    };
    const { host, click } = mount();
    expect(host.querySelector("[data-testid=storage-setup]")).not.toBeNull();
    expect(click).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("opens the file picker when storage is configured", () => {
    mocks.status = {
      isSuccess: true,
      isError: false,
      isPending: false,
      data: { configured: true },
    };
    const { host, click } = mount();
    expect(host.querySelector("[data-testid=storage-setup]")).toBeNull();
    expect(click).toHaveBeenCalledOnce();
  });
});
