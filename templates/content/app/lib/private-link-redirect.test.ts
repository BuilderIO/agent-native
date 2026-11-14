import { decodeContinuation, signInJourney } from "@agent-native/core/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS,
  PRIVATE_LINK_ATTEMPT_KEY_PREFIX,
  PRIVATE_LINK_ATTEMPT_WINDOW_MS,
  PRIVATE_LINK_REDIRECT_ATTRIBUTE,
  privateDocumentRedirectHref,
  privateDocumentRedirectScript,
  privateLinkRedirectStarted,
} from "./private-link-redirect";

const BASE_PATH = "/content";
const PAGE_HREF = "/content/page/FsXU0lX7Ime9";
const ATTEMPT_KEY = `${PRIVATE_LINK_ATTEMPT_KEY_PREFIX}${PAGE_HREF}`;
const NOW = Date.UTC(2026, 9, 27, 12);

type Storage = Pick<
  globalThis.Storage,
  "getItem" | "setItem" | "removeItem"
> & { entries: Map<string, string> };

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    entries: map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function blockedStorage(): Storage {
  const blocked = () => {
    throw new Error("storage is blocked");
  };
  return {
    entries: new Map(),
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  };
}

interface Visit {
  cookie?: string;
  search?: string;
  hash?: string;
  storage?: Storage;
}

function signInFor(at: string) {
  return signInJourney({ at, basePath: BASE_PATH }).signInHref;
}

function runScript(script: string, visit: Visit = {}) {
  const setAttribute = vi.fn();
  const replace = vi.fn();
  new Function("document", "location", "sessionStorage", script)(
    { cookie: visit.cookie ?? "", documentElement: { setAttribute } },
    { search: visit.search ?? "", hash: visit.hash ?? "", replace },
    visit.storage ?? memoryStorage(),
  );
  return { setAttribute, replace };
}

