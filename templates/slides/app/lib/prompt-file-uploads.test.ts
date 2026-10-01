import { describe, expect, it } from "vitest";

import { isStorageSetupRequiredError } from "./image-drop-to-agent";
import {
  isPromptUploadNetworkError,
  isPromptUploadServiceUnavailableError,
  isPromptUploadStorageStatusError,
  promptUploadHttpError,
} from "./prompt-file-uploads";
import { promptImportResponseError } from "./upload-response";

const actionError = (
  message: string,
  extra: Record<string, unknown> = {},
): Error => Object.assign(new Error(message), extra);

const HTML_504 =
  "Action import-file failed: <!DOCTYPE html><html><head><title>504 Gateway Time-out</title>";

describe("import and upload failures the UI must not render raw", () => {
  it.each([
    ["a 504 gateway page", actionError(HTML_504, { status: 504 })],
    ["a gateway status with no usable body", actionError("x", { status: 502 })],
    ["a markup body behind a 500", actionError(HTML_504, { status: 500 })],
    [
      "markup that arrived with a success status",
      actionError(
        "Action import-file returned a non-JSON 200 response: <html><body>",
        { status: 200 },
      ),
    ],
    [
      "a typed upload_service_unavailable code",
      actionError("x", { code: "upload_service_unavailable" }),
    ],
    [
      "a typed upload_service_unavailable error code",
      actionError("x", { errorCode: "upload_service_unavailable" }),
    ],
    ["a client-side timeout", actionError("timed out", { timedOut: true })],
    [
      "a storage outage that resolves itself",
      actionError("File storage isn't responding", {
        status: 503,
        errorCode: "attachment_storage_unavailable",
        details: { whoCanFix: "self_resolving", retryable: true },
      }),
    ],
  ])("treats %s as a retryable service failure", (_name, error) => {
    expect(isPromptUploadServiceUnavailableError(error)).toBe(true);
    expect(isPromptUploadNetworkError(error)).toBe(true);
  });

  it.each([
    [
      "storage nobody has connected",
      actionError("No object storage is connected.", {
        status: 503,
        errorCode: "attachment_storage_unavailable",
        details: { whoCanFix: "workspace_admin", retryable: true },
      }),
    ],
    [
      "storage the deployment owner must fix",
      actionError("File storage is configured incorrectly.", {
        status: 503,
        errorCode: "attachment_storage_unavailable",
        details: { whoCanFix: "operator", retryable: true },
      }),
    ],
    [
      "an attachment that can never open",
      actionError("This uploaded file reference can't be decoded.", {
        status: 410,
        errorCode: "permanent_precondition",
        details: { attachmentErrorCode: "attachment_expired" },
      }),
    ],
    [
      "an ordinary server error",
      actionError("Action import-file failed: boom", { status: 500 }),
    ],
  ])("does not call %s a connection problem", (_name, error) => {
    expect(isPromptUploadNetworkError(error)).toBe(false);
  });

  it("recognizes storage that needs setup from the typed fixer, not the wording", () => {
    const notConnected = actionError(
      "Something the server worded differently",
      {
        status: 503,
        errorCode: "attachment_storage_unavailable",
        details: { whoCanFix: "workspace_admin" },
      },
    );

    expect(isStorageSetupRequiredError(notConnected)).toBe(true);
    expect(
      isStorageSetupRequiredError(
        actionError("x", {
          status: 503,
          errorCode: "attachment_storage_unavailable",
          details: { whoCanFix: "self_resolving" },
        }),
      ),
    ).toBe(false);
  });

  it("carries the typed code, status and details of a failed import response", () => {
    const unavailable = promptImportResponseError(
      504,
      { error: "Import failed", errorCode: "upload_service_unavailable" },
      "Import failed",
    );
    expect(isPromptUploadNetworkError(unavailable)).toBe(true);
    expect(unavailable).toMatchObject({ status: 504 });

    const stop = promptImportResponseError(
      410,
      {
        error: "This uploaded file has expired from file storage.",
        errorCode: "permanent_precondition",
        details: { attachmentErrorCode: "attachment_expired" },
      },
      "Import failed",
    );
    expect(stop.message).toBe(
      "This uploaded file has expired from file storage.",
    );
    expect(stop).toMatchObject({
      status: 410,
      errorCode: "permanent_precondition",
      details: { attachmentErrorCode: "attachment_expired" },
    });
    expect(isPromptUploadNetworkError(stop)).toBe(false);
  });

  it.each([408, 502, 504])(
    "types a %i from the upload endpoints as a retryable service failure",
    (status) => {
      const error = promptUploadHttpError(status, "deck.pdf");

      expect(error).toMatchObject({
        code: "upload_service_unavailable",
        status,
        fileName: "deck.pdf",
      });
      expect(isPromptUploadNetworkError(error)).toBe(true);
    },
  );

  it("keeps a 503 from the upload endpoints on the storage-status path", () => {
    const error = promptUploadHttpError(503, "deck.pdf");

    expect(error).toMatchObject({ code: "reference_storage_http_failed" });
    expect(isPromptUploadStorageStatusError(error)).toBe(true);
    expect(isPromptUploadNetworkError(error)).toBe(false);
  });
});
