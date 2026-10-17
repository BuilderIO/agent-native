// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { AlertDialog, AlertDialogContent } from "@/components/ui/alert-dialog";

import {
  buildRecordingErrorToastOptions,
  isStorageStatusUnavailable,
  localizedRecordingErrorMessage,
  openUrlFromUserGesture,
  recordingErrorToastRecoveryAction,
  RecorderRouteStatus,
  RecordingErrorCard,
  RecordingLeaveChoices,
  shouldAllowSkippingStorageSetup,
  shouldPersistFirstRunStorageSetupDismissal,
  shouldPreserveFirstRunStorageSetupIntent,
  shouldRedirectToStorageSetupHome,
  shouldShowFirstRunStorageSetup,
} from "./record";

function stubDocumentCapturePolicy(
  allowsFeature: (feature: string) => boolean,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    document,
    "permissionsPolicy",
  );
  Object.defineProperty(document, "permissionsPolicy", {
    configurable: true,
    value: { allowsFeature },
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(document, "permissionsPolicy", descriptor);
    } else {
      Reflect.deleteProperty(document, "permissionsPolicy");
    }
  };
}

describe("record route lifecycle shell", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses localized storage status copy instead of the response body", () => {
    const error = Object.assign(
      new Error('{"ok":false,"errorCode":"video_storage_status_unavailable"}'),
      { errorCode: "video_storage_status_unavailable" },
    );

    expect(
      localizedRecordingErrorMessage(error, "Localized storage status copy"),
    ).toBe("Localized storage status copy");
    expect(
      localizedRecordingErrorMessage(
        new Error("The upload failed."),
        "Localized storage status copy",
      ),
    ).toBe("The upload failed.");
  });

  it("does not redirect a queued upload when storage is already configured", () => {
    expect(
      shouldRedirectToStorageSetupHome({
        storageSetupRequested: true,
        storageConfigured: true,
        hasPendingUpload: true,
        uiState: "idle",
      }),
    ).toBe(false);
  });

  it.each(["pickingSources", "countdown", "recording"] as const)(
    "does not redirect while capture is %s",
    (uiState) => {
      expect(
        shouldRedirectToStorageSetupHome({
          storageSetupRequested: true,
          storageConfigured: true,
          hasPendingUpload: false,
          uiState,
        }),
      ).toBe(false);
    },
  );

  it("redirects a storage-only visit after storage is configured", () => {
    expect(
      shouldRedirectToStorageSetupHome({
        storageSetupRequested: true,
        storageConfigured: true,
        hasPendingUpload: false,
        uiState: "idle",
      }),
    ).toBe(true);
  });

  it("offers storage setup on the first unconfigured recorder visit", () => {
    expect(
      shouldShowFirstRunStorageSetup({
        storageConfigured: false,
        storageStatusUnavailable: false,
        dismissal: "not-dismissed",
        hasPendingUpload: false,
        isClipIntake: false,
        connectStorageRequested: false,
      }),
    ).toBe(true);
  });

  it("offers the first-run choice and Skip when storage status is unavailable", () => {
    const storageConfigured = null;
    const storageStatusUnavailable = isStorageStatusUnavailable({
      storageConfigured,
      readFailed: true,
    });
    const firstRunStorageSetup = shouldShowFirstRunStorageSetup({
      storageConfigured,
      storageStatusUnavailable,
      dismissal: "not-dismissed",
      hasPendingUpload: false,
      isClipIntake: false,
      connectStorageRequested: false,
    });

    expect(firstRunStorageSetup).toBe(true);
    expect(
      shouldAllowSkippingStorageSetup({
        firstRunStorageSetup,
        firstRunStorageSetupIntent: false,
        connectStorageRequested: false,
        hasPendingUpload: false,
        isClipIntake: false,
      }),
    ).toBe(true);
  });

  it("keeps cached configured storage out of first-run setup after a refetch error", () => {
    const storageConfigured = true;

    expect(
      isStorageStatusUnavailable({
        storageConfigured,
        readFailed: true,
      }),
    ).toBe(false);
    expect(
      shouldShowFirstRunStorageSetup({
        storageConfigured,
        storageStatusUnavailable: true,
        dismissal: "not-dismissed",
        hasPendingUpload: false,
        isClipIntake: false,
        connectStorageRequested: false,
      }),
    ).toBe(false);
  });

  it("preserves first-run setup intent while storage status refreshes", () => {
    const intent = shouldPreserveFirstRunStorageSetupIntent({
      firstRunStorageSetup: true,
      currentIntent: false,
      dismissal: "not-dismissed",
    });

    expect(intent).toBe(true);
    expect(
      shouldPreserveFirstRunStorageSetupIntent({
        firstRunStorageSetup: false,
        currentIntent: intent,
        dismissal: "not-dismissed",
      }),
    ).toBe(true);
    expect(
      shouldPreserveFirstRunStorageSetupIntent({
        firstRunStorageSetup: false,
        currentIntent: intent,
        dismissal: "dismissed",
      }),
    ).toBe(false);
  });

  it.each([
    {
      label: "the first-run prompt",
      input: {
        firstRunStorageSetup: true,
        firstRunStorageSetupIntent: false,
        connectStorageRequested: false,
      },
    },
    {
      label: "a storage setup link",
      input: {
        firstRunStorageSetup: false,
        firstRunStorageSetupIntent: false,
        connectStorageRequested: true,
      },
    },
  ])("persists a skipped storage choice for $label", ({ input }) => {
    expect(shouldPersistFirstRunStorageSetupDismissal(input)).toBe(true);
  });

  it("keeps Skip available and saves dismissal for latched setup intent", () => {
    const input = {
      firstRunStorageSetup: false,
      firstRunStorageSetupIntent: true,
      connectStorageRequested: false,
      hasPendingUpload: false,
      isClipIntake: false,
    };

    expect(shouldAllowSkippingStorageSetup(input)).toBe(true);
    expect(shouldPersistFirstRunStorageSetupDismissal(input)).toBe(true);
  });

  it.each([
    {
      storageConfigured: true,
      storageStatusUnavailable: false,
      dismissal: "not-dismissed",
      hasPendingUpload: false,
      isClipIntake: false,
      connectStorageRequested: false,
    },
    {
      storageConfigured: null,
      storageStatusUnavailable: false,
      dismissal: "not-dismissed",
      hasPendingUpload: false,
      isClipIntake: false,
      connectStorageRequested: false,
    },
    {
      storageConfigured: false,
      storageStatusUnavailable: false,
      dismissal: "dismissed",
      hasPendingUpload: false,
      isClipIntake: false,
      connectStorageRequested: false,
    },
    {
      storageConfigured: false,
      storageStatusUnavailable: false,
      dismissal: "not-dismissed",
      hasPendingUpload: true,
      isClipIntake: false,
      connectStorageRequested: false,
    },
    {
      storageConfigured: false,
      storageStatusUnavailable: false,
      dismissal: "not-dismissed",
      hasPendingUpload: false,
      isClipIntake: true,
      connectStorageRequested: false,
    },
    {
      storageConfigured: false,
      storageStatusUnavailable: false,
      dismissal: "not-dismissed",
      hasPendingUpload: false,
      isClipIntake: false,
      connectStorageRequested: true,
    },
  ] as const)("does not show the first-run prompt for $dismissal", (input) => {
    expect(shouldShowFirstRunStorageSetup(input)).toBe(false);
  });

  it("uses the shared classifier and sanitized body for dropped-file uploads", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );
    const uploadStart = source.indexOf("const uploadFile = useCallback");
    const uploadEnd = source.indexOf("const doStop = useCallback", uploadStart);
    const uploadFlow = source.slice(uploadStart, uploadEnd);

    expect(uploadStart).toBeGreaterThan(-1);
    expect(uploadEnd).toBeGreaterThan(uploadStart);
    expect(uploadFlow).toContain("classifyUploadResponseError");
    expect(uploadFlow).toContain("responseError.responseText");
    expect(uploadFlow).toContain("failureCode: responseError.failureCode");
    expect(uploadFlow).toContain("...uploadAbortMetadata(err)");
  });

  it.each([true, false])(
    "keeps the recording unless Leave and discard is chosen (canKeep=%s)",
    (canKeep) => {
      const onKeep = vi.fn();
      const onDiscard = vi.fn();
      const onDownload = vi.fn();
      act(() => {
        root.render(
          <AlertDialog open>
            <AlertDialogContent>
              <RecordingLeaveChoices
                canKeep={canKeep}
                onKeep={onKeep}
                onDiscard={onDiscard}
                onDownload={onDownload}
              />
            </AlertDialogContent>
          </AlertDialog>,
        );
      });
      const button = (label: string) =>
        Array.from(document.body.querySelectorAll("button")).find(
          (el) => el.textContent?.trim() === label,
        );

      expect(document.body.textContent).toContain(
        canKeep
          ? "recordRoute.leaveKeepDescription"
          : "recordRoute.leaveConfirmDescription",
      );
      if (canKeep) {
        act(() => button("recordRoute.leaveAndKeep")!.click());
        expect(onKeep).toHaveBeenCalledOnce();
      } else {
        expect(button("recordRoute.leaveAndKeep")).toBeUndefined();
        act(() => button("recordRoute.downloadCopy")!.click());
        expect(onDownload).toHaveBeenCalledOnce();
      }
      expect(onDiscard).not.toHaveBeenCalled();

      act(() => button("recordRoute.leaveAndDiscard")!.click());
      expect(onDiscard).toHaveBeenCalledOnce();
    },
  );

  it("announces real progress without including action controls", () => {
    act(() => {
      root.render(
        <RecorderRouteStatus busy progress={1.4} label="Saving recording">
          <button type="button">Discard recording</button>
        </RecorderRouteStatus>,
      );
    });

    const status = container.querySelector('[role="status"]');
    const progress = container.querySelector('[role="progressbar"]');
    const action = container.querySelector("button");

    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.contains(progress)).toBe(true);
    expect(status?.contains(action)).toBe(false);
    expect(status?.parentElement?.contains(action)).toBe(true);
    expect(progress?.getAttribute("aria-valuenow")).toBe("100");
    expect(progress?.querySelector("div")?.getAttribute("style")).toContain(
      "width: 100%",
    );
    expect(container.textContent).toContain("100%");
    expect(container.textContent).toContain("Discard recording");
  });

  it("keeps blocking recovery assertive while actions stay outside", () => {
    act(() => {
      root.render(
        <RecorderRouteStatus role="alert" label="Session expired">
          <button type="button">Log in</button>
        </RecorderRouteStatus>,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    const action = container.querySelector("button");
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(alert?.hasAttribute("aria-busy")).toBe(false);
    expect(alert?.contains(action)).toBe(false);
    expect(alert?.parentElement?.contains(action)).toBe(true);
  });

  it("keeps failed uploads recoverable without placing actions in the alert", () => {
    const onTryAgain = vi.fn();
    act(() => {
      root.render(
        <RecordingErrorCard
          error="Upload failed at chunk 2"
          mode="screen"
          micDeviceId={null}
          canRetryUpload
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={onTryAgain}
        />,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "recordRoute.retryUpload",
    );
    expect(alert?.getAttribute("aria-live")).toBe("assertive");
    expect(retry).toBeDefined();
    expect(alert?.contains(retry!)).toBe(false);

    act(() => retry?.click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("keeps camera permission failures in route recovery", () => {
    const onTryAgain = vi.fn();
    act(() => {
      root.render(
        <RecordingErrorCard
          error="Camera permission denied"
          mode="camera"
          micDeviceId={null}
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={onTryAgain}
        />,
      );
    });

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "recordRoute.tryAgain",
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(retry).toBeDefined();

    act(() => retry?.click());
    expect(onTryAgain).toHaveBeenCalledTimes(1);
  });

  it("keeps generic app-frame camera denials on device recovery", () => {
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );
    const openedWindow = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(openedWindow);

    act(() => {
      root.render(
        <RecordingErrorCard
          error="Camera access is blocked by the browser, macOS, or this app frame."
          mode="camera"
          micDeviceId={null}
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Clips could not start the camera. Allow camera access, then try again.",
    );
    expect(container.textContent).toContain(
      "Allow Camera for this site first.",
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const cameraSettings = buttons.find(
      (button) => button.textContent?.trim() === "Camera",
    );
    expect(cameraSettings).toBeDefined();
    expect(
      buttons.some(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      ),
    ).toBe(false);

    act(() => cameraSettings?.click());
    expect(open).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
      "_blank",
    );
    expect(openedWindow.opener).toBeNull();
    open.mockRestore();
  });

  it("reserves the tab recovery path for explicit Permissions-Policy errors", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );

    act(() => {
      root.render(
        <RecordingErrorCard
          error="Camera access is blocked by Permissions-Policy."
          mode="camera"
          micDeviceId={null}
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "This recorder is embedded somewhere that blocks capture permissions.",
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.some(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      ),
    ).toBe(true);
    expect(
      buttons.some((button) => button.textContent?.trim() === "Camera"),
    ).toBe(false);
  });

  it("does not reopen a top-level Permissions-Policy denial in the same tab", () => {
    const error = "Screen capture is blocked by Permissions-Policy.";
    const options = buildRecordingErrorToastOptions(
      error,
      { mode: "screen", micDeviceId: null },
      (key) => key,
      vi.fn(() => true),
      vi.fn(),
    );

    expect(
      recordingErrorToastRecoveryAction(error, "screen", "/record?mode=screen"),
    ).toBeNull();
    expect(options.action).toBeUndefined();
    expect(options.description).toBe(
      "Something blocked the recorder before it could start.",
    );

    act(() => {
      root.render(
        <RecordingErrorCard
          error={error}
          mode="screen"
          micDeviceId={null}
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Something blocked the recorder before it could start.",
    );
    expect(container.textContent).not.toContain("Open Clips directly");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      ),
    ).toBe(false);
  });

  it("offers tab recovery for embedded camera denials when policy state is unknown", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );

    act(() => {
      root.render(
        <RecordingErrorCard
          error="Camera access is blocked by the browser, macOS, or this app frame."
          mode="camera"
          micDeviceId={null}
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={vi.fn()}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.some(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      ),
    ).toBe(true);
    expect(container.textContent).not.toContain(
      "Allow Camera for this site first.",
    );
    expect(
      buttons.some((button) => button.textContent?.trim() === "Camera"),
    ).toBe(false);
  });

  it("keeps embedded camera denials on device recovery when policy allows capture", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const restorePolicy = stubDocumentCapturePolicy(() => true);

    try {
      act(() => {
        root.render(
          <RecordingErrorCard
            error="Camera access is blocked by the browser, macOS, or this app frame."
            mode="camera"
            micDeviceId={null}
            canRetryUpload={false}
            canDownloadRecording={false}
            onDownloadRecording={vi.fn()}
            onTryAgain={vi.fn()}
          />,
        );
      });

      const buttons = Array.from(container.querySelectorAll("button"));
      expect(
        buttons.some(
          (button) => button.textContent === "recordRoute.openRecorderInTab",
        ),
      ).toBe(false);
      expect(container.textContent).toContain(
        "Open this site's browser settings, allow Camera, then reload Clips.",
      );
    } finally {
      restorePolicy();
    }
  });

  it("offers embedded tab recovery when capture policy inspection throws", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const restorePolicy = stubDocumentCapturePolicy(() => {
      throw new Error("Policy inspection is unavailable.");
    });

    try {
      act(() => {
        root.render(
          <RecordingErrorCard
            error="Camera access is blocked by the browser, macOS, or this app frame."
            mode="camera"
            micDeviceId={null}
            canRetryUpload={false}
            canDownloadRecording={false}
            onDownloadRecording={vi.fn()}
            onTryAgain={vi.fn()}
          />,
        );
      });

      const buttons = Array.from(container.querySelectorAll("button"));
      expect(
        buttons.some(
          (button) => button.textContent === "recordRoute.openRecorderInTab",
        ),
      ).toBe(true);
      expect(container.textContent).not.toContain(
        "Allow Camera for this site first.",
      );
    } finally {
      restorePolicy();
    }
  });

  it("uses tab recovery for embedded unknown-policy toast actions", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const directUrl = "https://clips.test/record?mode=camera";

    expect(
      recordingErrorToastRecoveryAction(
        "Camera access is blocked by the browser, macOS, or this app frame.",
        "camera",
        directUrl,
      ),
    ).toEqual({
      labelKey: "recordRoute.openRecorderInTab",
      url: directUrl,
    });
  });

  it("uses tab recovery for explicit policy toast actions", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const directUrl = "https://clips.test/record?mode=screen";

    expect(
      recordingErrorToastRecoveryAction(
        "Screen capture blocked by Permissions-Policy.",
        "screen",
        directUrl,
      ),
    ).toEqual({
      labelKey: "recordRoute.openRecorderInTab",
      url: directUrl,
    });
  });

  it("uses tab recovery for embedded screen-capture toast actions", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const directUrl = "https://clips.test/record?mode=screen";

    expect(
      recordingErrorToastRecoveryAction(
        "Screen capture is blocked by this app frame.",
        "screen",
        directUrl,
      ),
    ).toEqual({
      labelKey: "recordRoute.openRecorderInTab",
      url: directUrl,
    });
  });

  it("keeps app-frame screen toast guidance out of macOS settings", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );
    const options = buildRecordingErrorToastOptions(
      "Screen capture is blocked by this app frame.",
      { mode: "screen", micDeviceId: null },
      (key) => key,
      vi.fn(() => true),
      vi.fn(),
    );

    expect(options.action?.label).toBe("recordRoute.openRecorderInTab");
    expect(options.description).toContain(
      "The web client is running Clips inside a frame.",
    );
    expect(options.description).not.toContain("System Settings");
  });

  it("keeps generic embedded screen denial away from macOS settings", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );
    const openRecoveryUrl = vi.fn(() => true);
    const options = buildRecordingErrorToastOptions(
      "Screen capture is blocked by the browser.",
      { mode: "screen+camera", micDeviceId: "default" },
      (key) => key,
      openRecoveryUrl,
      vi.fn(),
    );

    expect(options.action?.label).toBe("recordRoute.openRecorderInTab");
    expect(options.description).toContain(
      "The web client is running Clips inside a frame.",
    );
    expect(options.description).not.toContain("System Settings");

    act(() => {
      root.render(
        <RecordingErrorCard
          error="Screen capture is blocked by the browser."
          mode="screen+camera"
          micDeviceId="default"
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={vi.fn()}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.some(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      ),
    ).toBe(true);
    expect(
      buttons.some((button) =>
        ["Screen", "Camera", "Mic"].includes(button.textContent?.trim() ?? ""),
      ),
    ).toBe(false);
  });

  it("wires toast tab recovery to the selected recorder URL", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const originalUrl = window.location.href;
    try {
      window.history.replaceState({}, "", "/record?spaceId=space-1");
      const expectedUrl = new URL(window.location.href);
      expectedUrl.searchParams.set("mode", "screen");
      expectedUrl.searchParams.set("surface", "window");
      const openRecoveryUrl = vi.fn(() => true);
      const onPopupBlocked = vi.fn();
      const options = buildRecordingErrorToastOptions(
        "Screen capture blocked by Permissions-Policy.",
        { mode: "screen", displaySurface: "window", micDeviceId: null },
        (key) => key,
        openRecoveryUrl,
        onPopupBlocked,
      );

      expect(options.action?.label).toBe("recordRoute.openRecorderInTab");
      options.action?.onClick();
      expect(openRecoveryUrl).toHaveBeenCalledWith(
        expectedUrl.toString(),
        false,
      );
      expect(onPopupBlocked).not.toHaveBeenCalled();
    } finally {
      window.history.replaceState({}, "", originalUrl);
    }
  });

  it("preserves the failed mode and surface in card tab recovery", () => {
    const originalUrl = window.location.href;
    const openedWindow = { opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(openedWindow);
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);

    try {
      window.history.replaceState({}, "", "/record?spaceId=space-1");
      act(() => {
        root.render(
          <RecordingErrorCard
            error="Screen capture is blocked by this app frame."
            mode="screen"
            displaySurface="window"
            micDeviceId={null}
            canRetryUpload={false}
            canDownloadRecording={false}
            onDownloadRecording={vi.fn()}
            onTryAgain={vi.fn()}
          />,
        );
      });

      const openInTab = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      );
      act(() => openInTab?.click());

      const openedUrl = new URL(String(open.mock.calls[0]?.[0]));
      expect(open.mock.calls[0]?.[1]).toBe("_blank");
      expect(openedWindow.opener).toBeNull();
      expect(openedUrl.searchParams.get("mode")).toBe("screen");
      expect(openedUrl.searchParams.get("surface")).toBe("window");
      expect(openedUrl.searchParams.get("spaceId")).toBe("space-1");
    } finally {
      window.history.replaceState({}, "", originalUrl);
    }
  });

  it("keeps app-frame screen denials away from macOS guidance and settings", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );

    act(() => {
      root.render(
        <RecordingErrorCard
          error="Screen capture is blocked by this app frame."
          mode="screen+camera"
          micDeviceId="default"
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "This recorder is embedded somewhere that blocks capture permissions.",
    );
    expect(container.textContent).toContain(
      "The web client is running Clips inside a frame.",
    );
    expect(container.textContent).not.toContain("System Settings");
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.some(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      ),
    ).toBe(true);
    expect(
      buttons.some((button) =>
        ["Screen", "Camera", "Mic"].includes(button.textContent?.trim() ?? ""),
      ),
    ).toBe(false);
  });

  it("keeps macOS settings for top-level generic screen denials", () => {
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );
    const error =
      "Screen recording is blocked by the browser, macOS, or this app frame.";
    const options = buildRecordingErrorToastOptions(
      error,
      { mode: "screen", micDeviceId: null },
      (key) => key,
      vi.fn(() => true),
      vi.fn(),
    );

    expect(options.action?.label).toBe("recordRoute.openSettings");
    expect(options.description).toContain(
      "System Settings > Privacy & Security",
    );

    act(() => {
      root.render(
        <RecordingErrorCard
          error={error}
          mode="screen"
          micDeviceId={null}
          canRetryUpload={false}
          canDownloadRecording={false}
          onDownloadRecording={vi.fn()}
          onTryAgain={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "macOS is blocking screen recording",
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.some((button) => button.textContent?.trim() === "Screen"),
    ).toBe(true);
    expect(
      buttons.some(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      ),
    ).toBe(false);
  });

  it("keeps the embedded error route in place when tab recovery is blocked", () => {
    const originalUrl = window.location.href;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const popupToast = vi.spyOn(toast, "error");
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);

    try {
      window.history.replaceState({}, "", "/record?mode=screen");
      const errorUrl = window.location.href;
      act(() => {
        root.render(
          <RecordingErrorCard
            error="Screen capture is blocked by this app frame."
            mode="screen"
            micDeviceId={null}
            canRetryUpload={false}
            canDownloadRecording={false}
            onDownloadRecording={vi.fn()}
            onTryAgain={vi.fn()}
          />,
        );
      });

      const openInTab = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "recordRoute.openRecorderInTab",
      );
      act(() => openInTab?.click());

      expect(open).toHaveBeenCalledWith(
        expect.stringContaining("mode=screen"),
        "_blank",
      );
      expect(window.location.href).toBe(errorUrl);
      expect(popupToast).toHaveBeenCalledWith("clipsSettings.popupBlocked");
    } finally {
      window.history.replaceState({}, "", originalUrl);
    }
  });

  it("reports a blocked popup from a toast tab action", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const originalUrl = window.location.href;
    const onPopupBlocked = vi.fn();
    const openRecoveryUrl = vi.fn(() => false);

    try {
      window.history.replaceState({}, "", "/record?spaceId=space-1");
      const options = buildRecordingErrorToastOptions(
        "Screen capture blocked by Permissions-Policy.",
        { mode: "screen", displaySurface: "window", micDeviceId: null },
        (key) => key,
        openRecoveryUrl,
        onPopupBlocked,
      );

      options.action?.onClick();

      expect(openRecoveryUrl).toHaveBeenCalledWith(
        expect.stringContaining("mode=screen"),
        false,
      );
      expect(onPopupBlocked).toHaveBeenCalledTimes(1);
    } finally {
      window.history.replaceState({}, "", originalUrl);
    }
  });

  it("requests current-frame fallback when a settings toast popup is blocked", () => {
    vi.stubGlobal(
      "navigator",
      new Proxy(navigator, {
        get(target, property) {
          return property === "platform"
            ? "MacIntel"
            : Reflect.get(target, property, target);
        },
      }),
    );
    const openRecoveryUrl = vi.fn(() => false);
    const onPopupBlocked = vi.fn();
    const options = buildRecordingErrorToastOptions(
      "Camera permission denied.",
      { mode: "camera", micDeviceId: null },
      (key) => key,
      openRecoveryUrl,
      onPopupBlocked,
    );

    expect(options.action?.label).toBe("recordRoute.openSettings");
    options.action?.onClick();

    expect(openRecoveryUrl).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
      true,
    );
    expect(onPopupBlocked).not.toHaveBeenCalled();
  });

  it("navigates the current frame when a settings popup is blocked", () => {
    const originalUrl = window.location.href;
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    try {
      window.history.replaceState({}, "", "/record");
      const settingsUrl = new URL("/settings", window.location.href).toString();

      expect(openUrlFromUserGesture(settingsUrl)).toBe(false);
      expect(open).toHaveBeenCalledWith(settingsUrl, "_blank");
      expect(window.location.href).toBe(settingsUrl);
    } finally {
      window.history.replaceState({}, "", originalUrl);
    }
  });

  it("keeps the setup centered with a quiet desktop CTA and semantic colors", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );
    const tokens = readFileSync(
      resolve(process.cwd(), "app/global.css"),
      "utf8",
    );
    const callout = source.slice(
      source.indexOf("function DesktopRecorderCallout"),
      source.indexOf("export function RecorderRouteStatus"),
    );

    expect(source).toContain("min-h-[100dvh]");
    expect(source).toContain("max-w-[420px]");
    expect(source).toContain(
      'className="mx-auto grid w-full max-w-[420px] gap-2"',
    );
    expect(callout).toContain('variant="ghost"');
    expect(callout).toContain("pt-3");
    expect(callout).toContain("CaptureInstallMenu");
    expect(callout).toContain("text-sm font-medium");
    expect(source).not.toContain("xl:grid-cols-[288px_320px_288px]");
    expect(source).not.toContain("xl:absolute");
    expect(source).not.toMatch(
      /\b(?:bg-black|text-white|from-zinc|to-black)\b/,
    );
    expect(source).not.toContain("transition-all");
    expect(tokens).toContain("--recorder-mode-option-radius: 1.125rem");
    expect(tokens).toContain("--recorder-mode-toggle-inset: 0.3125rem");
    expect(tokens).toContain(
      "var(--recorder-mode-option-radius) + var(--recorder-mode-toggle-inset)",
    );
  });

  it("keeps upload handoff outside the recorder panel", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );

    expect(source).toContain("takePendingUploadFile");
    expect(source).toContain("if (file) void uploadFile(file)");
    expect(source).not.toContain('params.get("autoUpload") === "1"');
    expect(source).not.toContain("autoUploadInputRef");
    expect(source).not.toContain("data-auto-upload-bridge");
    expect(source).not.toContain("onUpload={uploadFile}");
    expect(source).not.toContain("importLoomHref=");
    expect(source).not.toContain("autoOpenUpload=");
  });

  it("clears the saving toolbar state before showing the saved recording", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );
    const start = source.indexOf("const finishSavedRecording");
    const end = source.indexOf("const doStop = useCallback", start);
    const finish = source.slice(start, end);

    expect(finish.indexOf("setSavingKind(null);")).toBeGreaterThanOrEqual(0);
    expect(finish.indexOf("setSavingKind(null);")).toBeLessThan(
      finish.indexOf('setUiState("complete");'),
    );
  });

  it("keeps the browser route free of server-only app-state imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/routes/record.tsx"),
      "utf8",
    );

    expect(source).not.toContain('from "@agent-native/core/application-state"');
    expect(source).toContain("async function writeAppState");
    expect(source).toContain("/_agent-native/application-state/");
  });
});
