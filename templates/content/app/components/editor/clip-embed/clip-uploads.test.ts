// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab_1",
  setClientAppState: appState.set,
}));

import {
  beginClipUpload,
  clearClipUpload,
  sendClipChunks,
  takeDroppedClipFile,
  holdDroppedClipFile,
} from "./clip-uploads";

const ticket = {
  recordingId: "rec_1",
  chunkUrl:
    "https://clips.example.test/api/uploads/rec_1/content-chunk?mimeType=video%2Fmp4&total=3&ticket=t1",
  chunkSizeBytes: 4,
  totalChunks: 3,
  expiresAt: "2026-10-24T12:00:00.000Z",
};

const file = new File([new Uint8Array(10)], "demo.mp4", { type: "video/mp4" });
const noWait = async () => {};

function lastWritten() {
  const calls = appState.set.mock.calls;
  return calls[calls.length - 1]?.[1];
}

type Sent = { url: URL; init: RequestInit };

function stubFetch(answers: Array<number | Error>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url: new URL(url), init });
      const answer = answers.shift() ?? 200;
      if (answer instanceof Error) throw answer;
      return new Response("{}", { status: answer });
    }),
  );
  return sent;
}

beforeEach(() => {
  appState.set.mockReset();
});

afterEach(() => {
  clearClipUpload("rec_1");
  vi.unstubAllGlobals();
});

describe("sendClipChunks", () => {
  it("posts each chunk in order, with no credentials and nothing but the ticket's URL", async () => {
    const sent = stubFetch([]);
    const progress: number[] = [];
    await expect(
      sendClipChunks(file, ticket, (bytes) => progress.push(bytes), noWait),
    ).resolves.toBe(true);

    expect(
      sent.map(({ url }) => [
        url.origin + url.pathname,
        url.searchParams.get("ticket"),
        url.searchParams.get("index"),
        url.searchParams.get("isFinal"),
      ]),
    ).toEqual([
      [
        "https://clips.example.test/api/uploads/rec_1/content-chunk",
        "t1",
        "0",
        "0",
      ],
      [
        "https://clips.example.test/api/uploads/rec_1/content-chunk",
        "t1",
        "1",
        "0",
      ],
      [
        "https://clips.example.test/api/uploads/rec_1/content-chunk",
        "t1",
        "2",
        "1",
      ],
    ]);
    for (const { init } of sent) {
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("omit");
      expect(init.headers).toBeUndefined();
      expect((init.body as Blob).type).toBe("");
    }
    expect(sent.map(({ init }) => (init.body as Blob).size)).toEqual([4, 4, 2]);
    expect(progress).toEqual([4, 8, 10]);
  });

  it("sends a chunk again after a passing failure", async () => {
    const sent = stubFetch([503, new TypeError("offline"), 429, 200, 200, 200]);
    const wait = vi.fn(noWait);
    await expect(sendClipChunks(file, ticket, () => {}, wait)).resolves.toBe(
      true,
    );
    expect(sent.map(({ url }) => url.searchParams.get("index"))).toEqual([
      "0",
      "0",
      "0",
      "0",
      "1",
      "2",
    ]);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it("stops at a refusal, and after the last retry", async () => {
    const refused = stubFetch([200, 401]);
    await expect(sendClipChunks(file, ticket, () => {}, noWait)).resolves.toBe(
      false,
    );
    expect(refused).toHaveLength(2);

    const down = stubFetch([500, 500, 500, 500, 500]);
    await expect(sendClipChunks(file, ticket, () => {}, noWait)).resolves.toBe(
      false,
    );
    expect(down).toHaveLength(5);
  });
});

describe("beginClipUpload", () => {
  it("tells the agent how the upload is going, without the file", async () => {
    stubFetch([]);
    await beginClipUpload({ file, ticket, documentId: "doc_1" });

    const written = appState.set.mock.calls.map(([key, value]) => [key, value]);
    expect(written.map(([key]) => key)).toContain("content-clip-uploads");
    expect(written[written.length - 1]?.[1]).toEqual({
      uploads: [
        {
          recordingId: "rec_1",
          documentId: "doc_1",
          fileName: "demo.mp4",
          phase: "making",
          percent: null,
        },
      ],
    });
    expect(
      written.some(
        ([, value]) =>
          (value as { uploads?: Array<{ percent: number | null }> })
            ?.uploads?.[0]?.percent === 0,
      ),
    ).toBe(true);

    clearClipUpload("rec_1");
    expect(lastWritten()).toBeNull();
  });

  it("asks before the tab closes mid-upload", async () => {
    let release: () => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(new Response("{}", { status: 200 }));
          }),
      ),
    );
    const upload = beginClipUpload({
      file,
      ticket: { ...ticket, totalChunks: 1, chunkSizeBytes: 10 },
      documentId: "doc_1",
    });
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    release();
    await upload;
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("ends as failed when Clips refuses a chunk", async () => {
    stubFetch([401]);
    await beginClipUpload({ file, ticket, documentId: "doc_1" });
    expect(lastWritten()).toMatchObject({
      uploads: [{ phase: "failed" }],
    });
  });
});

describe("dropped files", () => {
  it("hands each file to its block once", () => {
    holdDroppedClipFile("video-1", file);
    expect(takeDroppedClipFile("video-1")).toBe(file);
    expect(takeDroppedClipFile("video-1")).toBeNull();
    expect(takeDroppedClipFile(null)).toBeNull();
  });
});
