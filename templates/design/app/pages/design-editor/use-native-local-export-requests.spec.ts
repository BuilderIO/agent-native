import type { NativeLocalExportState } from "@shared/native-local-export";
import { describe, expect, it, vi } from "vitest";

import {
  executeNativeLocalExportRequest,
  NativeLocalExportClientError,
  NativeLocalExportReportError,
  observeNativeLocalExportCancellation,
} from "./use-native-local-export-requests";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000010";

const noObserver = () => () => {};

const request: NativeLocalExportState = {
  designId: "design-1",
  fileId: "screen-1",
  expectedVersionHash: "v1",
  export: {
    format: "png",
    viewport: { width: 640, height: 480 },
    pixelRatio: 1,
  },
  schemaVersion: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  tabId: "tab-1",
  status: "pending",
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
};
const claimed: NativeLocalExportState = {
  ...request,
  status: "running",
  ownerDocumentId: DOCUMENT_ID,
  expiresAt: Date.now() + 60_000,
};

describe("native local export foreground handoff", () => {
  it("claims before capture and reports only after the local download trigger", async () => {
    const events: string[] = [];
    await executeNativeLocalExportRequest({
      documentId: DOCUMENT_ID,
      request,
      designId: "design-1",
      tabId: "tab-1",
      signal: new AbortController().signal,
      observeCancellation: noObserver,
      onExport: async () => {
        events.push("download-triggered");
      },
      invoke: vi.fn(async (name, input) => {
        events.push(
          name === "finish-native-local-export"
            ? `finish-${(input.result as { status: string }).status}`
            : "claim",
        );
        if (name === "claim-native-local-export") return claimed;
      }),
    });
    expect(events).toEqual([
      "claim",
      "download-triggered",
      "finish-download-initiated",
    ]);
  });

  it("records a typed capture failure without claiming a download", async () => {
    const calls: string[] = [];
    const error = new NativeLocalExportClientError(
      "source-stale",
      "Source changed after claim.",
    );
    await expect(
      executeNativeLocalExportRequest({
        documentId: DOCUMENT_ID,
        request,
        designId: "design-1",
        tabId: "tab-1",
        signal: new AbortController().signal,
        observeCancellation: noObserver,
        onExport: async () => {
          throw error;
        },
        invoke: async (name, input) => {
          calls.push(
            name === "finish-native-local-export"
              ? `finish-${(input.result as { code: string }).code}`
              : "claim",
          );
          if (name === "claim-native-local-export") return claimed;
        },
      }),
    ).rejects.toBe(error);
    expect(calls).toEqual(["claim", "finish-source-stale"]);
  });

  it("keeps both capture and reporting failures observable", async () => {
    const captureError = new Error("Capture failed");
    const reportError = new Error("Status action failed");
    await expect(
      executeNativeLocalExportRequest({
        documentId: DOCUMENT_ID,
        request,
        designId: "design-1",
        tabId: "tab-1",
        signal: new AbortController().signal,
        observeCancellation: noObserver,
        onExport: async () => {
          throw captureError;
        },
        invoke: async (name) => {
          if (name === "claim-native-local-export") return claimed;
          if (name === "finish-native-local-export") throw reportError;
        },
      }),
    ).rejects.toMatchObject({
      name: NativeLocalExportReportError.name,
      exportError: captureError,
      reportError,
    });
  });

  it("does not turn a downloaded file into a failure when reporting success fails", async () => {
    const reportError = new Error("Status action failed");
    const invoke = vi.fn(async (name: string) => {
      if (name === "claim-native-local-export") return claimed;
      throw reportError;
    });
    await expect(
      executeNativeLocalExportRequest({
        documentId: DOCUMENT_ID,
        request,
        designId: "design-1",
        tabId: "tab-1",
        signal: new AbortController().signal,
        observeCancellation: noObserver,
        onExport: async () => {},
        invoke,
      }),
    ).rejects.toBe(reportError);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith(
      "finish-native-local-export",
      expect.objectContaining({
        result: { status: "download-initiated" },
      }),
    );
  });

  it("uses the authoritative claimed version and accepts a late abort after download", async () => {
    const controller = new AbortController();
    const onExport = vi.fn(async (value: NativeLocalExportState) => {
      expect(value.expectedVersionHash).toBe("v2");
      controller.abort();
    });
    const invoke = vi.fn(async (name: string) =>
      name === "claim-native-local-export"
        ? { ...claimed, expectedVersionHash: "v2" }
        : undefined,
    );
    await executeNativeLocalExportRequest({
      documentId: DOCUMENT_ID,
      request,
      designId: "design-1",
      tabId: "tab-1",
      signal: controller.signal,
      observeCancellation: noObserver,
      onExport,
      invoke,
    });
    expect(onExport).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenLastCalledWith(
      "finish-native-local-export",
      expect.objectContaining({ result: { status: "download-initiated" } }),
    );
  });

  it("observes cancellation while capture is busy and reports a canceled acknowledgment", async () => {
    let state: NativeLocalExportState = claimed;
    const invoke = vi.fn(
      async (name: string, input: Record<string, unknown>) => {
        if (name === "claim-native-local-export") return claimed;
        expect(input.result).toMatchObject({
          status: "failed",
          code: "canceled",
        });
      },
    );
    await expect(
      executeNativeLocalExportRequest({
        documentId: DOCUMENT_ID,
        request,
        designId: "design-1",
        tabId: "tab-1",
        signal: new AbortController().signal,
        onExport: async (_claimed, signal) => {
          state = { ...claimed, status: "cancel-requested" };
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else
              signal.addEventListener("abort", () => resolve(), { once: true });
          });
          throw new NativeLocalExportClientError(
            "canceled",
            "Canceled before download.",
          );
        },
        invoke,
        observeCancellation: (value, onCancel, onFailure) =>
          observeNativeLocalExportCancellation({
            request: value,
            readState: async () => state,
            onCancel,
            onFailure,
            intervalMs: 5,
          }),
      }),
    ).rejects.toMatchObject({ code: "canceled" });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("reports an unreadable cancel channel as client unavailable, not user cancellation", async () => {
    const unreadable = new Error("Application state could not be read");
    const invoke = vi.fn(
      async (name: string, input: Record<string, unknown>) => {
        if (name === "claim-native-local-export") return claimed;
        expect(input.result).toMatchObject({
          status: "failed",
          code: "client-unavailable",
        });
      },
    );
    await expect(
      executeNativeLocalExportRequest({
        documentId: DOCUMENT_ID,
        request,
        designId: "design-1",
        tabId: "tab-1",
        signal: new AbortController().signal,
        onExport: async (_claimed, signal) => {
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else
              signal.addEventListener("abort", () => resolve(), { once: true });
          });
          throw new Error("Capture aborted");
        },
        invoke,
        observeCancellation: (value, onCancel, onFailure) =>
          observeNativeLocalExportCancellation({
            request: value,
            readState: async () => {
              throw unreadable;
            },
            onCancel,
            onFailure,
            intervalMs: 5,
          }),
      }),
    ).rejects.toBe(unreadable);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
