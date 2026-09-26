import { useHeaderActions } from "@agent-native/toolkit/app-shell";
// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createPortal } from "react-dom";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomeLayout from "./home-layout";

const mocks = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock("@/pages/Index", async () => {
  const React = await import("react");
  const { useSetHeaderActions } =
    await import("@agent-native/toolkit/app-shell");

  return {
    default: function MockHome({ active }: { active: boolean }) {
      const [draft, setDraft] = React.useState("");
      const [portalOpen, setPortalOpen] = React.useState(false);
      useSetHeaderActions(active ? <span>home actions</span> : null);
      React.useEffect(() => {
        mocks.mounts += 1;
        return () => {
          mocks.unmounts += 1;
        };
      }, []);
      React.useEffect(() => {
        if (!active) setPortalOpen(false);
      }, [active]);

      return (
        <>
          <input
            aria-label="Home draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="button" onClick={() => setPortalOpen(true)}>
            Open Home portal
          </button>
          {active && portalOpen
            ? createPortal(
                <div role="dialog" aria-label="Home-owned portal" />,
                document.body,
              )
            : null}
        </>
      );
    },
  };
});

function HomeRoute() {
  return <Link to="/templates">Open templates</Link>;
}

function TemplatesRoute() {
  return (
    <>
      <h1>Templates</h1>
      <Link to="/home">Back to decks</Link>
    </>
  );
}

function HeaderActionsStatus() {
  return (
    <output data-testid="header-actions">
      {useHeaderActions() ? "home actions" : "no actions"}
    </output>
  );
}

function App({ initialEntry }: { initialEntry: string }) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <HeaderActionsStatus />
      <Routes>
        <Route element={<HomeLayout />}>
          <Route path="/home" element={<HomeRoute />} />
          <Route path="/templates" element={<TemplatesRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mocks.mounts = 0;
  mocks.unmounts = 0;
});

afterEach(cleanup);

describe("persistent home route layout", () => {
  it("preserves home state and closes home portals while templates is active", async () => {
    render(<App initialEntry="/home" />);
    const draft = screen.getByLabelText("Home draft");
    fireEvent.change(draft, { target: { value: "reference attached" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Home portal" }));
    expect(
      screen.getByRole("dialog", { name: "Home-owned portal" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Open templates" }));

    expect(screen.getByRole("heading", { name: "Templates" })).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Home-owned portal" }),
    ).toBeNull();
    expect((draft as HTMLInputElement).value).toBe("reference attached");
    expect(draft.parentElement?.hasAttribute("hidden")).toBe(true);
    expect(mocks.mounts).toBe(1);
    expect(mocks.unmounts).toBe(0);
    await waitFor(() =>
      expect(screen.getByTestId("header-actions").textContent).toBe(
        "no actions",
      ),
    );

    fireEvent.click(screen.getByRole("link", { name: "Back to decks" }));

    expect(
      (screen.getByLabelText("Home draft") as HTMLInputElement).value,
    ).toBe("reference attached");
    expect(
      screen.queryByRole("dialog", { name: "Home-owned portal" }),
    ).toBeNull();
    expect(mocks.mounts).toBe(1);
    expect(mocks.unmounts).toBe(0);
    await waitFor(() =>
      expect(screen.getByTestId("header-actions").textContent).toBe(
        "home actions",
      ),
    );
  });

  it("does not mount the home page for a direct templates visit", () => {
    render(<App initialEntry="/templates" />);

    expect(screen.getByRole("heading", { name: "Templates" })).toBeTruthy();
    expect(screen.queryByLabelText("Home draft")).toBeNull();
    expect(mocks.mounts).toBe(0);
  });

  it("mounts home when the route has a trailing slash or case variant", () => {
    render(<App initialEntry="/HOME/" />);

    expect(screen.getByLabelText("Home draft")).toBeTruthy();
    expect(mocks.mounts).toBe(1);
  });
});
