import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadDesignSystemSourceFile } from "./design-system-source-upload";

vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (path: string) => path,
}));
afterEach(() => vi.unstubAllGlobals());
const failureMessage = "Upload unavailable";
function file() {
  return new File(["# Brand"], "brand.md", { type: "" });
}
const responseBody = {
  handle: {
    kind: "stored-file",
    path: "design-system-upload:v1:<fake-fixture>",
  },
  name: "brand.md",
  mimeType: "text/markdown",
  size: 7,
};

describe("native design-system source uploads", () => {
  it("sends one multipart file with cancellation and keeps server-normalized metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(responseBody));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(
      await uploadDesignSystemSourceFile(file(), { signal, failureMessage }),
    ).toEqual(responseBody);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/design-system-source-upload");
    expect(init.signal).toBe(signal);
    expect(Array.from(init.body.keys())).toEqual(["file"]);
    expect(init.body.get("file").name).toBe("brand.md");
    expect(init.headers).toBeUndefined();
  });

  it.each([
    {},
    { ...responseBody, handle: { kind: "stored-file", path: "" } },
    { ...responseBody, mimeType: "" },
    { ...responseBody, size: 123 },
  ])("rejects a response that cannot be read back", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(
      uploadDesignSystemSourceFile(file(), { failureMessage }),
    ).rejects.toThrow(failureMessage);
  });

  it("surfaces an actual upload rejection without returning a handle", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "File exceeds limit" }, { status: 413 }),
        ),
    );
    await expect(
      uploadDesignSystemSourceFile(file(), { failureMessage }),
    ).rejects.toThrow("File exceeds limit");
  });

  it("reports an unreadable response as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Gateway failure</html>", { status: 502 }),
        ),
    );
    await expect(
      uploadDesignSystemSourceFile(file(), { failureMessage }),
    ).rejects.toThrow(failureMessage);
  });
});
