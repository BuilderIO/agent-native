import type { PromptComposerProps } from "@agent-native/toolkit/app/chat/composer/index";
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const uploadFiles = vi.hoisted(() => vi.fn());
const noop = vi.hoisted(() => vi.fn());
const image = new File(["image"], "reference.png", { type: "image/png" });
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-slide-file-storage-status", () => ({
  useSlideFileStorageStatus: () => ({
    data: { configured: true },
    refetch: noop,
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/composer/index", () => ({
  PromptComposer: (props: PromptComposerProps) => (
    <button onClick={() => props.onSubmit("Use this image", [image], [], {})}>
      Send reference
    </button>
  ),
  useEagerFileUploads: () => ({
    uploadFiles,
    commitFiles: noop,
    discardFiles: noop,
    retainFiles: noop,
    syncFiles: noop,
    reset: noop,
    uploading: false,
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: () => null,
}));
vi.mock("./GoogleDocImportHint", () => ({ GoogleDocImportHint: () => null }));

import { AddSlidePopover } from "./AddSlidePopover";
afterEach(cleanup);

it("forwards inline-only reference images to the add-slide agent", async () => {
  const dataUrl = "data:image/png;base64,aW1hZ2U=";
  uploadFiles.mockResolvedValue([
    {
      path: "uploads/reference.png",
      originalName: image.name,
      filename: image.name,
      type: image.type,
      size: image.size,
      dataUrl,
    },
  ]);
  const agentSubmit = vi.fn().mockResolvedValue(true);
  render(
    <AddSlidePopover
      open
      onOpenChange={noop}
      anchorRef={{ current: document.body }}
      deckId="deck-1"
      deckTitle="Deck"
      activeSlideId="slide-1"
      activeSlideIndex={0}
      slideCount={1}
      agentSubmit={agentSubmit}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Send reference" }));
  await waitFor(() =>
    expect(agentSubmit).toHaveBeenCalledWith(
      "Use this image",
      expect.any(String),
      { images: [dataUrl], attachments: [] },
    ),
  );
});
