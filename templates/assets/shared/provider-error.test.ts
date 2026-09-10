import { describe, expect, it } from "vitest";

import {
  isModelUnavailableDetail,
  looksLikeMachinePayload,
  readableProviderErrorDetail,
} from "./provider-error.js";

// Captured verbatim from api.builder.io/agent-native/images/v1/generations
// while `gemini-3-pro-image-preview` was routed to a retired Vertex alias.
// The provider failure is a JSON string inside a JSON string inside the body.
const NESTED_VERTEX_404 = JSON.stringify({
  code: "provider_error",
  message: JSON.stringify({
    error: {
      message: JSON.stringify({
        error: {
          code: 404,
          message:
            "Publisher model `projects/example-project/locations/global/publishers/google/models/gemini-3-pro-image-preview` was not found or your project does not have access to it. Please ensure you are using the correct model name.",
          status: "NOT_FOUND",
        },
      }),
    },
  }),
});

describe("readableProviderErrorDetail", () => {
  it("unwraps a provider failure re-encoded as a JSON string at every hop", () => {
    expect(readableProviderErrorDetail(NESTED_VERTEX_404, 500)).toBe(
      "Publisher model `projects/example-project/locations/global/publishers/google/models/gemini-3-pro-image-preview` was not found or your project does not have access to it. Please ensure you are using the correct model name.",
    );
  });

  it("never returns the raw payload when no prose can be reached", () => {
    expect(readableProviderErrorDetail('{"code":"provider_error"}')).toBe("");
    expect(readableProviderErrorDetail('{"error":{"code":502}}')).toBe("");
    expect(readableProviderErrorDetail("<html><body>502</body></html>")).toBe(
      "<html><body>502</body></html>",
    );
  });

  it("returns nothing for a truncated payload that cannot be parsed", () => {
    expect(
      readableProviderErrorDetail('{"code":"provider_error","message":"{\\"er'),
    ).toBe("");
  });

  it("reads a plain nested message", () => {
    expect(
      readableProviderErrorDetail({ error: { message: "Rate limited" } }),
    ).toBe("Rate limited");
  });

  it("reads the first readable entry in a details array", () => {
    expect(
      readableProviderErrorDetail({
        error: { details: [{ message: "Quota exhausted" }] },
      }),
    ).toBe("Quota exhausted");
  });

  it("truncates long prose instead of dropping it", () => {
    const long = `${"a".repeat(400)}`;
    const detail = readableProviderErrorDetail({ message: long }, 300);
    expect(detail).toHaveLength(303);
    expect(detail.endsWith("...")).toBe(true);
  });

  it("returns nothing for an empty or missing payload", () => {
    expect(readableProviderErrorDetail("")).toBe("");
    expect(readableProviderErrorDetail(undefined)).toBe("");
    expect(readableProviderErrorDetail(null)).toBe("");
  });
});

describe("looksLikeMachinePayload", () => {
  it("flags serialized payloads", () => {
    expect(looksLikeMachinePayload('{"error":"boom"}')).toBe(true);
    expect(looksLikeMachinePayload('[{"error":"boom"}]')).toBe(true);
    expect(looksLikeMachinePayload('{\\"error\\": {')).toBe(true);
  });

  it("does not flag prose", () => {
    expect(looksLikeMachinePayload("Rate limited. Retry shortly.")).toBe(false);
    expect(looksLikeMachinePayload("")).toBe(false);
  });
});

describe("isModelUnavailableDetail", () => {
  it("recognises a provider rejecting the requested model", () => {
    expect(
      isModelUnavailableDetail(
        "Publisher model `projects/x/publishers/google/models/y` was not found or your project does not have access to it.",
      ),
    ).toBe(true);
    expect(
      isModelUnavailableDetail(
        'Unknown image model: model: Invalid option: expected one of "auto"',
      ),
    ).toBe(true);
  });

  it("leaves unrelated failures alone", () => {
    expect(isModelUnavailableDetail("Rate limited. Retry shortly.")).toBe(
      false,
    );
  });
});
