import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_FIG_FILE_BYTES as SERVER_MAX_FIG_FILE_BYTES } from "../../server/lib/fig-file-limits";
import { MAX_UPLOAD_BYTES as SERVER_MAX_UPLOAD_BYTES } from "../../server/lib/request-body-limits";
import {
  MAX_FIG_UPLOAD_BYTES,
  uploadDesignFile,
  validateFigUploadFile,
} from "./design-file-upload";
import { MAX_UPLOAD_BYTES } from "./upload-limits";

class FakeEventTarget {
  listeners = new Map<string, Array<(event: ProgressEvent) => void>>();

  addEventListener(type: string, listener: (event: ProgressEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event = {} as ProgressEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class FakeXMLHttpRequest extends FakeEventTarget {
  static latest: FakeXMLHttpRequest | null = null;

  upload = new FakeEventTarget();
  status = 0;
  responseText = "";
  timeout = 0;
  withCredentials = false;
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null = null;

  constructor() {
    super();
    FakeXMLHttpRequest.latest = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXMLHttpRequest.latest = null;
});

describe("uploadDesignFile", () => {
  it("posts an authenticated multipart upload and reports bounded progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const onProgress = vi.fn();
    const upload = uploadDesignFile({
      designId: "design id/1",
      file: new File(["fig"], "checkout.fig"),
      fallbackErrorMessage: "Upload failed",
      onProgress,
    });

    const xhr = FakeXMLHttpRequest.latest!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/import-design-file?designId=design%20id%2F1");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.timeout).toBe(300_000);
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get("designId")).toBe("design id/1");
    expect((xhr.body as FormData).get("file")).toBeInstanceOf(File);

    xhr.upload.dispatch("progress", {
      lengthComputable: true,
      loaded: 75,
      total: 50,
    } as ProgressEvent);
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 75,
      total: 50,
      percent: 100,
    });

    xhr.status = 200;
    xhr.responseText = JSON.stringify({
      designId: "design id/1",
      files: [{ id: "screen-1", filename: "Checkout.html" }],
    });
    xhr.dispatch("load");

    await expect(upload).resolves.toMatchObject({
      files: [{ id: "screen-1", filename: "Checkout.html" }],
    });
  });

  it("returns the route's structured error without hiding it", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const upload = uploadDesignFile({
      designId: "design-1",
      file: new File(["fig"], "unsupported.fig"),
      fallbackErrorMessage: "Upload failed",
    });
    const xhr = FakeXMLHttpRequest.latest!;
    xhr.status = 400;
    xhr.responseText = JSON.stringify({ error: "Unsupported .fig variant." });
    xhr.dispatch("load");

    await expect(upload).resolves.toEqual({
      error: "Unsupported .fig variant.",
    });
  });

  it("surfaces a localized fallback for transport failures", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const upload = uploadDesignFile({
      designId: "design-1",
      file: new File(["fig"], "sample.fig"),
      fallbackErrorMessage: "Localized upload failure",
    });
    FakeXMLHttpRequest.latest!.dispatch("error");

    await expect(upload).rejects.toThrow("Localized upload failure");
  });

  it("keeps the browser limit aligned with the server decoder cap", () => {
    expect(MAX_UPLOAD_BYTES).toBe(SERVER_MAX_UPLOAD_BYTES);
    expect(MAX_FIG_UPLOAD_BYTES).toBe(SERVER_MAX_FIG_FILE_BYTES);
    // A real Figma export is routinely well past the single-request wire cap;
    // the chunked transport is what makes this the browser-side limit.
    expect(MAX_FIG_UPLOAD_BYTES).toBeGreaterThan(SERVER_MAX_UPLOAD_BYTES);
    expect(
      validateFigUploadFile({ name: "sample.FIG", size: MAX_FIG_UPLOAD_BYTES }),
    ).toBeNull();
    expect(validateFigUploadFile({ name: "sample.zip", size: 10 })).toBe(
      "invalid-extension",
    );
    expect(
      validateFigUploadFile({
        name: "sample.fig",
        size: MAX_FIG_UPLOAD_BYTES + 1,
      }),
    ).toBe("too-large");
  });
});

function bigFigFile(size: number) {
  return new File([new Uint8Array(size)], "big.fig");
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("uploadDesignFile chunked transport", () => {
  it("splits a file past the wire cap into raw-body chunks and returns the final import", async () => {
    const size = MAX_UPLOAD_BYTES + 2 * 1024 * 1024;
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes("isFinal=1")
        ? jsonResponse({ designId: "d1", files: [{ id: "s1" }] })
        : jsonResponse({ uploadId: "u", received: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadDesignFile({
      designId: "d1",
      file: bigFigFile(size),
      fallbackErrorMessage: "Upload failed",
    });

    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("index=0");
    expect(calls[0]).toContain(`declaredSize=${size}`);
    expect(calls[0]).toContain("filename=big.fig");
    expect(calls[0]).toContain("isFinal=0");
    expect(calls[1]).toContain("index=1");
    expect(calls[1]).toContain("isFinal=1");
    // Every chunk must ride the same session id or the server reassembles junk.
    const uploadIds = new Set(
      calls.map((url) => new URL(url, "http://x").searchParams.get("uploadId")),
    );
    expect(uploadIds.size).toBe(1);
    expect(result).toMatchObject({ files: [{ id: "s1" }] });
  });

  it("stops at the first failing chunk instead of posting the rest", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "Upload session not found or expired." }, 404),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadDesignFile({
      designId: "d1",
      file: bigFigFile(MAX_UPLOAD_BYTES + 2 * 1024 * 1024),
      fallbackErrorMessage: "Upload failed",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ error: "Upload session not found or expired." });
  });

  it("falls back to the single-request upload when chunk storage is unavailable", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.stubGlobal("fetch", async () =>
      jsonResponse(
        { error: "Chunked upload needs storage", storageUnavailable: true },
        503,
      ),
    );

    const upload = uploadDesignFile({
      designId: "d1",
      file: bigFigFile(MAX_UPLOAD_BYTES + 1024),
      fallbackErrorMessage: "Upload failed",
    });
    await vi.waitFor(() => expect(FakeXMLHttpRequest.latest).not.toBeNull());
    const xhr = FakeXMLHttpRequest.latest!;
    expect(xhr.body).toBeInstanceOf(FormData);
    xhr.status = 200;
    xhr.responseText = JSON.stringify({
      designId: "d1",
      files: [{ id: "s2" }],
    });
    xhr.dispatch("load");

    await expect(upload).resolves.toMatchObject({ files: [{ id: "s2" }] });
  });
});