function scriptDestination(visit: Visit) {
  return runScript(privateDocumentRedirectScript(PAGE_HREF, BASE_PATH), visit)
    .replace.mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("privateDocumentRedirectScript", () => {
  it("hides the notice and leaves for the app page with a session hint", () => {
    const storage = memoryStorage();
    const { setAttribute, replace } = runScript(
      privateDocumentRedirectScript(PAGE_HREF, BASE_PATH),
      { cookie: "theme=dark; an_session_hint=1", storage },
    );

    expect(setAttribute).toHaveBeenCalledWith(
      PRIVATE_LINK_REDIRECT_ATTRIBUTE,
      "",
    );
    expect(replace).toHaveBeenCalledWith(PAGE_HREF);
    expect(storage.entries.get(ATTEMPT_KEY)).toBe(String(NOW));
  });

  it("reads an app's own session hint cookie", () => {
    expect(scriptDestination({ cookie: "an_session_content_hint=1" })).toBe(
      PAGE_HREF,
    );
  });

  // A signed-out app page sends its visitor to this page, so going there
  // without a session would bounce between the two.
  it.each([
    ["no cookies", ""],
    ["other cookies", "theme=dark; an_session_hintx=1"],
    ["a cleared hint", "an_session_hint=0"],
  ])("goes straight to sign-in with %s", (_label, cookie) => {
    const storage = memoryStorage();
    const { setAttribute, replace } = runScript(
      privateDocumentRedirectScript(PAGE_HREF, BASE_PATH),
      { cookie, storage },
    );

    expect(setAttribute).toHaveBeenCalledWith(
      PRIVATE_LINK_REDIRECT_ATTRIBUTE,
      "",
    );
    expect(replace).toHaveBeenCalledWith(signInFor(PAGE_HREF));
    expect(storage.entries.size).toBe(0);
  });

  // The hint can outlive its session, or belong to another app on the same
  // host. The app page then sends the visitor straight back here.
  it("goes to sign-in when the app page sends a hinted visitor back", () => {
    const storage = memoryStorage();
    const visit = { cookie: "an_session_mail_hint=1", storage };

    expect(scriptDestination(visit)).toBe(PAGE_HREF);
    vi.setSystemTime(NOW + 2_000);
    expect(scriptDestination(visit)).toBe(signInFor(PAGE_HREF));
    expect(storage.entries.has(ATTEMPT_KEY)).toBe(false);
  });

  it("follows the hint again once the window has passed", () => {
    const storage = memoryStorage({
      [ATTEMPT_KEY]: String(NOW - PRIVATE_LINK_ATTEMPT_WINDOW_MS),
    });

    expect(scriptDestination({ cookie: "an_session_hint=1", storage })).toBe(
      PAGE_HREF,
    );
    expect(storage.entries.get(ATTEMPT_KEY)).toBe(String(NOW));
  });

  it("keeps one page's attempt from blocking another's", () => {
    const storage = memoryStorage({
      [`${PRIVATE_LINK_ATTEMPT_KEY_PREFIX}/content/page/other`]: String(NOW),
    });

    expect(scriptDestination({ cookie: "an_session_hint=1", storage })).toBe(
      PAGE_HREF,
    );
  });

  it("goes to sign-in when it can't remember the attempt", () => {
    expect(
      scriptDestination({
        cookie: "an_session_hint=1",
        storage: blockedStorage(),
      }),
    ).toBe(signInFor(PAGE_HREF));
  });

  it("keeps the editor link's query and hash on both destinations", () => {
    const search = "?databaseId=db-1&viewId=view-2";
    const hash = "#intro";
    const page = `${PAGE_HREF}${search}${hash}`;

    expect(
      scriptDestination({ cookie: "an_session_hint=1", search, hash }),
    ).toBe(page);

    const signIn = new URL(
      String(scriptDestination({ search, hash })),
      "https://content.test",
    );
    expect(signIn.pathname).toBe(`${BASE_PATH}/sign-in`);
    expect(decodeContinuation(signIn.searchParams.get("c"), BASE_PATH)).toBe(
      page,
    );
  });

  it("cannot be closed early by the page address", () => {
    const href = '/page/</script><script>alert("x")</script>';
    const script = privateDocumentRedirectScript(href, "");

    expect(script).not.toContain("</script>");
    expect(
      runScript(script, { cookie: "an_session_hint=1" }).replace,
    ).toHaveBeenCalledWith(href);
  });

  it("hides the notice on the attribute the script sets", () => {
    expect(HIDDEN_WHILE_PRIVATE_LINK_REDIRECTS).toBe(
      `[html[${PRIVATE_LINK_REDIRECT_ATTRIBUTE}]_&]:invisible`,
    );
  });
});

describe("privateDocumentRedirectHref", () => {
  function moduleDestination(visit: Visit) {
    vi.stubGlobal("document", { cookie: visit.cookie ?? "" });
    vi.stubGlobal("window", {
      location: { search: visit.search ?? "", hash: visit.hash ?? "" },
      sessionStorage: visit.storage ?? memoryStorage(),
    });
    return privateDocumentRedirectHref(PAGE_HREF, BASE_PATH);
  }

  it("picks the same place as the script and remembers the same attempt", () => {
    const recent = { [ATTEMPT_KEY]: String(NOW - 1_000) };
    const expired = {
      [ATTEMPT_KEY]: String(NOW - PRIVATE_LINK_ATTEMPT_WINDOW_MS),
    };
    for (const cookie of [
      "",
      "an_session_hint=1",
      "an_session_content_hint=1",
      "an_session_hint=0",
    ]) {
      for (const entries of [{}, recent, expired]) {
        for (const location of [
          { search: "", hash: "" },
          { search: "?viewId=view-2", hash: "#intro" },
        ]) {
          const scriptStorage = memoryStorage(entries);
          const moduleStorage = memoryStorage(entries);

          expect(
            moduleDestination({ cookie, ...location, storage: moduleStorage }),
          ).toBe(
            scriptDestination({ cookie, ...location, storage: scriptStorage }),
          );
          expect([...moduleStorage.entries]).toEqual([
            ...scriptStorage.entries,
          ]);
        }
      }
    }
  });

  it("goes to sign-in like the script when it can't remember the attempt", () => {
    const visit = { cookie: "an_session_hint=1", storage: blockedStorage() };

    expect(moduleDestination(visit)).toBe(scriptDestination(visit));
  });
});

describe("privateLinkRedirectStarted", () => {
  it("reports the move the script already started", () => {
    const attributes = new Set<string>();
    vi.stubGlobal("document", {
      documentElement: {
        hasAttribute: (name: string) => attributes.has(name),
      },
    });

    expect(privateLinkRedirectStarted()).toBe(false);
    attributes.add(PRIVATE_LINK_REDIRECT_ATTRIBUTE);
    expect(privateLinkRedirectStarted()).toBe(true);
  });
});
