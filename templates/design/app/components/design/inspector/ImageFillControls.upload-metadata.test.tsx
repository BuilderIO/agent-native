// @vitest-environment happy-dom

import {
  act,
  createElement,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadAction = vi.hoisted(() => ({ call: vi.fn() }));
const uploadStatus = vi.hoisted(() => ({
  value: { isSuccess: true, data: { configured: true } },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: uploadAction.call,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => uploadStatus.value,
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: () => null,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) =>
    createElement("input", props),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
  SelectContent: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
  SelectItem: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
  SelectTrigger: ({ children }: { children?: ReactNode }) =>
    createElement("button", null, children),
  SelectValue: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
}));

import { ImageFillControls } from "./ImageFillControls";

type FileReaderShim = {
  result: string | ArrayBuffer | null;
  error: DOMException | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsDataURL: () => void;
};

let root: Root;
let container: HTMLDivElement;

function deferredUploadActions() {
  const resolvers: Array<(value: unknown) => void> = [];
  uploadAction.call.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return resolvers;
}

async function renderControls(props: {
  url: string;
  fit: "fill" | "fit" | "crop" | "tile";
  targetKey: string;
  onChange: (...args: unknown[]) => void;
}) {
  await act(async () =>
    root.render(
      createElement(ImageFillControls, {
        value: { url: props.url, fit: props.fit },
        uploadTargetKey: props.targetKey,
        onChange: props.onChange,
      }),
    ),
  );
}

async function pickFile(name = "uploaded.png") {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("Image upload input was not rendered");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["image"], name, { type: "image/png" })],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

async function resolveUpload(
  resolve: (value: unknown) => void,
  value: unknown,
) {
  await act(async () => {
    resolve(value);
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "FileReader",
    class implements FileReaderShim {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,aW1hZ2U=";
        this.onload?.();
      }
    },
  );
  uploadAction.call.mockReset();
  uploadStatus.value = { isSuccess: true, data: { configured: true } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("ImageFillControls upload metadata", () => {
  it("uses the latest fill value and callback for a successful upload", async () => {
    const resolvers = deferredUploadActions();
    const firstChange = vi.fn();
    const latestChange = vi.fn();
    await renderControls({
      url: "/before.png",
      fit: "fill",
      targetKey: "file-a:layer-a",
      onChange: firstChange,
    });

    await pickFile();
    expect(uploadAction.call).toHaveBeenCalledOnce();
    await renderControls({
      url: "/sibling-update.png",
      fit: "tile",
      targetKey: "file-a:layer-a",
      onChange: latestChange,
    });
    await resolveUpload(resolvers[0]!, { url: "/uploaded.png" });

    expect(firstChange).not.toHaveBeenCalled();
    expect(latestChange.mock.calls).toEqual([
      [
        { url: "/uploaded.png", fit: "tile" },
        { requirePersistedSourceAcceptance: true },
      ],
    ]);
  });

  it("completes against the captured callback after the selected target changes", async () => {
    const resolvers = deferredUploadActions();
    const capturedTargetChange = vi.fn();
    const currentTargetChange = vi.fn();
    await renderControls({
      url: "",
      fit: "fill",
      targetKey: "file-a:layer-a",
      onChange: capturedTargetChange,
    });

    await pickFile();
    await renderControls({
      url: "",
      fit: "fill",
      targetKey: "file-a:layer-b",
      onChange: currentTargetChange,
    });
    await resolveUpload(resolvers[0]!, { url: "/uploaded.png" });

    expect(capturedTargetChange.mock.calls).toEqual([
      [
        { url: "/uploaded.png", fit: "fill" },
        { requirePersistedSourceAcceptance: true },
      ],
    ]);
    expect(currentTargetChange).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("/uploaded.png");
  });

  it("does not attach acceptance metadata when an upload fails", async () => {
    const resolvers = deferredUploadActions();
    const onChange = vi.fn();
    await renderControls({
      url: "",
      fit: "fill",
      targetKey: "file-a:layer-a",
      onChange,
    });

    await pickFile();
    await resolveUpload(resolvers[0]!, { error: "Storage unavailable" });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Storage unavailable");
  });

  it("ignores an older result when a newer upload is pending", async () => {
    const resolvers = deferredUploadActions();
    const onChange = vi.fn();
    await renderControls({
      url: "",
      fit: "fit",
      targetKey: "file-a:layer-a",
      onChange,
    });

    await pickFile("first.png");
    await pickFile("second.png");
    expect(uploadAction.call).toHaveBeenCalledTimes(2);

    await resolveUpload(resolvers[0]!, { url: "/first.png" });
    expect(onChange).not.toHaveBeenCalled();
    await resolveUpload(resolvers[1]!, { url: "/second.png" });

    expect(onChange.mock.calls).toEqual([
      [
        { url: "/second.png", fit: "fit" },
        { requirePersistedSourceAcceptance: true },
      ],
    ]);
  });

  it("completes after unmount and leaves manual changes unmarked", async () => {
    const resolvers = deferredUploadActions();
    const onChange = vi.fn();
    await renderControls({
      url: "/before.png",
      fit: "fill",
      targetKey: "file-a:layer-a",
      onChange,
    });

    await pickFile();
    await act(async () => root.unmount());
    await resolveUpload(resolvers[0]!, { url: "/uploaded.png" });
    expect(onChange.mock.calls).toEqual([
      [
        { url: "/uploaded.png", fit: "fill" },
        { requirePersistedSourceAcceptance: true },
      ],
    ]);

    root = createRoot(container);
    await renderControls({
      url: "/before.png",
      fit: "fill",
      targetKey: "file-a:layer-a",
      onChange,
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove image"]')
        ?.click(),
    );

    expect(onChange.mock.calls).toEqual([
      [
        { url: "/uploaded.png", fit: "fill" },
        { requirePersistedSourceAcceptance: true },
      ],
      [{ url: "", fit: "fill" }],
    ]);
  });

  it("keeps the newest request for a target across component remounts", async () => {
    const resolvers = deferredUploadActions();
    const firstTargetChange = vi.fn();
    const latestTargetChange = vi.fn();
    await renderControls({
      url: "",
      fit: "fit",
      targetKey: "file-a:layer-a",
      onChange: firstTargetChange,
    });
    await pickFile("first.png");
    await act(async () => root.unmount());

    root = createRoot(container);
    await renderControls({
      url: "",
      fit: "fit",
      targetKey: "file-a:layer-a",
      onChange: latestTargetChange,
    });
    await pickFile("second.png");
    expect(uploadAction.call).toHaveBeenCalledTimes(2);

    await resolveUpload(resolvers[1]!, { url: "/second.png" });
    await resolveUpload(resolvers[0]!, { url: "/first.png" });

    expect(latestTargetChange.mock.calls).toEqual([
      [
        { url: "/second.png", fit: "fit" },
        { requirePersistedSourceAcceptance: true },
      ],
    ]);
    expect(firstTargetChange).not.toHaveBeenCalled();
  });
});
