// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "tab_1",
  setClientAppState: appState.set,
}));

import {
  beginClipUpload,
  cancelClipUpload,
  CLIP_UPLOAD_BLOCK_GONE_MS,
  clearClipUpload,
  failClipUpload,
  giveUpClipUpload,
  sendClipChunks,
  takeDroppedClipFile,
  holdDroppedClipFile,
  watchClipUploadBlocks,
} from "./clip-uploads";

const ticket = {
  recordingId: "rec_1",
  chunkUrl:
    "https://clips.example.test/api/uploads/rec_1/content-chunk?mimeType=video%2Fmp4&total=3&ticket=t1",
  cancelUrl:
    "https://clips.example.test/api/uploads/rec_1/content-cancel?ticket=t1",
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

function stubFetch(answers: Array<number | Error | Response>) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url: new URL(url), init });
      const answer = answers.shift() ?? 200;
      if (answer instanceof Error) throw answer;
      if (answer instanceof Response) return answer;
      return new Response("{}", { status: answer });
    }),
  );
  return sent;
}

beforeEach(() => {
  appState.set.mockReset();
});

afterEach(() => {
  for (const recordingId of ["rec_1", "rec_2"]) {
    void giveUpClipUpload(recordingId);
    clearClipUpload(recordingId);
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const BLOCK_ID = "clip-embed-abc12345";

function isCancel({ url }: Sent) {
  return url.pathname.endsWith("/content-cancel");
}

const cancelled = () =>
  Response.json({ outcome: "cancelled", recordingId: "rec_1" });

const finishedFirst = (status: string) =>
  Response.json(
    {
      error: "This upload is already finished",
      outcome: "already_finished",
      recordingId: "rec_1",
      status,
    },
    { status: 409 },
  );

/** Clips' answer to a final chunk it took, then parked until storage is set up. */
const parkedAnswer = () =>
  Response.json(
    {
      ok: true,
      finalized: false,
      waitingForStorage: true,
      status: "waiting_storage",
    },
    { status: 202 },
  );

/** Clips' answer to a final chunk it took and is making the Clip from. */
const finishedAnswer = () =>
  Response.json({
    ok: true,
    finalized: true,
    waitingForStorage: false,
    status: "processing",
  });

describe("sendClipChunks", () => {
  it("posts each chunk in order, with no credentials and nothing but the ticket's URL", async () => {
    const sent = stubFetch([]);
    const progress: number[] = [];
    await expect(
      sendClipChunks(file, ticket, (bytes) => progress.push(bytes), noWait),
    ).resolves.toBe("making");

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
      "making",
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
      "failed",
    );
    expect(refused).toHaveLength(2);

    const down = stubFetch([500, 500, 500, 500, 500]);
    await expect(sendClipChunks(file, ticket, () => {}, noWait)).resolves.toBe(
      "failed",
    );
    expect(down).toHaveLength(5);
  });

  it("sends a chunk again when Clips never answers it, then stops after the last retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // A request that never settles until its signal aborts.
    const hang = (init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("timed out", "TimeoutError")),
        );
      });
    let hangs = 1;
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        sent.push(new URL(url).searchParams.get("index")!);
        if (hangs > 0) {
          hangs -= 1;
          return hang(init);
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
    const slow = sendClipChunks(file, ticket, () => {}, noWait);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await expect(slow).resolves.toBe("making");
    expect(sent).toEqual(["0", "0", "1", "2"]);

    hangs = Infinity;
    sent.length = 0;
    const stuck = sendClipChunks(file, ticket, () => {}, noWait);
    await vi.advanceTimersByTimeAsync(5 * 2 * 60_000);
    await expect(stuck).resolves.toBe("failed");
    expect(sent).toEqual(["0", "0", "0", "0", "0"]);
  });

  const finishing = () =>
    Response.json(
      {
        error: "This upload is finishing. Try again.",
        outcome: "upload_finishing",
        recordingId: "rec_1",
      },
      { status: 409 },
    );

  it("sends the last chunk again while Clips is still taking an earlier send of it, beyond the usual retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const sent = stubFetch([
      200,
      200,
      ...Array.from({ length: 6 }, finishing),
      200,
    ]);
    const upload = sendClipChunks(file, ticket, () => {});
    await vi.advanceTimersByTimeAsync(6 * 5_000);

    await expect(upload).resolves.toBe("making");
    expect(sent.map(({ url }) => url.searchParams.get("index"))).toEqual([
      "0",
      "1",
      ...Array.from({ length: 7 }, () => "2"),
    ]);
  });

  it("gives the last chunk up once Clips has been taking an earlier send of it past its claim's two minutes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new URL(url).searchParams.get("isFinal") === "1"
          ? finishing()
          : new Response("{}", { status: 200 }),
      ),
    );
    let sent: string | null = null;
    void sendClipChunks(file, ticket, () => {}).then((result) => {
      sent = result;
    });

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(sent).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toBe("failed");
  });

  it("counts a last chunk Clips already took as sent when its answer was lost", async () => {
    const finished = (status: string) =>
      new Response(
        JSON.stringify({
          error: "This upload is already finished",
          data: { recordingId: "rec_1", status },
        }),
        { status: 409 },
      );
    stubFetch([200, 200, new TypeError("reset"), finished("processing")]);
    await expect(sendClipChunks(file, ticket, () => {}, noWait)).resolves.toBe(
      "making",
    );

    stubFetch([200, 200, new TypeError("reset"), finished("failed")]);
    await expect(sendClipChunks(file, ticket, () => {}, noWait)).resolves.toBe(
      "failed",
    );
  });

  it("says when the last chunk parked the upload until storage is connected, and when Clips is making the Clip", async () => {
    stubFetch([200, 200, parkedAnswer()]);
    await expect(sendClipChunks(file, ticket, () => {}, noWait)).resolves.toBe(
      "parked",
    );

    stubFetch([200, 200, finishedAnswer()]);
    await expect(sendClipChunks(file, ticket, () => {}, noWait)).resolves.toBe(
      "making",
    );
  });
});

