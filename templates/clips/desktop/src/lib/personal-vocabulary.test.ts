// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diffSingleWord, isPlausibleCorrection } from "./personal-vocabulary";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn((_command: string) => Promise.resolve<unknown>("")),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

const events = vi.hoisted(() => ({
  emit: vi.fn((_event: string, _payload?: unknown) => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: events.emit,
  listen: events.listen,
}));

const proposed = () =>
  events.emit.mock.calls
    .filter(([name]) => name === "voice:vocab-suggestion")
    .map(
      ([, payload]) =>
        payload as { id: number; term: string; replacement: string },
    );

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
    // A one-letter spelling fix: our filter (isPlausibleCorrection) does not
    // learn a swapped word or a transposition like "tpyo" -> "typo".
    tauri.invoke.mockResolvedValue("run kubectl now");
    const vocabulary = await client();

    const stale = vocabulary.loadVocabulary();
    vocabulary.recordPasteForLearn("run kublectl now");
    await vi.advanceTimersByTimeAsync(400);
    // Nothing is saved until the user accepts the suggestion.
    expect(learnCalls()).toHaveLength(0);
    const suggestion = proposed().at(-1)!;
    expect(suggestion).toMatchObject({
      term: "kublectl",
      replacement: "kubectl",
    });
    vocabulary.answerVocabularySuggestion(suggestion.id, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(learnCalls()).toHaveLength(1);

    const fresh = vocabulary.loadVocabulary();
    expect(listCalls()).toHaveLength(2);
    pending[1](listResponse(["after"]));
    pending[0](listResponse(["before"]));

    expect(ids(await fresh)).toEqual(["after"]);
    expect(ids(await stale)).toEqual(["after"]);
    expect(ids(vocabulary.currentVocabulary())).toEqual(["after"]);
  });

  it("does not save an ignored or expired suggestion", async () => {
    const { learnCalls } = deferredLists();
    tauri.invoke.mockResolvedValue("run kubectl now");
    const vocabulary = await client();

    vocabulary.recordPasteForLearn("run kublectl now");
    await vi.advanceTimersByTimeAsync(400);
    const ignored = proposed().at(-1)!;
    vocabulary.answerVocabularySuggestion(ignored.id, false);

    vocabulary.recordPasteForLearn("run kublectl now");
    await vi.advanceTimersByTimeAsync(400);
    const expired = proposed().at(-1)!;
    expect(vocabulary.hasPendingVocabularySuggestion()).toBe(true);
    await vi.advanceTimersByTimeAsync(vocabulary.VOCAB_SUGGESTION_TIMEOUT_MS);
    expect(vocabulary.hasPendingVocabularySuggestion()).toBe(false);
    vocabulary.answerVocabularySuggestion(expired.id, true);
    await vi.advanceTimersByTimeAsync(0);

    expect(learnCalls()).toHaveLength(0);
  });

  it("reports an accepted suggestion the server did not save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 }) as Response),
    );
    tauri.invoke.mockResolvedValue("run kubectl now");
    const vocabulary = await client();

    vocabulary.recordPasteForLearn("run kublectl now");
    await vi.advanceTimersByTimeAsync(400);
    const suggestion = proposed().at(-1)!;
    await vocabulary.answerVocabularySuggestion(suggestion.id, true);

    expect(events.emit).toHaveBeenCalledWith("voice:vocab-suggestion-saved", {
      id: suggestion.id,
      saved: false,
    });
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

describe("isPlausibleCorrection", () => {
  it("accepts spelling fixes", () => {
    expect(isPlausibleCorrection("kublectl", "kubectl")).toBe(true);
    expect(isPlausibleCorrection("Nevel", "Nevil")).toBe(true);
    expect(isPlausibleCorrection("Hulspaz", "Hulspas")).toBe(true);
  });

  it("rejects a word typed onto or cut from the original", () => {
    expect(isPlausibleCorrection("knoppen", "quknoppen")).toBe(false);
    expect(isPlausibleCorrection("staan", "staanbu")).toBe(false);
    expect(isPlausibleCorrection("lezen", "mlezen")).toBe(false);
    expect(isPlausibleCorrection("niets", "niet")).toBe(false);
  });

  it("rejects a different word", () => {
    expect(isPlausibleCorrection("Test", "He")).toBe(false);
    expect(isPlausibleCorrection("meeting", "lunch")).toBe(false);
    expect(isPlausibleCorrection("is", "it")).toBe(false);
  });
});

describe("diffSingleWord", () => {
  it("learns a single spelling fix", () => {
    expect(diffSingleWord("run kublectl now", "run kubectl now")).toEqual({
      term: "kublectl",
      replacement: "kubectl",
    });
  });

  it("does not learn a swapped word", () => {
    expect(
      diffSingleWord(
        "Dit is een test om te kijken",
        "Dit is een He om te kijken",
      ),
    ).toBeNull();
  });
});
