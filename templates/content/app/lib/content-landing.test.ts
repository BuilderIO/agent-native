import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  writeClientAppState,
  callAction,
  hasSessionHint,
  pageReads,
  readOnlyWidget,
  writeWidget,
} = vi.hoisted(() => ({
  writeClientAppState: vi.fn(),
  callAction: vi.fn(),
  hasSessionHint: vi.fn(() => true),
  pageReads: vi.fn(),
  readOnlyWidget: { value: false },
  writeWidget: { value: false },
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction,
}));
vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  hasSessionHint,
}));
vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isMcpDirectoryWidgetReadOnlyEmbed: () => readOnlyWidget.value,
  isMcpDirectoryWidgetWriteEmbed: () => writeWidget.value,
}));
vi.mock("@/hooks/use-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-documents")>()),
  startPageOpenDocumentReads: pageReads,
}));

import { QueryClient } from "@tanstack/react-query";

import {
  isPersonalLanding,
  pageOpenedByLoad,
  rememberContentLandingDocument,
  startLoadReads,
} from "./content-landing";
import { LAST_LOCATION_HINT_STORAGE_KEY } from "./last-location-hint";

describe("rememberContentLandingDocument", () => {
  beforeEach(() => {
    writeClientAppState.mockReset();
    readOnlyWidget.value = false;
    writeWidget.value = false;
  });

  it.each([
    ["read-only", true, false],
    ["write-enabled", false, true],
  ] as const)(
    "skips landing-state writes for a %s directory widget capability",
    async (_label, isReadOnlyWidget, isWriteWidget) => {
      readOnlyWidget.value = isReadOnlyWidget;
      writeWidget.value = isWriteWidget;

      await expect(
        rememberContentLandingDocument({ documentId: "doc-1" }, "space-1"),
      ).resolves.toBeUndefined();

      expect(writeClientAppState).not.toHaveBeenCalled();
    },
  );

  it("still surfaces a failed write in a normal session", async () => {
    writeClientAppState.mockRejectedValue(new Error("offline"));

    await expect(
      rememberContentLandingDocument({ documentId: "doc-1" }),
    ).rejects.toThrow("offline");
  });

  it("stores the successfully loaded page separately from agent navigation", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument({ documentId: "doc-1" });

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v1",
      { documentId: "doc-1" },
      { requestSource: "content-landing" },
    );
  });

  it("records the title so the next landing can paint it optimistically", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument("doc-1", "Quarterly planning notes");

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v1",
      { documentId: "doc-1", title: "Quarterly planning notes" },
      { requestSource: "content-landing" },
    );
  });

  it("omits blank titles instead of recording an unusable hint", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument("doc-1", "   ");

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v1",
      { documentId: "doc-1" },
      { requestSource: "content-landing" },
    );
  });

  it("preserves navigation order when an earlier write is slower", async () => {
    let finishFirst!: (value: { documentId: string }) => void;
    writeClientAppState
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ documentId: "doc-2" });

    const first = rememberContentLandingDocument({ documentId: "doc-1" });
    const second = rememberContentLandingDocument({ documentId: "doc-2" });
    await vi.waitFor(() =>
      expect(writeClientAppState).toHaveBeenCalledTimes(1),
    );

    finishFirst({ documentId: "doc-1" });
    await Promise.all([first, second]);

    expect(writeClientAppState.mock.calls.map(([, value]) => value)).toEqual([
      { documentId: "doc-1" },
      { documentId: "doc-2" },
    ]);
  });

  it("leaves write failures observable to the caller", async () => {
    writeClientAppState.mockRejectedValue(new Error("state unavailable"));

    await expect(
      rememberContentLandingDocument({ documentId: "doc-1" }),
    ).rejects.toThrow("state unavailable");
  });

  it("records each page open where /home returns as well as in its space", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument(
      { documentId: "doc-1", title: "Plan" },
      "space-1",
    );

    expect(writeClientAppState).toHaveBeenCalledTimes(2);
    for (const key of [
      "content-last-location-v1",
      "content-last-location-v2:space-1",
    ]) {
      expect(writeClientAppState).toHaveBeenCalledWith(
        key,
        { documentId: "doc-1", title: "Plan" },
        { requestSource: "content-landing" },
      );
    }
  });

  it("stores exact destinations separately for each Content space", async () => {
    writeClientAppState.mockResolvedValue({ documentId: "doc-1" });

    await rememberContentLandingDocument(
      { documentId: "doc-1", databaseId: "db-1", viewId: "view-1" },
      "space-1",
    );

    expect(writeClientAppState).toHaveBeenCalledWith(
      "content-last-location-v2:space-1",
      { documentId: "doc-1", databaseId: "db-1", viewId: "view-1" },
      { requestSource: "content-landing" },
    );
  });
});

