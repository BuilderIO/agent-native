import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_FIG_UPLOAD_BYTES,
  uploadDesignFile,
  validateFigUploadFile,
} from "./design-file-upload";

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

  it("keeps the browser limit aligned with the 50 MB server cap", () => {
    expect(MAX_FIG_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
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