describe("cancelClipUpload", () => {
  it.each([
    ["Clips cancelled it", cancelled(), { outcome: "cancelled" }],
    [
      "Clips was already making the Clip",
      finishedFirst("processing"),
      { outcome: "already_finished", status: "processing" },
    ],
    [
      "Clips had already made the Clip",
      finishedFirst("ready"),
      { outcome: "already_finished", status: "ready" },
    ],
    [
      "Clips refused it",
      Response.json(
        { error: "Clips didn't cancel this upload" },
        { status: 409 },
      ),
      { outcome: "not_cancelled" },
    ],
    [
      "an answer with no outcome",
      new Response("{}", { status: 200 }),
      { outcome: "not_cancelled" },
    ],
    [
      "a finished answer without a finished status",
      Response.json(
        { outcome: "already_finished", status: "uploading" },
        { status: 409 },
      ),
      { outcome: "not_cancelled" },
    ],
    [
      "an outcome under the wrong status code",
      Response.json({ outcome: "cancelled" }, { status: 409 }),
      { outcome: "not_cancelled" },
    ],
    [
      "a page that isn't JSON",
      new Response("<html>", { status: 502 }),
      { outcome: "not_cancelled" },
    ],
    ["no answer", new TypeError("offline"), { outcome: "not_cancelled" }],
  ])("says what happened when %s", async (_when, answer, result) => {
    stubFetch([answer]);
    await expect(cancelClipUpload(ticket, noWait)).resolves.toEqual(result);
  });

  it("cancels again when Clips never answers a cancel, then says it didn't confirm", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            sent.push(url);
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("timed out", "TimeoutError")),
            );
          }),
      ),
    );
    let result: unknown = null;
    void cancelClipUpload(ticket).then((answer) => {
      result = answer;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(result).toEqual({ outcome: "not_cancelled" });
    expect(sent).toEqual(Array.from({ length: 4 }, () => ticket.cancelUrl));
  });

  const finishing = () =>
    Response.json(
      {
        error: "This upload is finishing. Try again.",
        outcome: "upload_finishing",
        recordingId: "rec_1",
      },
      { status: 409 },
    );

  it.each([
    [
      "Clips made the Clip",
      finishedFirst("ready"),
      { outcome: "already_finished", status: "ready" },
    ],
    ["the final chunk failed", cancelled(), { outcome: "cancelled" }],
  ])(
    "cancels again with the same ticket while Clips takes the final chunk, until %s",
    async (_until, answer, result) => {
      const sent = stubFetch([finishing(), answer]);
      const wait = vi.fn(noWait);
      await expect(cancelClipUpload(ticket, wait)).resolves.toEqual(result);
      expect(wait.mock.calls).toEqual([[2_000]]);
      expect(sent.map(({ url }) => url.href)).toEqual([
        ticket.cancelUrl,
        ticket.cancelUrl,
      ]);
    },
  );

  it("says Clips didn't confirm the cancel when it is still taking the final chunk after the last retry", async () => {
    const sent = stubFetch([
      finishing(),
      finishing(),
      finishing(),
      finishing(),
    ]);
    const wait = vi.fn(noWait);
    await expect(cancelClipUpload(ticket, wait)).resolves.toEqual({
      outcome: "not_cancelled",
    });
    expect(wait.mock.calls).toEqual([[2_000], [5_000], [10_000]]);
    expect(sent).toHaveLength(4);
  });
});

