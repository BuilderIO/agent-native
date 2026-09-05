// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VisualizerStatusCallback = (
  status: string,
  detail?: { error?: string | null },
) => void;

const visualizerCallbacks = vi.hoisted(() => ({
  micStatusChange: null as VisualizerStatusCallback | null,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => {
  const translate = (key: string) => key;
  return { useT: () => translate };
});

vi.mock("@/components/capture-install-options", () => ({
  CaptureInstallInlineLink: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("./microphone-visualizer", () => ({
  friendlyMicError: vi.fn(async () => "microphone error"),
  MicrophoneVisualizer: (props: {
    onStatusChange: VisualizerStatusCallback;
  }) => {
    visualizerCallbacks.micStatusChange = props.onStatusChange;
    return <span data-testid="microphone-waveform" />;
  },
}));

vi.mock("./recorder-engine", () => ({
  NO_CAMERA_DEVICE_ID: "__clips_no_camera__",
  NO_MIC_DEVICE_ID: "__clips_no_microphone__",
  normalizeDisplaySurfaceForRuntime: (surface: string) => surface,
  supportsBrowserTabCapture: () => true,
}));

import { PreRecordPanel } from "./pre-record-panel";

function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected an interactive element");
  }
  element.click();
}

function openMenu(element: Element | null): void {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected a menu trigger");
  }
  element.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
}

describe("PreRecordPanel desktop-aligned setup", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let storage: Map<string, string>;
  let enumeratedDevices: MediaDeviceInfo[];

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    enumeratedDevices = [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => enumeratedDevices),
        getDisplayMedia: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 720,
    });
    visualizerCallbacks.micStatusChange = null;
    storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    vi.unstubAllGlobals();
  });

  async function renderPanel(onStart = vi.fn()) {
    await act(async () => {
      root?.render(<PreRecordPanel onStart={onStart} />);
      await Promise.resolve();
    });
    return onStart;
  }

  function mediaDevice(
    kind: MediaDeviceKind,
    deviceId: string,
    label: string,
  ): MediaDeviceInfo {
    return {
      kind,
      deviceId,
      label,
      groupId: "group",
      toJSON: () => ({}),
    };
  }

  it("keeps tooltip state off the selected mode and enabled switches", async () => {
    await renderPanel();

    const selectedMode = container.querySelector(
      '[aria-label="preRecord.modeScreenCamera"]',
    );
    const cameraSwitch = container.querySelector(
      '[role="switch"][aria-label="preRecord.includeCameraAria"]',
    );
    const micSwitch = container.querySelector(
      '[role="switch"][aria-label="preRecord.includeAudioAria"]',
    );

    expect(selectedMode?.getAttribute("data-state")).toBe("on");
    expect(selectedMode?.className).toContain(
      "dark:data-[state=on]:bg-foreground",
    );
    expect(selectedMode?.className).toContain(
      "dark:data-[state=on]:text-background",
    );
    expect(cameraSwitch?.getAttribute("data-state")).toBe("checked");
    expect(micSwitch?.getAttribute("data-state")).toBe("checked");
    expect(selectedMode?.parentElement?.getAttribute("data-state")).toBe(
      "closed",
    );
    expect(cameraSwitch?.parentElement?.getAttribute("data-state")).toBe(
      "closed",
    );
    expect(cameraSwitch?.className).toContain(
      "data-[state=checked]:bg-success",
    );
    expect(cameraSwitch?.className).toContain(
      "data-[state=unchecked]:bg-muted-foreground/30",
    );
  });

  it("renders only the desktop-aligned setup rows and one inline mic waveform", async () => {
    await renderPanel();

    const sourceTrigger = container.querySelector(
      '[aria-label^="preRecord.selectedSurface"]',
    );
    const cameraTrigger = container.querySelector(
      '[aria-label="preRecord.defaultCamera"]',
    );
    const microphoneTrigger = container.querySelector(
      '[aria-label="preRecord.defaultMicrophone"]',
    );
    const waveform = container.querySelector(
      '[data-testid="microphone-waveform"]',
    );
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "preRecord.startRecording",
    );

    expect(sourceTrigger).not.toBeNull();
    expect(cameraTrigger).not.toBeNull();
    expect(microphoneTrigger).not.toBeNull();
    expect(startButton).toBeDefined();
    expect(
      container.querySelectorAll('[data-testid="microphone-waveform"]'),
    ).toHaveLength(1);
    expect(microphoneTrigger?.contains(waveform)).toBe(true);
    expect(container.querySelector('[data-testid="camera-test"]')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toContain("preRecord.import");
    expect(container.textContent).not.toContain("preRecord.uploadVideo");
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        /preRecord\.(?:check|choose)|microphoneVisualizer\.test/.test(
          button.textContent ?? "",
        ),
      ),
    ).toBe(false);
  });

  it("uses the desktop camera transition without changing microphone state", async () => {
    await renderPanel();

    const cameraSwitchSelector =
      '[role="switch"][aria-label="preRecord.includeCameraAria"]';
    const micSwitchSelector =
      '[role="switch"][aria-label="preRecord.includeAudioAria"]';

    await act(async () => click(container.querySelector(cameraSwitchSelector)));

    expect(
      container
        .querySelector('[aria-label="preRecord.modeScreenOnly"]')
        ?.getAttribute("data-state"),
    ).toBe("on");
    expect(
      container.querySelector(cameraSwitchSelector)?.getAttribute("data-state"),
    ).toBe("unchecked");
    expect(
      container.querySelector(micSwitchSelector)?.getAttribute("data-state"),
    ).toBe("checked");

    await act(async () => click(container.querySelector(cameraSwitchSelector)));

    expect(
      container
        .querySelector('[aria-label="preRecord.modeScreenCamera"]')
        ?.getAttribute("data-state"),
    ).toBe("on");
    expect(
      container.querySelector(cameraSwitchSelector)?.getAttribute("data-state"),
    ).toBe("checked");
  });

  it("keeps every mode coherent and never hides the camera control", async () => {
    await renderPanel();

    const cameraSwitchSelector =
      '[role="switch"][aria-label="preRecord.includeCameraAria"]';
    const micSwitchSelector =
      '[role="switch"][aria-label="preRecord.includeAudioAria"]';

    await act(async () =>
      click(container.querySelector('[aria-label="preRecord.modeCameraOnly"]')),
    );

    expect(container.querySelector(cameraSwitchSelector)).not.toBeNull();
    expect(
      container.querySelector(cameraSwitchSelector)?.getAttribute("data-state"),
    ).toBe("checked");
    expect(
      container.querySelector(micSwitchSelector)?.getAttribute("data-state"),
    ).toBe("checked");
    expect(
      container.querySelector('[aria-label^="preRecord.selectedSurface"]'),
    ).toBeNull();

    await act(async () => click(container.querySelector(cameraSwitchSelector)));

    expect(container.textContent).toContain("preRecord.cameraOff");
    expect(container.querySelector(cameraSwitchSelector)).not.toBeNull();
    expect(
      container
        .querySelector('[aria-label="preRecord.modeScreenOnly"]')
        ?.getAttribute("data-state"),
    ).toBe("on");
    expect(
      container.querySelector(micSwitchSelector)?.getAttribute("data-state"),
    ).toBe("checked");
  });

  it("preserves screen mode and all choices at a narrow desktop viewport", async () => {
    await renderPanel();

    await act(async () =>
      click(container.querySelector('[aria-label="preRecord.modeScreenOnly"]')),
    );
    await act(async () =>
      click(
        container.querySelector('[aria-label="preRecord.modeScreenCamera"]'),
      ),
    );

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 360,
    });
    await act(async () => window.dispatchEvent(new Event("resize")));

    expect(
      container
        .querySelector('[aria-label="preRecord.modeScreenCamera"]')
        ?.getAttribute("data-state"),
    ).toBe("on");
    expect(
      container.querySelector('[aria-label="preRecord.modeScreenOnly"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="preRecord.modeCameraOnly"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label^="preRecord.selectedSurface"]'),
    ).not.toBeNull();
    expect(
      JSON.parse(storage.get("clips:recorder-preferences") ?? "{}").mode,
    ).toBe("screen+camera");
  });

  it("uses a session-only camera fallback without overwriting desktop preferences", async () => {
    storage.set(
      "clips:recorder-preferences",
      JSON.stringify({ mode: "screen+camera", cameraOn: true }),
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => enumeratedDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const onStart = await renderPanel();

    expect(container.textContent).toContain("preRecord.startCameraRecording");
    expect(
      container.querySelector('[aria-label^="preRecord.selectedSurface"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="preRecord.modeScreenOnly"]'),
    ).toBeNull();

    await act(async () =>
      click(
        Array.from(container.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("preRecord.startCameraRecording"),
        ) ?? null,
      ),
    );

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "camera" }),
    );
    expect(
      JSON.parse(storage.get("clips:recorder-preferences") ?? "{}").mode,
    ).toBe("screen+camera");
  });

  it("uses the camera-specific CTA and semantic recording indicator", async () => {
    await renderPanel();

    const defaultStartButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("preRecord.startRecording"),
    );
    expect(defaultStartButton).toBeDefined();
    expect(
      defaultStartButton?.querySelector('span[aria-hidden="true"]')?.className,
    ).toContain("bg-destructive");

    await act(async () =>
      click(container.querySelector('[aria-label="preRecord.modeCameraOnly"]')),
    );

    expect(container.textContent).toContain("preRecord.startCameraRecording");
    expect(container.textContent).not.toContain("preRecord.startRecording");
  });

  it("restores the selected microphone after off and preserves it across modes", async () => {
    enumeratedDevices = [
      mediaDevice("audioinput", "studio-mic", "Studio microphone"),
    ];
    storage.set(
      "clips:recorder-preferences",
      JSON.stringify({
        mode: "screen+camera",
        cameraOn: true,
        micId: "studio-mic",
        micLabel: "Studio microphone",
      }),
    );
    await renderPanel();

    const micSwitchSelector =
      '[role="switch"][aria-label="preRecord.includeAudioAria"]';
    await act(async () => click(container.querySelector(micSwitchSelector)));
    expect(container.textContent).toContain("preRecord.noMicrophone");

    await act(async () => click(container.querySelector(micSwitchSelector)));
    expect(container.textContent).toContain("Studio microphone");

    await act(async () =>
      click(container.querySelector('[aria-label="preRecord.modeScreenOnly"]')),
    );
    expect(container.textContent).toContain("Studio microphone");
    expect(
      container.querySelector(micSwitchSelector)?.getAttribute("data-state"),
    ).toBe("checked");

    const saved = JSON.parse(
      storage.get("clips:recorder-preferences") ?? "{}",
    ) as Record<string, unknown>;
    expect(saved.lastActiveMicId).toBe("studio-mic");
    expect(saved.lastActiveMicLabel).toBe("Studio microphone");
  });

  it("clears a failed mic test after audio is toggled off and on", async () => {
    await renderPanel();
    const micSwitchSelector =
      '[role="switch"][aria-label="preRecord.includeAudioAria"]';
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "preRecord.startRecording",
    );

    await act(async () =>
      visualizerCallbacks.micStatusChange?.("error", { error: "blocked" }),
    );
    expect(startButton?.hasAttribute("disabled")).toBe(true);

    await act(async () => click(container.querySelector(micSwitchSelector)));
    await act(async () => click(container.querySelector(micSwitchSelector)));

    expect(startButton?.hasAttribute("disabled")).toBe(false);
  });

  it("clears failed validation when a different microphone is selected", async () => {
    enumeratedDevices = [
      mediaDevice("audioinput", "backup-mic", "Backup microphone"),
    ];
    await renderPanel();
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "preRecord.startRecording",
    );

    await act(async () =>
      visualizerCallbacks.micStatusChange?.("error", { error: "blocked" }),
    );
    expect(startButton?.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      openMenu(
        container.querySelector('[aria-label="preRecord.defaultMicrophone"]'),
      );
      await Promise.resolve();
    });
    await act(async () =>
      click(
        Array.from(
          document.body.querySelectorAll('[role="menuitemradio"]'),
        ).find((item) => item.textContent === "Backup microphone") ?? null,
      ),
    );
    expect(startButton?.hasAttribute("disabled")).toBe(false);
  });

  it("reports failed setup writes, recovers the queue, and sends the latest state last", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const pending: Array<{
      resolve: (response: Response) => void;
      reject: (reason: unknown) => void;
    }> = [];
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderPanel();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () =>
      click(container.querySelector('[aria-label="preRecord.modeScreenOnly"]')),
    );
    await act(async () =>
      click(
        container.querySelector('[aria-label="preRecord.modeScreenCamera"]'),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]?.reject(new Error("first write failed"));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(consoleError).toHaveBeenCalledWith(
      "[Clips recorder] Failed to sync recording setup application state; queued updates will continue.",
      expect.objectContaining({ message: "first write failed" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).mode).toBe(
      "screen",
    );

    await act(async () => {
      pending[1]?.resolve(new Response(null, { status: 204 }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).mode).toBe(
      "screen+camera",
    );

    pending[2]?.resolve(new Response(null, { status: 204 }));
    consoleError.mockRestore();
  });

  it("uses radio menu semantics without a selected-row background or scrolling", async () => {
    await renderPanel();

    await act(async () => {
      openMenu(
        container.querySelector('[aria-label^="preRecord.selectedSurface"]'),
      );
      await Promise.resolve();
    });

    const items = Array.from(
      document.body.querySelectorAll('[role="menuitemradio"]'),
    );
    expect(items).toHaveLength(3);
    expect(
      items.find((item) => item.getAttribute("aria-checked") === "true")
        ?.textContent,
    ).toContain("preRecord.surfaceWindow");
    expect(items[0]?.className).toContain("focus:bg-accent");
    expect(items[0]?.className).not.toContain("data-[state=checked]:bg-accent");

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu?.className).not.toContain("overflow-y-auto");
    expect(menu?.className).not.toContain("overflow-y-scroll");
  });

  it("bounds long camera and microphone menus and selects from full pickers", async () => {
    enumeratedDevices = [
      ...Array.from({ length: 8 }, (_, index) =>
        mediaDevice("videoinput", `camera-${index + 1}`, `Camera ${index + 1}`),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        mediaDevice(
          "audioinput",
          `microphone-${index + 1}`,
          `Microphone ${index + 1}`,
        ),
      ),
    ];
    await renderPanel();

    await act(async () => {
      openMenu(
        container.querySelector('[aria-label="preRecord.defaultCamera"]'),
      );
      await Promise.resolve();
    });
    const cameraMenu = document.body.querySelector('[role="menu"]');
    expect(cameraMenu?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(
      5,
    );
    expect(cameraMenu?.textContent).toContain("Camera 4");
    expect(cameraMenu?.textContent).not.toContain("Camera 8");
    expect(cameraMenu?.textContent).toContain("preRecord.moreCameras");
    expect(cameraMenu?.className).not.toContain("max-h");
    expect(cameraMenu?.className).not.toContain("overflow-y");

    await act(async () => {
      click(
        Array.from(
          cameraMenu?.querySelectorAll('[role="menuitem"]') ?? [],
        ).find((item) => item.textContent === "preRecord.moreCameras") ?? null,
      );
      await Promise.resolve();
    });
    const cameraDialog = document.body.querySelector('[role="dialog"]');
    const cameraRadios = Array.from(
      cameraDialog?.querySelectorAll('[role="radio"]') ?? [],
    );
    expect(cameraRadios).toHaveLength(9);
    expect(cameraDialog?.textContent).toContain("Camera 8");
    expect(cameraRadios[0]?.getAttribute("data-state")).toBe("checked");

    await act(async () => {
      click(
        cameraRadios.find((radio) =>
          radio.parentElement?.textContent?.includes("Camera 8"),
        ) ?? null,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });
    expect(container.querySelector('[aria-label="Camera 8"]')).not.toBeNull();

    await act(async () => {
      openMenu(
        container.querySelector('[aria-label="preRecord.defaultMicrophone"]'),
      );
      await Promise.resolve();
    });
    const microphoneMenu = document.body.querySelector('[role="menu"]');
    expect(
      microphoneMenu?.querySelectorAll('[role="menuitemradio"]'),
    ).toHaveLength(5);
    expect(microphoneMenu?.textContent).toContain("Microphone 4");
    expect(microphoneMenu?.textContent).not.toContain("Microphone 8");
    expect(microphoneMenu?.textContent).toContain("preRecord.moreMicrophones");
    expect(microphoneMenu?.className).not.toContain("max-h");
    expect(microphoneMenu?.className).not.toContain("overflow-y");

    await act(async () => {
      click(
        Array.from(
          microphoneMenu?.querySelectorAll('[role="menuitem"]') ?? [],
        ).find((item) => item.textContent === "preRecord.moreMicrophones") ??
          null,
      );
      await Promise.resolve();
    });
    const microphoneDialog = document.body.querySelector('[role="dialog"]');
    const microphoneRadios = Array.from(
      microphoneDialog?.querySelectorAll('[role="radio"]') ?? [],
    );
    expect(microphoneRadios).toHaveLength(9);
    expect(microphoneDialog?.textContent).toContain("Microphone 8");

    await act(async () => {
      click(
        microphoneRadios.find((radio) =>
          radio.parentElement?.textContent?.includes("Microphone 8"),
        ) ?? null,
      );
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });
    expect(
      container.querySelector('[aria-label="Microphone 8"]'),
    ).not.toBeNull();
  });

  it("keeps ordinary device menus complete without a More item", async () => {
    enumeratedDevices = [
      ...Array.from({ length: 4 }, (_, index) =>
        mediaDevice("videoinput", `camera-${index + 1}`, `Camera ${index + 1}`),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        mediaDevice(
          "audioinput",
          `microphone-${index + 1}`,
          `Microphone ${index + 1}`,
        ),
      ),
    ];
    await renderPanel();

    await act(async () => {
      openMenu(
        container.querySelector('[aria-label="preRecord.defaultCamera"]'),
      );
      await Promise.resolve();
    });
    const cameraMenu = document.body.querySelector('[role="menu"]');
    expect(cameraMenu?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(
      5,
    );
    expect(cameraMenu?.textContent).not.toContain("preRecord.moreCameras");

    await act(async () => {
      click(cameraMenu?.querySelector('[role="menuitemradio"]') ?? null);
      await Promise.resolve();
    });
    await act(async () => {
      openMenu(
        container.querySelector('[aria-label="preRecord.defaultMicrophone"]'),
      );
      await Promise.resolve();
    });
    const microphoneMenu = document.body.querySelector('[role="menu"]');
    expect(
      microphoneMenu?.querySelectorAll('[role="menuitemradio"]'),
    ).toHaveLength(5);
    expect(microphoneMenu?.textContent).not.toContain(
      "preRecord.moreMicrophones",
    );
  });

  it("uses a compact alert before starting without microphone audio", async () => {
    const onStart = await renderPanel();

    await act(async () => {
      click(
        container.querySelector(
          '[role="switch"][aria-label="preRecord.includeAudioAria"]',
        ),
      );
      await Promise.resolve();
    });
    await act(async () => {
      click(
        Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "preRecord.startRecording",
        ) ?? null,
      );
    });

    expect(onStart).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("preRecord.micOffConfirmTitle");
    const unmuteButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent === "preRecord.unmuteMicrophone");
    expect(unmuteButton?.className).toContain("bg-primary");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(unmuteButton);
    });

    await act(async () => {
      click(
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "preRecord.startWithoutMic",
        ) ?? null,
      );
    });

    expect(onStart).toHaveBeenCalledWith({
      mode: "screen+camera",
      displaySurface: "window",
      micDeviceId: "__clips_no_microphone__",
      micDeviceLabel: null,
      cameraDeviceId: null,
    });
  });

  it("keeps setup mounted behind the mic alert and restores focus to Start", async () => {
    await renderPanel();

    await act(async () => {
      click(
        container.querySelector(
          '[role="switch"][aria-label="preRecord.includeAudioAria"]',
        ),
      );
      await Promise.resolve();
    });
    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "preRecord.startRecording",
    );
    expect(startButton).toBeDefined();
    startButton?.focus();

    await act(async () => click(startButton ?? null));

    expect(container.contains(startButton ?? null)).toBe(true);
    expect(
      container.querySelector('[aria-label="preRecord.modeScreenCamera"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("preRecord.micOffConfirmTitle");

    await act(async () => {
      click(
        Array.from(document.body.querySelectorAll("button")).find(
          (button) => button.textContent === "preRecord.unmuteMicrophone",
        ) ?? null,
      );
    });

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(startButton);
    });
  });
});
