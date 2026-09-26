// @vitest-environment happy-dom

import type { PlanContent } from "@shared/plan-content";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileStorage = vi.hoisted(() => ({
  data: { configured: true } as { configured: boolean } | undefined,
  isSuccess: true as boolean,
  isError: false as boolean,
  refetch: vi.fn(),
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
  useFileUploadStatus: () => fileStorage,
}));
vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupCard: () => <div data-testid="file-storage-setup-card" />,
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
  it("keeps setup closed while file storage status is unavailable and offers retry", async () => {
    vi.stubEnv("DEV", false);
    fileStorage.data = undefined;
    const configureImageNode = vi.spyOn(PlanImageNode, "configure");
    const content: PlanContent = {
      version: 2,
      blocks: [{ id: "body", type: "rich-text", data: { markdown: "Body." } }],
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

    expect(configureImageNode).toHaveBeenCalledWith({ onImageUpload: null });
    expect(
      container.querySelector("[data-testid=file-storage-setup-card]"),
    ).toBeNull();
    expect(container.textContent).toContain(
      "plansPage.loadError.storageStatusUnavailable",
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "plansPage.loadError.retry",
    );
    expect(retry).toBeTruthy();
    act(() => retry?.click());
    expect(fileStorage.refetch).toHaveBeenCalledOnce();
  });

  it("shows setup only after the status confirms storage is missing", async () => {
    vi.stubEnv("DEV", false);
    fileStorage.data = { configured: false };
    const content: PlanContent = {
      version: 2,
      blocks: [{ id: "body", type: "rich-text", data: { markdown: "Body." } }],
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
      container.querySelector("[data-testid=file-storage-setup-card]"),
    ).toBeTruthy();
    expect(container.textContent).not.toContain(
      "plansPage.loadError.storageStatusUnavailable",
    );
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
    expect(
      container.querySelector("[data-testid=file-storage-setup-card]"),
    ).toBeNull();
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