describe("isPersonalLanding", () => {
  it("is /home without a space", () => {
    const home = { pathname: "/home", search: "" };
    expect(isPersonalLanding(home)).toBe(true);
    expect(isPersonalLanding({ ...home, search: "?spaceId=space-1" })).toBe(
      false,
    );
    expect(isPersonalLanding({ ...home, pathname: "/page/inbox" })).toBe(false);
  });
});

describe("pageOpenedByLoad", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function rememberLastPage(documentId: string) {
    const stored = JSON.stringify({ scope: "[]", documentId });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === LAST_LOCATION_HINT_STORAGE_KEY ? stored : null,
    });
  }

  it("is the page a page URL names, whatever page /home would reopen", () => {
    rememberLastPage("last-page");
    expect(
      pageOpenedByLoad({
        pathname: "/page/NXqMwg3WOBAQ",
        search: "?databaseId=db-1",
      }),
    ).toBe("NXqMwg3WOBAQ");
  });

  it("is the page /home likely reopens", () => {
    rememberLastPage("last-page");
    expect(pageOpenedByLoad({ pathname: "/home", search: "" })).toBe(
      "last-page",
    );
    expect(
      pageOpenedByLoad({ pathname: "/home", search: "?spaceId=space-1" }),
    ).toBeFalsy();
  });

  it("is nothing for a load that opens no page", () => {
    rememberLastPage("last-page");
    for (const pathname of ["/page", "/page/", "/trash", "/settings/agent"]) {
      expect(pageOpenedByLoad({ pathname, search: "" })).toBeFalsy();
    }
  });
});

describe("startLoadReads", () => {
  beforeEach(() => {
    callAction.mockReset();
    callAction.mockReturnValue(new Promise(() => {}));
    hasSessionHint.mockReturnValue(true);
    pageReads.mockReset();
    const stored = JSON.stringify({ scope: "[]", documentId: "last-page" });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === LAST_LOCATION_HINT_STORAGE_KEY ? stored : null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const landings = () =>
    callAction.mock.calls.filter(([name]) => name === "resolve-content-landing")
      .length;

  it("reads a page a load opens without asking where /home lands", () => {
    startLoadReads(new QueryClient(), {
      key: "load-1",
      pathname: "/page/NXqMwg3WOBAQ",
      search: "?databaseId=db-1",
    });

    expect(pageReads).toHaveBeenCalledWith(
      expect.any(QueryClient),
      "NXqMwg3WOBAQ",
      { databaseId: "db-1", databaseDocumentId: null },
      { beforeSession: true },
    );
    expect(landings()).toBe(0);
  });

  it("asks where /home lands alongside the page it likely reopens", () => {
    startLoadReads(new QueryClient(), {
      key: "load-2",
      pathname: "/home",
      search: "",
    });

    expect(pageReads).toHaveBeenCalledWith(
      expect.any(QueryClient),
      "last-page",
      { databaseId: null, databaseDocumentId: null },
      { beforeSession: true },
    );
    expect(landings()).toBe(1);
  });

  it("starts nothing without the session hint", () => {
    hasSessionHint.mockReturnValue(false);
    for (const [key, pathname] of [
      ["load-3", "/home"],
      ["load-4", "/page/NXqMwg3WOBAQ"],
    ]) {
      startLoadReads(new QueryClient(), { key, pathname, search: "" });
    }

    expect(pageReads).not.toHaveBeenCalled();
    expect(landings()).toBe(0);
  });
});
