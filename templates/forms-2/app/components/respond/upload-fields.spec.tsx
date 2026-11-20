// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilePicker, SignaturePad } from "./upload-fields";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  configured: true,
  ownerState: "available",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutateAsync: vi.fn() }),
  useActionQuery: () => ({ isError: false, data: { state: mocks.ownerState } }),
}));
vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    isPending: false,
    data: { configured: mocks.configured },
    refetch: vi.fn(),
  }),
}));
vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: ({ open }: { open: boolean }) =>
    open ? <div data-testid="storage-setup" /> : null,
}));
vi.mock("@/components/ui/sonner", () => ({ sonnerToast: { error: vi.fn() } }));

const context = {
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
};

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() =>
    context) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.toBlob = (callback: BlobCallback) =>
    callback(new Blob(["png"], { type: "image/png" }));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function draw(canvas: Element | null) {
  const fire = (type: string) =>
    canvas?.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 }),
    );
  act(() => {
    fire("pointerdown");
    fire("pointermove");
    fire("pointerup");
  });
}

function mount(onDrawn: (png: Blob) => Promise<void>, formId?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() =>
    createRoot(host).render(
      <SignaturePad
        signedUrl={null}
        invalid={false}
        label="canvas"
        formId={formId}
        onDrawn={onDrawn}
        onClear={() => undefined}
      />,
    ),
  );
  return host;
}

describe("SignaturePad", () => {
  it("hands the drawn PNG to the upload when a stroke ends", async () => {
    mocks.configured = true;
    const onDrawn = vi.fn().mockResolvedValue(undefined);
    const host = mount(onDrawn);
    draw(host.querySelector("canvas"));
    await vi.waitFor(() => expect(onDrawn).toHaveBeenCalledTimes(1));
    expect(onDrawn.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(context.lineTo).toHaveBeenCalled();
  });

  it("opens the storage setup popover instead of drawing when storage is missing", () => {
    mocks.configured = false;
    const onDrawn = vi.fn();
    const host = mount(onDrawn);
    draw(host.querySelector("canvas"));
    expect(host.querySelector("[data-testid=storage-setup]")).not.toBeNull();
    expect(onDrawn).not.toHaveBeenCalled();
    expect(context.lineTo).not.toHaveBeenCalled();
  });

  it("tells a respondent uploads are unavailable, without the setup popover, when the owner has no storage", () => {
    mocks.ownerState = "unavailable";
    const onDrawn = vi.fn();
    const host = mount(onDrawn, "form-1");
    draw(host.querySelector("canvas"));
    expect(document.body.textContent).toContain("forms.uploads.unavailable");
    expect(host.querySelector("[data-testid=storage-setup]")).toBeNull();
    expect(onDrawn).not.toHaveBeenCalled();
    mocks.ownerState = "available";
  });
});

describe("FilePicker", () => {
  it("shows the chosen file's name, not the hosted asset key", () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() =>
      createRoot(host).render(
        <FilePicker
          settings={{}}
          files={[
            {
              url: "https://cdn.example.test/assets/space/6c3a6740652e47e9ab79a2db5371d3fe",
              name: "QA-pretest-named.txt",
            },
          ]}
          invalid={false}
          label="choose"
          onChange={() => undefined}
        />,
      ),
    );
    expect(host.textContent).toContain("QA-pretest-named.txt");
    expect(host.textContent).not.toContain("6c3a6740652e47e9ab79a2db5371d3fe");
  });
});
