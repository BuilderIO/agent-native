// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendToAgentChat: vi.fn(),
  refetchStorageStatus: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendToAgentChat,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/components/editor/UploadStorageGate", () => ({
  UploadStorageGate: () => null,
}));
vi.mock("@/hooks/use-slide-file-storage-status", () => ({
  useSlideFileStorageStatus: () => ({
    data: { configured: true },
    isError: false,
    isLoading: false,
    refetch: mocks.refetchStorageStatus,
  }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

import ImageDropPromptPopover from "./ImageDropPromptPopover";

function renderPopover(file: File) {
  return render(
    <ImageDropPromptPopover
      open
      file={file}
      position={{ x: 100, y: 100 }}
      onClose={vi.fn()}
    />,
  );
}

describe("<ImageDropPromptPopover> upload failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: "Private file storage failed." }),
            {
              status: 503,
            },
          ),
        ),
      ),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends a small image inline after a transient 503 with storage configured", async () => {
    renderPopover(new File(["image"], "dropped.png", { type: "image/png" }));

    fireEvent.click(screen.getByRole("button", { name: "raw.sendToAgent" }));

    await waitFor(() => expect(mocks.sendToAgentChat).toHaveBeenCalledTimes(1));
    const submission = mocks.sendToAgentChat.mock.calls[0]?.[0];
    expect(submission.images[0]).toMatch(/^data:image\/png;base64,/);
    expect(submission.context).toContain("Hosted upload failed");
    expect(mocks.refetchStorageStatus).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows the upload error when a transient 503 has no inline fallback", async () => {
    renderPopover(
      new File([new Uint8Array(750_000)], "large.png", { type: "image/png" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "raw.sendToAgent" }));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("raw.imageUploadFailed", {
        description: "Private file storage failed.",
      }),
    );
    expect(mocks.sendToAgentChat).not.toHaveBeenCalled();
    expect(mocks.refetchStorageStatus).not.toHaveBeenCalled();
  });
});