describe("beginClipUpload", () => {
  it("tells the agent how the upload is going, without the file", async () => {
    stubFetch([]);
    await beginClipUpload({
      file,
      ticket,
      documentId: "doc_1",
      blockId: BLOCK_ID,
    });

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
      blockId: BLOCK_ID,
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

  it("ends as failed, and cancels in Clips, when Clips refuses a chunk", async () => {
    const sent = stubFetch([401]);
    await beginClipUpload({
      file,
      ticket,
      documentId: "doc_1",
      blockId: BLOCK_ID,
    });
    expect(lastWritten()).toMatchObject({
      uploads: [{ phase: "failed" }],
    });
    expect(sent.filter(isCancel)).toHaveLength(1);
    const [cancel] = sent.filter(isCancel);
    expect(cancel.url.toString()).toBe(ticket.cancelUrl);
    expect(cancel.init).toMatchObject({ method: "POST", credentials: "omit" });
    expect(cancel.init.body).toBeUndefined();
  });

  it("cancels in Clips once chunks keep failing past the last retry", async () => {
    const sent = stubFetch([500, 500, 500, 500, 500]);
    await beginClipUpload({
      file,
      ticket,
      documentId: "doc_1",
      blockId: BLOCK_ID,
    });
    expect(sent.filter(isCancel)).toHaveLength(1);
    expect(lastWritten()).toMatchObject({ uploads: [{ phase: "failed" }] });
  });

  it("ends as making, not failed, when the cancel finds Clips had the whole file", async () => {
    const sent = stubFetch([
      200,
      200,
      new TypeError("reset"),
      new TypeError("reset"),
      new TypeError("reset"),
      new TypeError("reset"),
      new TypeError("reset"),
      finishedFirst("processing"),
    ]);
    vi.useFakeTimers();
    const upload = beginClipUpload({
      file,
      ticket,
      documentId: "doc_1",
      blockId: BLOCK_ID,
    });
    await vi.runAllTimersAsync();
    await upload;
    expect(sent.filter(isCancel)).toHaveLength(1);
    expect(lastWritten()).toMatchObject({ uploads: [{ phase: "making" }] });
  });

  it("cancels nothing once every chunk is sent", async () => {
    const sent = stubFetch([]);
    await beginClipUpload({
      file,
      ticket,
      documentId: "doc_1",
      blockId: BLOCK_ID,
    });
    expect(sent.filter(isCancel)).toEqual([]);
  });

  it("tells the agent an upload failed when Clips couldn't make its Clip", async () => {
    stubFetch([]);
    await beginClipUpload({
      file,
      ticket,
      documentId: "doc_1",
      blockId: BLOCK_ID,
    });
    failClipUpload("rec_1");
    expect(lastWritten()).toEqual({
      uploads: [
        {
          recordingId: "rec_1",
          documentId: "doc_1",
          fileName: "demo.mp4",
          phase: "failed",
          percent: null,
        },
      ],
    });
  });
});

describe("an upload whose block leaves the page", () => {
  /**
   * Chunks that wait until the upload stops them; a cancel Clips takes,
   * unless it answers otherwise.
   */
  function stubSlowChunks(cancelAnswer: () => Response = cancelled) {
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        sent.push({ url: new URL(url), init });
        if (url.includes("/content-cancel")) {
          return Promise.resolve(cancelAnswer());
        }
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("stopped", "AbortError")),
          );
        });
      }),
    );
    return sent;
  }

  function fakeEditor(blockIds: string[]) {
    const listeners = new Set<() => void>();
    const editor = {
      isDestroyed: false,
      blockIds,
      state: {
        get doc() {
          return {
            descendants: (
              visit: (node: {
                type: { name: string };
                attrs: Record<string, unknown>;
              }) => unknown,
            ) => {
              visit({ type: { name: "paragraph" }, attrs: {} });
              for (const blockId of editor.blockIds) {
                visit({ type: { name: "registryBlock" }, attrs: { blockId } });
              }
            },
          };
        },
      },
      on: (_event: string, listener: () => void) => listeners.add(listener),
      off: (_event: string, listener: () => void) => listeners.delete(listener),
      /** The page changing, as a local edit or another editor's would. */
      change(next: string[]) {
        editor.blockIds = next;
        for (const listener of listeners) listener();
      },
    };
    return editor;
  }

  function start() {
    return beginClipUpload({
      file,
      ticket,
      documentId: "doc_1",
      blockId: BLOCK_ID,
    });
  }

  it("cancels it in Clips, stops sending, and says so once the block is gone for a moment", async () => {
    vi.useFakeTimers();
    const sent = stubSlowChunks();
    const editor = fakeEditor([BLOCK_ID]);
    const onGivenUp = vi.fn();
    const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);
    const upload = start();

    editor.change(["clip-embed-other123"]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS - 1);
    expect(sent.filter(isCancel)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await upload;

    expect(sent.filter(isCancel).map(({ url }) => url.toString())).toEqual([
      ticket.cancelUrl,
    ]);
    expect(sent[0].init.signal?.aborted).toBe(true);
    expect(onGivenUp).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: "rec_1", fileName: "demo.mp4" }),
      { outcome: "cancelled" },
    );
    expect(lastWritten()).toBeNull();
    // Stopped sending: no later chunk went out.
    expect(sent.filter((each) => !isCancel(each))).toHaveLength(1);
    stop();
  });

  it("says when Clips had the whole file before the cancel", async () => {
    vi.useFakeTimers();
    stubSlowChunks(() => finishedFirst("processing"));
    const editor = fakeEditor([BLOCK_ID]);
    const onGivenUp = vi.fn();
    const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);
    const upload = start();

    editor.change([]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS);
    await upload;
    expect(onGivenUp).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: "rec_1" }),
      { outcome: "already_finished", status: "processing" },
    );
    stop();
  });

  it.each([
    ["making", [] as Array<number>],
    ["failed", [401]],
  ])(
    "forgets an upload that is %s once its block is gone for a moment, cancelling nothing",
    async (phase, answers) => {
      vi.useFakeTimers();
      const sent = stubFetch(answers);
      await start();
      expect(lastWritten()).toMatchObject({ uploads: [{ phase }] });
      const cancels = sent.filter(isCancel).length;
      const editor = fakeEditor([BLOCK_ID]);
      const onGivenUp = vi.fn();
      const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);

      editor.change([]);
      await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS - 1);
      expect(lastWritten()).toMatchObject({ uploads: [{ phase }] });
      await vi.advanceTimersByTimeAsync(1);

      expect(lastWritten()).toBeNull();
      expect(onGivenUp).not.toHaveBeenCalled();
      expect(sent.filter(isCancel)).toHaveLength(cancels);
      stop();
    },
  );

  it.each([
    ["parked until storage is connected", parkedAnswer, 1],
    ["being made into a Clip", finishedAnswer, 0],
  ])(
    "cancels an upload whose last chunk Clips %s only while it isn't a Clip yet, once its block is gone",
    async (_when, lastAnswer, cancels) => {
      vi.useFakeTimers();
      const sent = stubFetch([200, 200, lastAnswer(), cancelled()]);
      await start();
      expect(lastWritten()).toMatchObject({ uploads: [{ phase: "making" }] });
      const editor = fakeEditor([BLOCK_ID]);
      const onGivenUp = vi.fn();
      const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);

      editor.change([]);
      await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS);

      expect(sent.filter(isCancel)).toHaveLength(cancels);
      expect(onGivenUp).toHaveBeenCalledTimes(cancels);
      expect(lastWritten()).toBeNull();
      stop();
    },
  );

  it("forgets the page's uploads it isn't sending once the page's last editor closes, and keeps sending the rest", async () => {
    vi.useFakeTimers();
    const made = {
      ...ticket,
      recordingId: "rec_2",
      chunkUrl: ticket.chunkUrl.replace("/rec_1/", "/rec_2/"),
      cancelUrl: ticket.cancelUrl.replace("/rec_1/", "/rec_2/"),
    };
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        sent.push({ url: new URL(url), init });
        if (url.includes("/rec_2/")) return Promise.resolve(finishedAnswer());
        return new Promise<Response>(() => {});
      }),
    );
    await beginClipUpload({
      file,
      ticket: made,
      documentId: "doc_1",
      blockId: "clip-embed-made1234",
    });
    void start();
    const blocks = [BLOCK_ID, "clip-embed-made1234"];
    const first = fakeEditor(blocks);
    const second = fakeEditor(blocks);
    const stopFirst = watchClipUploadBlocks(first as never, "doc_1", vi.fn());
    const stopSecond = watchClipUploadBlocks(second as never, "doc_1", vi.fn());

    stopFirst();
    expect(lastWritten()).toMatchObject({
      uploads: [
        { recordingId: "rec_2", phase: "making" },
        { phase: "uploading" },
      ],
    });
    stopSecond();
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS * 4);

    expect(lastWritten()).toEqual({
      uploads: [
        expect.objectContaining({ recordingId: "rec_1", phase: "uploading" }),
      ],
    });
    expect(sent.filter(isCancel)).toEqual([]);
  });

  it("keeps a finished upload whose block comes back in that moment", async () => {
    vi.useFakeTimers();
    stubFetch([]);
    await start();
    const editor = fakeEditor([BLOCK_ID]);
    const stop = watchClipUploadBlocks(editor as never, "doc_1", vi.fn());

    editor.change([]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS / 2);
    editor.change([BLOCK_ID]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS * 4);

    expect(lastWritten()).toMatchObject({ uploads: [{ phase: "making" }] });
    stop();
  });

  it("keeps sending when the block comes back in that moment, as a cut and paste or an undo would", async () => {
    vi.useFakeTimers();
    const sent = stubSlowChunks();
    const editor = fakeEditor([BLOCK_ID]);
    const onGivenUp = vi.fn();
    const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);
    void start();

    editor.change([]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS / 2);
    editor.change([BLOCK_ID]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS * 4);

    expect(sent.filter(isCancel)).toEqual([]);
    expect(onGivenUp).not.toHaveBeenCalled();
    expect(lastWritten()).toMatchObject({ uploads: [{ phase: "uploading" }] });
    stop();
  });

  it("gives up nothing when the editor closes with the block in place, or for another page's upload", async () => {
    vi.useFakeTimers();
    const sent = stubSlowChunks();
    const onGivenUp = vi.fn();
    const closing = fakeEditor([BLOCK_ID]);
    const stopClosing = watchClipUploadBlocks(
      closing as never,
      "doc_1",
      onGivenUp,
    );
    const otherPage = fakeEditor([]);
    const stopOther = watchClipUploadBlocks(
      otherPage as never,
      "doc_2",
      onGivenUp,
    );
    void start();

    stopClosing();
    otherPage.change([]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS * 4);

    expect(sent.filter(isCancel)).toEqual([]);
    expect(onGivenUp).not.toHaveBeenCalled();
    stopOther();
  });

  it("still gives the upload up, and says so, when the editor closes in the moment after its block went", async () => {
    vi.useFakeTimers();
    const sent = stubSlowChunks();
    const editor = fakeEditor([BLOCK_ID]);
    const onGivenUp = vi.fn();
    const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);
    const upload = start();

    editor.change([]);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS / 2);
    stop();
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS / 2);
    await upload;

    expect(sent.filter(isCancel).map(({ url }) => url.toString())).toEqual([
      ticket.cancelUrl,
    ]);
    expect(onGivenUp).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: "rec_1" }),
      { outcome: "cancelled" },
    );
    expect(lastWritten()).toBeNull();
  });

  it("keeps sending when the page opens again in that moment with the block back", async () => {
    vi.useFakeTimers();
    const sent = stubSlowChunks();
    const closing = fakeEditor([BLOCK_ID]);
    const onGivenUp = vi.fn();
    const stopClosing = watchClipUploadBlocks(
      closing as never,
      "doc_1",
      onGivenUp,
    );
    void start();

    closing.change([]);
    stopClosing();
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS / 2);
    const reopened = fakeEditor([BLOCK_ID]);
    const stop = watchClipUploadBlocks(reopened as never, "doc_1", onGivenUp);
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS * 4);

    expect(sent.filter(isCancel)).toEqual([]);
    expect(onGivenUp).not.toHaveBeenCalled();
    expect(lastWritten()).toMatchObject({ uploads: [{ phase: "uploading" }] });
    stop();
  });

  it("starts the moment when the page opens without the block, then gives the upload up", async () => {
    vi.useFakeTimers();
    const sent = stubSlowChunks();
    const upload = start();
    const onGivenUp = vi.fn();
    const editor = fakeEditor([]);
    const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);

    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS - 1);
    expect(sent.filter(isCancel)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await upload;

    expect(sent.filter(isCancel)).toHaveLength(1);
    expect(onGivenUp).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: "rec_1" }),
      { outcome: "cancelled" },
    );
    stop();
  });

  it("keeps sending when the block comes back with no update, as an outside merge would put it", async () => {
    vi.useFakeTimers();
    const sent = stubSlowChunks();
    const editor = fakeEditor([BLOCK_ID]);
    const onGivenUp = vi.fn();
    const stop = watchClipUploadBlocks(editor as never, "doc_1", onGivenUp);
    void start();

    editor.change([]);
    editor.blockIds = [BLOCK_ID];
    await vi.advanceTimersByTimeAsync(CLIP_UPLOAD_BLOCK_GONE_MS * 4);

    expect(sent.filter(isCancel)).toEqual([]);
    expect(onGivenUp).not.toHaveBeenCalled();
    stop();
  });

  it("cancels once, however often the upload is given up", async () => {
    const sent = stubSlowChunks();
    const upload = start();
    await expect(giveUpClipUpload("rec_1")).resolves.toEqual({
      outcome: "cancelled",
    });
    expect(giveUpClipUpload("rec_1")).toBeNull();
    await upload;
    expect(sent.filter(isCancel)).toHaveLength(1);
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
