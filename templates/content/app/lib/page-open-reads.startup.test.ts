// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_OPEN_READ_TTL_MS,
  readFromStartupPageRead,
  STARTUP_PAGE_READ_WAIT_MS,
  startupPageReadScript,
  takeStartupPageRead,
  type StartupPageReadAnswer,
} from "./page-open-reads";

const ACTION_URL = "/_agent-native/actions/get-page-open-read";

function runHeadScript() {
  // The script runs as an inline <script> in the document head.
  new Function(startupPageReadScript(ACTION_URL))();
}

function openLoad(path: string, { hint = true } = {}) {
  window.history.replaceState(null, "", path);
  document.cookie = `an_session_hint=${hint ? "1" : "0"}; path=/`;
}

describe("the load's page read from the document head", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "doc-1", title: "Harbor survey" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    void takeStartupPageRead("", {});
    document.cookie = "an_session_hint=; path=/; max-age=0";
    vi.unstubAllGlobals();
  });

  it("sends the page read with the page's own context and view", async () => {
    openLoad(
      "/page/doc-1?databaseId=db-1&databaseDocumentId=dbdoc-1&databaseViewId=%20board%20",
    );

    runHeadScript();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = new URL(url, "http://localhost");
    expect(sent.pathname).toBe(ACTION_URL);
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      id: "doc-1",
      databaseId: "db-1",
      databaseDocumentId: "dbdoc-1",
      databaseViewId: "board",
      includePreviewDraft: "true",
    });
    expect(init).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
    await expect(
      takeStartupPageRead("doc-1", {
        databaseId: "db-1",
        databaseDocumentId: "dbdoc-1",
      })?.answer,
    ).resolves.toEqual({
      ok: true,
      value: { id: "doc-1", title: "Harbor survey" },
    });
  });

  it("sends the view an exact viewId names ahead of the remembered one", () => {
    openLoad("/page/doc-1?databaseId=db-1&viewId=list&databaseViewId=board");

    runHeadScript();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      new URL(url, "http://localhost").searchParams.get("databaseViewId"),
    ).toBe("list");
  });

  it("is taken once, so a later open of the page reads it fresh", () => {
    openLoad("/page/doc-1");
    runHeadScript();

    expect(takeStartupPageRead("doc-1", {})).not.toBeNull();
    expect(takeStartupPageRead("doc-1", {})).toBeNull();
  });

  it("is not the answer for another page or another collection context", () => {
    openLoad("/page/doc-1?databaseId=db-1");
    runHeadScript();
    expect(takeStartupPageRead("doc-2", { databaseId: "db-1" })).toBeNull();

    runHeadScript();
    expect(takeStartupPageRead("doc-1", {})).toBeNull();
  });

  it("answers not ok for a refused read, so the app sends its own", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
      }),
    );
    openLoad("/page/doc-1");
    runHeadScript();

    await expect(takeStartupPageRead("doc-1", {})?.answer).resolves.toEqual({
      ok: false,
    });
  });

  it("answers not ok when the request fails", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    openLoad("/page/doc-1");
    runHeadScript();

    await expect(takeStartupPageRead("doc-1", {})?.answer).resolves.toEqual({
      ok: false,
    });
  });

  it("keeps its age from when it was sent, and is not the answer once that has run out", () => {
    const realNow = Date.now.bind(Date);
    openLoad("/page/doc-1");
    const sentAt = realNow();
    runHeadScript();
    // The app code arrives after the read's freshness has run out.
    const dateNow = vi
      .spyOn(Date, "now")
      .mockImplementation(() => sentAt + PAGE_OPEN_READ_TTL_MS);
    try {
      expect(takeStartupPageRead("doc-1", {})).toBeNull();
    } finally {
      dateNow.mockRestore();
    }

    runHeadScript();
    const taken = takeStartupPageRead("doc-1", {});
    expect(taken?.startedAt).toBeGreaterThanOrEqual(sentAt);
    expect(taken?.startedAt).toBeLessThanOrEqual(realNow());
  });

  it("is not sent without the session hint", () => {
    openLoad("/page/doc-1", { hint: false });
    runHeadScript();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(takeStartupPageRead("doc-1", {})).toBeNull();
  });

  it("is not sent from an embedded app, which may sign in another way", () => {
    openLoad("/page/doc-1?embedded=1");
    runHeadScript();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is not sent for a load that is not a page", () => {
    openLoad("/home");
    runHeadScript();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the app's page from the head script's read", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function headRead() {
    let answer!: (value: StartupPageReadAnswer) => void;
    const taken = {
      startedAt: Date.now(),
      answer: new Promise<StartupPageReadAnswer>((resolve) => {
        answer = resolve;
      }),
    };
    return { taken, answer };
  }

  it("is the head read's answer when it lands within the wait, with no read of its own", async () => {
    vi.useFakeTimers();
    const head = headRead();
    const ownRead = vi.fn(async () => "own");
    const page = readFromStartupPageRead(head.taken, ownRead);

    head.answer({ ok: true, value: "head" });
    await expect(page).resolves.toBe("head");
    await vi.advanceTimersByTimeAsync(STARTUP_PAGE_READ_WAIT_MS * 2);
    expect(ownRead).not.toHaveBeenCalled();
  });

  it("is the app's own read at once when the head read fails", async () => {
    vi.useFakeTimers();
    const head = headRead();
    const ownRead = vi.fn(async () => "own");
    const page = readFromStartupPageRead(head.taken, ownRead);

    head.answer({ ok: false });
    await expect(page).resolves.toBe("own");
    expect(ownRead).toHaveBeenCalledTimes(1);
  });

  it("sends the app's own read once the wait runs out, and takes whichever answers first", async () => {
    vi.useFakeTimers();
    const head = headRead();
    let ownAnswer!: (value: string) => void;
    const ownRead = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          ownAnswer = resolve;
        }),
    );
    const page = readFromStartupPageRead(head.taken, ownRead);

    await vi.advanceTimersByTimeAsync(STARTUP_PAGE_READ_WAIT_MS - 1);
    expect(ownRead).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ownRead).toHaveBeenCalledTimes(1);

    // The head read lands first after all.
    head.answer({ ok: true, value: "head" });
    ownAnswer("own");
    await expect(page).resolves.toBe("head");
  });

  it("is the head read's answer when the app's own read fails first", async () => {
    vi.useFakeTimers();
    const head = headRead();
    const ownRead = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
    const page = readFromStartupPageRead(head.taken, ownRead);
    let settled: unknown = "pending";
    page.then(
      (value) => (settled = value),
      (error: unknown) => (settled = error),
    );

    await vi.advanceTimersByTimeAsync(STARTUP_PAGE_READ_WAIT_MS);
    expect(ownRead).toHaveBeenCalledTimes(1);
    expect(settled).toBe("pending");

    head.answer({ ok: true, value: "head" });
    await expect(page).resolves.toBe("head");
  });

  it("fails with the app's own read's error once both reads have failed", async () => {
    vi.useFakeTimers();
    const head = headRead();
    const ownRead = vi.fn(() =>
      Promise.reject(new Error("Document not found")),
    );
    const page = readFromStartupPageRead(head.taken, ownRead);
    const settled = expect(page).rejects.toThrow("Document not found");

    await vi.advanceTimersByTimeAsync(STARTUP_PAGE_READ_WAIT_MS);
    head.answer({ ok: false });
    await settled;
  });

  it("fails with the app's own read's error when the head read failed first", async () => {
    vi.useFakeTimers();
    const head = headRead();
    const ownRead = vi.fn(() =>
      Promise.reject(new Error("Document not found")),
    );
    const page = readFromStartupPageRead(head.taken, ownRead);
    const settled = expect(page).rejects.toThrow("Document not found");

    head.answer({ ok: false });
    await settled;
    expect(ownRead).toHaveBeenCalledTimes(1);
  });
});
