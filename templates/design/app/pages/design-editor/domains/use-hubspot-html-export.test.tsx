// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushCommitsAfterPaint } from "../commit-after-paint";
import type { DesignFile } from "../types";
import { HubspotEmailConversionDialog } from "../view/hubspot-email-conversion-dialog";
import { useHubspotHtmlExport } from "./use-hubspot-html-export";

const { callAction, sendToDesignAgentChat, toast } = vi.hoisted(() => ({
  callAction: vi.fn(),
  sendToDesignAgentChat: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  actionErrorCode: (error: { errorCode?: string }) => error?.errorCode,
  actionErrorMessage: (error: { actionMessage?: string }) =>
    error?.actionMessage,
}));
vi.mock("@/lib/agent-chat", () => ({ sendToDesignAgentChat }));
vi.mock("sonner", () => ({ toast }));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const file: DesignFile = {
  id: "ordinary-frame",
  filename: "Welcome.html",
  fileType: "html",
  content: "<html><body>Ordinary web frame</body></html>",
  createdAt: null,
  updatedAt: "2026-10-22",
};
let controller: ReturnType<typeof useHubspotHtmlExport>;
let root: Root;
let host: HTMLDivElement;
let currentProps: Parameters<typeof useHubspotHtmlExport>[0];

function Harness() {
  controller = useHubspotHtmlExport(currentProps);
  return createElement(HubspotEmailConversionDialog, {
    conversion: controller.hubspotEmailConversion,
    onClose: controller.closeHubspotEmailConversion,
    onConvert: controller.handleConvertHubspotEmailWithAgent,
    t: currentProps.t,
  });
}

async function render() {
  await act(async () => root.render(createElement(Harness)));
}

beforeEach(async () => {
  vi.clearAllMocks();
  flushCommitsAfterPaint();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  currentProps = {
    designId: "design-a",
    selectedFile: file,
    getScreenContent: () => file.content,
    flushPendingFileContentSaves: vi.fn().mockResolvedValue(undefined),
    triggerBlobDownload: vi.fn(),
    t: (key, options) =>
      key === "designEditor.hubspotConversion.description"
        ? `${options?.name}: original preserved`
        : key,
  };
  callAction.mockRejectedValue({
    errorCode: "invalid_hubspot_email",
    actionMessage: "CSS grid is not supported in email.",
  });
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("HubSpot export and agent conversion", () => {
  it("offers conversion for ordinary HTML and keeps the clicked source when selection changes", async () => {
    expect(controller.canExportHubspotHtml).toBe(true);
    await act(async () => controller.handleDownloadHubspotHtml());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "CSS grid is not supported in email.",
    );
    expect(document.body.textContent).toContain(
      "Welcome.html: original preserved",
    );
    currentProps = {
      ...currentProps,
      selectedFile: { ...file, id: "another-frame", filename: "Other.html" },
    };
    await render();
    const convert = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent === "designEditor.hubspotConversion.convert",
    )!;
    await act(async () => {
      convert.click();
      convert.click();
    });
    expect(sendToDesignAgentChat).toHaveBeenCalledTimes(1);
    const request = sendToDesignAgentChat.mock.calls[0]![0];
    expect(request).toMatchObject({
      message: "designEditor.hubspotConversion.prompt",
      mode: "act",
      submit: true,
      openSidebar: true,
    });
    expect(JSON.parse(request.context)).toEqual({
      designId: "design-a",
      fileId: "ordinary-frame",
      title: "Welcome.html",
      exportAttemptVersionHash:
        callAction.mock.calls[0]![1].expectedVersionHash,
      validationIssue: "CSS grid is not supported in email.",
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(currentProps.triggerBlobDownload).not.toHaveBeenCalled();
  });

  it("cancels without submitting an agent turn", async () => {
    await act(async () => controller.handleDownloadHubspotHtml());
    const cancel = [...document.querySelectorAll("button")].find(
      (button) =>
        button.textContent === "designEditor.hubspotConversion.cancel",
    )!;
    await act(async () => cancel.click());
    expect(sendToDesignAgentChat).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not open a stale offer after navigating to another design", async () => {
    let rejectExport!: (error: unknown) => void;
    callAction.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectExport = reject;
        }),
    );
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = controller.handleDownloadHubspotHtml();
    });
    currentProps = { ...currentProps, designId: "design-b" };
    await render();
    await act(async () => {
      rejectExport({
        errorCode: "invalid_hubspot_email",
        actionMessage: "Missing footer",
      });
      await pending;
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    controller.handleConvertHubspotEmailWithAgent();
    expect(sendToDesignAgentChat).not.toHaveBeenCalled();
  });

  it.each([undefined, { ...file, fileType: "tsx" }])(
    "does not export a missing or non-HTML selection",
    async (selectedFile) => {
      currentProps = { ...currentProps, selectedFile };
      await render();
      expect(controller.canExportHubspotHtml).toBe(false);
      await act(async () => controller.handleDownloadHubspotHtml());
      expect(callAction).not.toHaveBeenCalled();
    },
  );
});
