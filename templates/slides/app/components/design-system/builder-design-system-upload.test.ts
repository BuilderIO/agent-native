import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  uploadBuilderDesignSystemFiles,
  uploadAndIndexFigmaFiles,
} from "./builder-design-system-upload";

vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (path: string) => path,
}));

describe("Builder upload-only staging", () => {
  const fetchMock = vi.fn();
  const files = () => [
    new File(["fig"], "brand.fig", { type: "application/octet-stream" }),
    new File(["css"], "theme.css", { type: "text/css" }),
  ];
  const slots = [
    {
      idx: 0,
      uploadUrl: "https://storage.example.test/start/0",
      uploadToken: "<UPLOAD_TOKEN_0>",
    },
    {
      idx: 1,
      uploadUrl: "https://storage.example.test/start/1",
      uploadToken: "<UPLOAD_TOKEN_1>",
    },
  ];
  function respond(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
  }
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "/api/design-system-upload-start")
        return respond({ uploads: [...slots].reverse() });
      if (input.startsWith("https://storage.example.test/start/")) {
        return new Response(null, {
          status: 200,
          headers: { Location: input.replace("/start/", "/session/") },
        });
      }
      if (input.startsWith("https://storage.example.test/session/"))
        return new Response(null, { status: 200 });
      if (input === "/api/index-design-system-sources")
        return respond({ designSystemId: "example-dsi" });
      throw new Error("Unexpected mock request");
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("returns every file/token only after streaming, without indexing", async () => {
    const progress = vi.fn();
    await expect(
      uploadBuilderDesignSystemFiles(files(), { onProgress: progress }),
    ).resolves.toEqual([
      { name: "brand.fig", uploadToken: "<UPLOAD_TOKEN_0>" },
      { name: "theme.css", uploadToken: "<UPLOAD_TOKEN_1>" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("index-design-system"),
      ),
    ).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(1);
  });
  it("preserves the legacy combined helper's one indexing call", async () => {
    await uploadAndIndexFigmaFiles(files());
    const calls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("index-design-system"),
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1].body)).toMatchObject({
      uploadTokens: ["<UPLOAD_TOKEN_0>", "<UPLOAD_TOKEN_1>"],
    });
  });
  it.each([[[]], [[new File([], "empty.fig")]]])(
    "rejects empty input before upload requests",
    async (input) => {
      await expect(uploadBuilderDesignSystemFiles(input)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each([
    [],
    [slots[0], { ...slots[1], idx: 0 }],
    [slots[0], { ...slots[1], uploadToken: "" }],
    [slots[0], { ...slots[1], uploadUrl: "" }],
  ])(
    "rejects an incomplete or invalid slot batch without streaming: %j",
    async (...uploads) => {
      fetchMock.mockResolvedValue(respond({ uploads }));
      await expect(uploadBuilderDesignSystemFiles(files())).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("refuses an upload authorization failure without returning tokens or indexing", async () => {
    fetchMock.mockResolvedValue(
      respond({ error: "Connection access denied" }, 403),
    );
    await expect(uploadBuilderDesignSystemFiles(files())).rejects.toThrow(
      "Connection access denied",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not treat all bytes acknowledged with 308 as finalized", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (input: string) => {
      if (input === "/api/design-system-upload-start")
        return respond({ uploads: [slots[0]] });
      if (input.includes("/start/"))
        return new Response(null, {
          headers: { Location: "https://storage.example.test/session/0" },
        });
      return new Response(null, {
        status: 308,
        headers: { Range: "bytes=0-2" },
      });
    });
    const promise = uploadBuilderDesignSystemFiles([files()[0]]);
    const check = expect(promise).rejects.toThrow(
      "Unexpected upload status 308",
    );
    await vi.runAllTimersAsync();
    await check;
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("index-design-system"),
      ),
    ).toBe(false);
  });
});
