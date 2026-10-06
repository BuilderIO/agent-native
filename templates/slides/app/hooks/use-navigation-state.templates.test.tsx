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
  cache: vi.fn(),
  fetch: vi.fn(),
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
  resolveDeckFilter: () => "mine",
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
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.command = null;
  mocks.fetch.mockResolvedValue({ ok: true });
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

describe("template navigation parity", () => {
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
        view: "list",
        deckFilter: "created-by-me",
        templateId: "starter-update",
      }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Close preview" }));
    await waitFor(() =>
      expect(writes().at(-1)).toEqual({
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
});
