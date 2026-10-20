// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

import { uploadNativePngAttachment } from "./native-png-attachment-client";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("uploads only the claimed PNG to the scoped attachment route", async () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], {
    type: "image/png",
  });
  const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
    const form = options.body as FormData;
    expect(form.get("designId")).toBe("design");
    expect(form.get("requestId")).toBe("request");
    expect(form.get("documentId")).toBe("document");
    expect(form.get("tabId")).toBe("tab");
    expect((form.get("file") as File).type).toBe("image/png");
    return {
      ok: true,
      json: async () => ({ attachmentRef: "owned-ref", bytes: png.size }),
    } as Response;
  });
  globalThis.fetch = fetchMock as typeof fetch;

  const result = await uploadNativePngAttachment({
    designId: "design",
    requestId: "request",
    documentId: "document",
    tabId: "tab",
    png,
    signal: new AbortController().signal,
  });

  expect(result).toEqual({ attachmentRef: "owned-ref", bytes: png.size });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/native-png-attachment",
    expect.objectContaining({ method: "POST", credentials: "same-origin" }),
  );
});
