// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: {
    data: undefined as { configured: boolean } | undefined,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
  },
  uploadEditorImage: vi.fn(),
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: mocks.uploadEditorImage,
  useFileUploadStatus: () => mocks.status,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => `/plan${path}`,
}));

vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", async () => {
  const React = await import("react");
  return {
    FileStorageSetupPopover: ({
      open,
      status,
    }: {
      open: boolean;
      status?: string;
    }) =>
      open
        ? React.createElement(
            "div",
            { role: "dialog", "data-status": status },
            "Connect storage",
          )
        : null,
  };
});

import { usePlanImageUpload } from "./use-plan-image-upload";

let upload: ReturnType<typeof usePlanImageUpload> | null = null;

function Probe({ planId = "plan_1" }: { planId?: string | null }) {
  const hook = usePlanImageUpload(planId);
  const { requestUpload, storagePrompt } = hook;
  upload = hook;
  return createElement(
    "div",
    null,
    createElement("button", { onClick: requestUpload }, "Upload image"),
    storagePrompt,
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubEnv("DEV", false);
  mocks.status.data = undefined;
  mocks.status.isError = false;
  mocks.status.isSuccess = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  upload = null;
});

function storageConnected() {
  mocks.status.data = { configured: true };
  mocks.status.isSuccess = true;
}

const image = () => new File(["PNGDATA"], "diagram.png", { type: "image/png" });

describe("usePlanImageUpload", () => {
  it("shows retryable storage status only after upload is requested", () => {
    act(() => root.render(createElement(Probe) as ReactNode));
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    act(() => container.querySelector("button")?.click());

    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-status"),
    ).toBe("unavailable");
  });

  it("adds the image to the plan, privately, through the plan's image route", async () => {
    storageConnected();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "passet_1",
            url: "/_agent-native/plan-asset/passet_1/diagram.png",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    act(() => root.render(createElement(Probe) as ReactNode));

    await expect(upload!.uploadImage(image())).resolves.toEqual({
      src: "/_agent-native/plan-asset/passet_1/diagram.png",
      alt: "diagram",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/plan/_agent-native/plan-asset");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("planId")).toBe("plan_1");
    expect((body.get("file") as File).name).toBe("diagram.png");
  });

  it("offers to connect storage when the server has none to keep the image", async () => {
    storageConnected();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Connect storage",
              code: "storage_unavailable",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    act(() => root.render(createElement(Probe) as ReactNode));

    await act(async () => {
      await expect(upload!.uploadImage(image())).rejects.toThrow(
        "Connect storage",
      );
    });

    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-status"),
    ).toBe("missing");
  });

  it("won't add an image outside a plan", async () => {
    storageConnected();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    act(() => root.render(createElement(Probe, { planId: null }) as ReactNode));

    await expect(upload!.uploadImage(image())).rejects.toThrow(
      "Save the plan before adding images.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps one upload function, which an editor can hold while storage connects", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ url: "/_agent-native/plan-asset/passet_1/a.png" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.status.isSuccess = true;
    mocks.status.data = { configured: false };
    act(() => root.render(createElement(Probe) as ReactNode));
    const heldByEditor = upload!.uploadImage;

    storageConnected();
    act(() => root.render(createElement(Probe) as ReactNode));

    expect(upload!.uploadImage).toBe(heldByEditor);
    await expect(heldByEditor(image())).resolves.toMatchObject({
      src: "/_agent-native/plan-asset/passet_1/a.png",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a local folder plan's image where it went before, since no database row backs that plan", async () => {
    storageConnected();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.uploadEditorImage.mockResolvedValue({ src: "/uploads/a.png" });
    act(() =>
      root.render(
        createElement(Probe, { planId: "local-checkout" }) as ReactNode,
      ),
    );

    await expect(upload!.uploadImage(image())).resolves.toEqual({
      src: "/uploads/a.png",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
