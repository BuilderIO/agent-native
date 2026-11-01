// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn((_command: string) => Promise.resolve<unknown>("")),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

const entry = (id: string) => ({
  id,
  term: `term-${id}`,
  replacement: `replacement-${id}`,
  confidence: 0.7,
  usesCount: 1,
});

function listResponse(ids: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ vocabulary: ids.map(entry) }),
  } as Response;
}

const failedResponse = { ok: false, status: 503 } as Response;

// A list request the test answers when it chooses.
function deferredLists() {
  const pending: Array<(response: Response) => void> = [];
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes("add-vocabulary-term")) {
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }
    return new Promise<Response>((resolve) => pending.push(resolve));
  });
  vi.stubGlobal("fetch", fetchMock);
  const callsTo = (action: string) => () =>
    fetchMock.mock.calls.filter(([input]) => String(input).includes(action));
  return {
    pending,
    listCalls: callsTo("list-vocabulary"),
    learnCalls: callsTo("add-vocabulary-term"),
  };
}

const ids = (vocabulary: { status: string; entries?: { id: string }[] }) =>
  vocabulary.status === "loaded"
    ? vocabulary.entries?.map((item) => item.id)
    : vocabulary.status;

async function client(url = "https://clips.test") {
  const module = await import("./personal-vocabulary");
  module.configureVocabularyClient(url);
  return module;
}

describe("personal vocabulary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    tauri.invoke.mockReset().mockResolvedValue("");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("tells a vocabulary that has not loaded from one that is empty", async () => {
    const { pending } = deferredLists();
    const vocabulary = await client();

    expect(vocabulary.currentVocabulary()).toEqual({ status: "unloaded" });
    pending[0](listResponse([]));
    await vi.waitFor(() =>
      expect(vocabulary.currentVocabulary()).toMatchObject({
        status: "loaded",
        entries: [],
      }),
    );
  });

  it("reports a failed first load as failed, not empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failedResponse),
    );
    const vocabulary = await client();

    expect(await vocabulary.loadVocabulary()).toEqual({
      status: "failed",
      error: "HTTP 503",
    });
  });

  it("treats a response without a list as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    );
    const vocabulary = await client();

    expect((await vocabulary.loadVocabulary()).status).toBe("failed");
  });

  it("shares one request among every caller", async () => {
    const { pending, listCalls } = deferredLists();
    const vocabulary = await client();

    const first = vocabulary.loadVocabulary();
    vocabulary.currentVocabulary();
    const second = vocabulary.loadVocabulary();
    expect(listCalls()).toHaveLength(1);

    pending[0](listResponse(["a"]));
    expect(ids(await first)).toEqual(["a"]);
    expect(ids(await second)).toEqual(["a"]);
  });

  it("keeps the good list when a later refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(listResponse(["a"]))
      .mockResolvedValueOnce(failedResponse);
    vi.stubGlobal("fetch", fetchMock);
    const vocabulary = await client();
    expect(ids(await vocabulary.loadVocabulary())).toEqual(["a"]);

    await vi.advanceTimersByTimeAsync(60_001);
    expect(ids(await vocabulary.loadVocabulary())).toEqual(["a"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops a list fetched before a correction was learned", async () => {
    const { pending, listCalls, learnCalls } = deferredLists();
    tauri.invoke.mockResolvedValue("fixed the typo");
    const vocabulary = await client();

    const stale = vocabulary.loadVocabulary();
    vocabulary.recordPasteForLearn("fixed the tpyo");
    await vi.advanceTimersByTimeAsync(400);
    expect(learnCalls()).toHaveLength(1);

    const fresh = vocabulary.loadVocabulary();
    expect(listCalls()).toHaveLength(2);
    pending[1](listResponse(["after"]));
    pending[0](listResponse(["before"]));

    expect(ids(await fresh)).toEqual(["after"]);
    expect(ids(await stale)).toEqual(["after"]);
    expect(ids(vocabulary.currentVocabulary())).toEqual(["after"]);
  });

  it("never lets an old server's list replace the current server's", async () => {
    const { pending } = deferredLists();
    const vocabulary = await client("https://old.clips.test");
    const old = vocabulary.loadVocabulary();
    vocabulary.configureVocabularyClient("https://new.clips.test");
    const current = vocabulary.loadVocabulary();

    pending[1](listResponse(["new"]));
    expect(ids(await current)).toEqual(["new"]);
    pending[0](listResponse(["old"]));
    await old;
    expect(ids(vocabulary.currentVocabulary())).toEqual(["new"]);
  });
});
