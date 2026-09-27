// @vitest-environment happy-dom

import type { PlanContent } from "@shared/plan-content";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileStorage = vi.hoisted(() => ({
  data: { configured: true } as { configured: boolean } | undefined,
  isSuccess: true as boolean,
  isError: false as boolean,
  refetch: vi.fn(),
  setupPopoverOpen: false,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => fileStorage,
}));
vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupPopover: ({
    open,
    status,
    onRetry,
  }: {
    open: boolean;
    status?: string;
    onRetry?: () => void;
  }) => {
    fileStorage.setupPopoverOpen = open;
    return open
      ? createElement(
          "div",
          { "data-testid": "file-storage-setup-popover" },
          status === "unavailable"
            ? "onboarding.fileStorage.statusUnavailable"
            : "onboarding.fileStorage.title",
          status === "unavailable"
            ? createElement("button", { onClick: onRetry }, "common.retry")
            : null,
        )
      : null;
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { PlanImageNode } from "../plan/PlanImageNode";
import { PlanDocumentEditor } from "./PlanDocumentEditor";

const IMAGE_SRC = "https://cdn.example.com/cat.png";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fileStorage.data = { configured: true };
  fileStorage.isSuccess = true;
  fileStorage.isError = false;
  fileStorage.refetch.mockClear();
  fileStorage.setupPopoverOpen = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  document
    .querySelectorAll("img")
    .forEach((image) => image.removeAttribute("src"));
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function flushEditorEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("PlanDocumentEditor image node", () => {
  it("shows retry only after an image replacement is attempted", async () => {
    vi.stubEnv("DEV", false);
    fileStorage.data = undefined;
    fileStorage.isSuccess = false;
    fileStorage.isError = true;
    const configureImageNode = vi.spyOn(PlanImageNode, "configure");
    const content: PlanContent = {
      version: 2,
      blocks: [
        {
          id: "body",
          type: "rich-text",
          data: { markdown: `![A cat](${IMAGE_SRC})` },
        },
      ],
    };

    act(() => {
      root.render(
        <PlanDocumentEditor
          content={content}
          editable
          onBlocksChange={vi.fn()}
        />,
      );
    });
    await flushEditorEffects();

    expect(configureImageNode).toHaveBeenCalledWith({
      onImageUpload: expect.any(Function),
    });
    expect(fileStorage.setupPopoverOpen).toBe(false);
    expect(container.textContent).not.toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
    const retryBeforeAttempt = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "common.retry");
    expect(retryBeforeAttempt).toBeUndefined();
    const upload = configureImageNode.mock.calls
      .map(([options]) => options.onImageUpload)
      .find((candidate) => typeof candidate === "function");
    expect(upload).toBeTypeOf("function");
    let pendingUpload: Promise<{ src: string; alt?: string }>;
    act(() => {
      pendingUpload = upload!(
        new File(["image"], "cat.png", { type: "image/png" }),
      );
    });
    void pendingUpload!.catch(() => {});
    expect(fileStorage.refetch).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
    expect(fileStorage.setupPopoverOpen).toBe(true);
    const retry = container.querySelector<HTMLButtonElement>("button");
    expect(retry?.textContent).toBe("common.retry");
    act(() => retry?.click());
    expect(fileStorage.refetch).toHaveBeenCalledTimes(2);
  });

  it("shows setup only after a file upload is attempted", async () => {
    vi.stubEnv("DEV", false);
    fileStorage.data = { configured: false };
    const content: PlanContent = {
      version: 2,
      blocks: [{ id: "body", type: "rich-text", data: { markdown: "Body." } }],
    };
    const configureImageNode = vi.spyOn(PlanImageNode, "configure");

    act(() => {
      root.render(
        <PlanDocumentEditor
          content={content}
          editable
          onBlocksChange={vi.fn()}
        />,
      );
    });
    await flushEditorEffects();

    expect(fileStorage.setupPopoverOpen).toBe(false);
    expect(container.textContent).not.toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
    let pendingUpload: Promise<{ src: string; alt?: string }>;
    const upload = configureImageNode.mock.calls
      .map(([options]) => options.onImageUpload)
      .find((candidate) => typeof candidate === "function");
    expect(upload).toBeTypeOf("function");
    act(() => {
      pendingUpload = upload!(
        new File(["image"], "cat.png", { type: "image/png" }),
      );
    });
    void pendingUpload!.catch(() => {});
    expect(fileStorage.setupPopoverOpen).toBe(true);
  });

  it("does not enable image replacement from stale configured storage data", async () => {
    vi.stubEnv("DEV", false);
    fileStorage.data = { configured: true };
    fileStorage.isSuccess = false;
    fileStorage.isError = true;
    const content: PlanContent = {
      version: 2,
      blocks: [
        {
          id: "rich-text-with-image",
          type: "rich-text",
          data: { markdown: `![A cat](${IMAGE_SRC})` },
        },
      ],
    };

    act(() => {
      root.render(
        <PlanDocumentEditor
          content={content}
          editable
          onBlocksChange={vi.fn()}
        />,
      );
    });
    await flushEditorEffects();

    expect(
      container.querySelector<HTMLInputElement>(
        ".plan-image-node input[type=file]",
      )?.disabled,
    ).toBe(true);
    expect(fileStorage.setupPopoverOpen).toBe(false);
    expect(container.textContent).not.toContain(
      "onboarding.fileStorage.statusUnavailable",
    );
  });

  it("mounts markdown images without reading editor.view.dom before the view exists", async () => {
    const content: PlanContent = {
      version: 2,
      blocks: [
        {
          id: "rich-text-with-image",
          type: "rich-text",
          data: {
            markdown: `Intro copy.\n\n![A cat](${IMAGE_SRC})\n\nDone.`,
          },
        },
      ],
    };

    expect(() => {
      act(() => {
        root.render(
          <PlanDocumentEditor
            content={content}
            editable
            onBlocksChange={vi.fn()}
          />,
        );
      });
    }).not.toThrow();

    await flushEditorEffects();
    await flushEditorEffects();

    const image = container.querySelector(
      ".plan-image-node img",
    ) as HTMLImageElement | null;
    expect(
      container.querySelector(".plan-document-editor .ProseMirror"),
    ).toBeTruthy();
    expect(image?.getAttribute("src")).toBe(IMAGE_SRC);
    expect(image?.getAttribute("alt")).toBe("A cat");
  });
});
