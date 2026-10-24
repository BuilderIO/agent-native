// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { templateLibraryPath } from "@/lib/template-navigation";

import { useNavigationState } from "./use-navigation-state";

const mocks = vi.hoisted(() => ({
  command: null as unknown,
  deck: { slides: [{ id: "slide-1" }, { id: "slide-2" }] },
  cache: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (_action: string, args: Record<string, unknown>) => ({
    data: args.id ? mocks.deck : undefined,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.command }),
  useQueryClient: () => ({ setQueryData: mocks.cache }),
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));
vi.mock("@/lib/tab-id", () => ({ TAB_ID: "template-navigation-test" }));
vi.mock("@/lib/deck-filter", () => ({
  readStoredDeckFilter: () => "mine",
  resolveDeckFilter: (createdBy: string | null) =>
    createdBy === "not-me"
      ? "not-mine"
      : createdBy === "me"
        ? "mine"
        : createdBy !== null
          ? "all"
          : "mine",
}));

function Harness() {
  useNavigationState();
  const location = useLocation();
  return (
    <>
      <output>
        {location.pathname}
        {location.search}
      </output>
      <Link to="/home">Close preview</Link>
      <Link to="/deck/deck-1/present?slide=2">Present</Link>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.command = null;
  mocks.fetch.mockImplementation(async (_url, options) => ({
    ok: true,
    status: 200,
    text: async () => (typeof options?.body === "string" ? options.body : ""),
  }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const writes = () =>
  mocks.fetch.mock.calls
    .filter(([, options]) => options.method === "PUT")
    .map(([, options]) => JSON.parse(options.body));
const appStateWrites = () =>
  mocks.fetch.mock.calls
    .filter(([, options]) => options.method === "PUT")
    .map(([url, options]) => ({
      url: String(url),
      state: JSON.parse(options.body),
    }));

describe("template navigation parity", () => {
  it("captures the Home tab and deck search from the current route", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/home?homeTab=recent&deckSearch=quarterly%20plan&createdBy=not-me",
        ]}
      >
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(writes()).toContainEqual({
        app: "slides-2",
        view: "list",
        deckFilter: "shared",
        homeTab: "recent",
        deckSearch: "quarterly plan",
      }),
    );
  });

  it("captures a direct gallery route, selected template, and search", async () => {
    render(
      <MemoryRouter
        initialEntries={["/templates?templateId=starter-pitch&search=pitch"]}
      >
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(writes()).toContainEqual({
        app: "slides-2",
        view: "templates",
        templateId: "starter-pitch",
        search: "pitch",
      }),
    );
  });
  it("exposes the home preview and clears selection on close without changing home state", async () => {
    render(
      <MemoryRouter initialEntries={["/home?templateId=starter-update"]}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(writes()).toContainEqual({
        app: "slides-2",
        view: "list",
        deckFilter: "created-by-me",
        templateId: "starter-update",
      }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Close preview" }));
    await waitFor(() =>
      expect(writes()).toContainEqual({
        app: "slides-2",
        view: "list",
        deckFilter: "created-by-me",
      }),
    );
  });
  it("consumes an agent templates command through the existing router without a shell replacement", async () => {
    mocks.command = {
      key: "navigate:test",
      command: {
        view: "templates",
        templateId: "starter-pitch",
        search: "funding & growth",
        _writeId: "template-command",
      },
    };
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        templateLibraryPath("starter-pitch", "funding & growth"),
      ),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining("navigate:test"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("navigates to a Home tab and search from an agent command", async () => {
    mocks.command = {
      key: "navigate:home",
      command: {
        view: "list",
        homeTab: "recent",
        deckSearch: "roadmap",
        _writeId: "home-command",
      },
    };
    render(
      <MemoryRouter initialEntries={["/templates"]}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "/home?homeTab=recent&deckSearch=roadmap",
      ),
    );
  });

  it("navigates to Shared decks from an agent command", async () => {
    mocks.command = {
      key: "navigate:shared",
      command: {
        view: "list",
        deckFilter: "shared",
        _writeId: "shared-command",
      },
    };
    render(
      <MemoryRouter initialEntries={["/templates"]}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "/home?homeTab=recent&createdBy=not-me",
      ),
    );
  });
});

describe("editor and presenter navigation state", () => {
  it("opens the requested editor slide from an agent navigation command", async () => {
    mocks.command = {
      key: "navigate:editor",
      command: {
        view: "editor",
        deckId: "deck-1",
        slideNumber: 2,
        _writeId: "editor-command",
      },
    };
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "/deck/deck-1?slide=2",
      ),
    );
    await waitFor(() =>
      expect(writes()).toContainEqual(
        expect.objectContaining({
          app: "slides-2",
          view: "editor",
          deckId: "deck-1",
          slideId: "slide-2",
          slideNumber: 2,
          slideIndex: 1,
        }),
      ),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining("navigate:editor"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("publishes the active p slide to tab-scoped and canonical navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/deck/deck-1?p=2"]}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const records = appStateWrites();
      expect(records).toHaveLength(2);
      expect(records.map(({ state }) => state)).toEqual([
        {
          app: "slides-2",
          view: "editor",
          deckId: "deck-1",
          slideId: "slide-2",
          slideNumber: 2,
          slideIndex: 1,
        },
        {
          app: "slides-2",
          view: "editor",
          deckId: "deck-1",
          slideId: "slide-2",
          slideNumber: 2,
          slideIndex: 1,
        },
      ]);
    });

    expect(appStateWrites().map(({ url }) => url)).toEqual(
      expect.arrayContaining([
        "/_agent-native/application-state/slides-2:navigation:template-navigation-test",
        "/_agent-native/application-state/navigation",
      ]),
    );
  });

  it("publishes the presenter console view from its route", async () => {
    render(
      <MemoryRouter
        initialEntries={["/deck/deck-1/present?view=presenter&slide=2"]}
      >
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(writes()).toContainEqual(
        expect.objectContaining({
          app: "slides-2",
          view: "presenter",
          deckId: "deck-1",
          slideNumber: 2,
          slideIndex: 1,
        }),
      ),
    );
  });

  it("keeps the projection route classified as present", async () => {
    render(
      <MemoryRouter initialEntries={["/deck/deck-1/present?slide=2"]}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(writes()).toContainEqual(
        expect.objectContaining({
          app: "slides-2",
          view: "present",
          deckId: "deck-1",
          slideNumber: 2,
          slideIndex: 1,
        }),
      ),
    );
  });

  it("clears editor panel state when the route changes to presenter", async () => {
    render(
      <MemoryRouter initialEntries={["/deck/deck-1?p=2"]}>
        <Harness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Present" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "/deck/deck-1/present?slide=2",
      ),
    );
    await waitFor(() =>
      expect(appStateWrites()).toContainEqual({
        url: "/_agent-native/application-state/slides-2:slides-panels:template-navigation-test",
        state: { layersOpen: false, animationsOpen: false },
      }),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/_agent-native/application-state/slides-2:slides-open-panel:template-navigation-test",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("clears canvas selection when the route changes from editor to Home", async () => {
    render(
      <MemoryRouter initialEntries={["/deck/deck-1?p=2"]}>
        <Harness />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Close preview" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("/home"),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/_agent-native/application-state/slides-2:slides-selection:template-navigation-test",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
