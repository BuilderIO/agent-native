// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import ViewRoute from "./$view";
import DraftQueueRoute from "./draft-queue";
import DraftQueueDetailRoute from "./draft-queue.$id";

vi.mock("@/pages/InboxPage", () => ({
  InboxPage: () => <p>mail list</p>,
}));
vi.mock("@/pages/DraftQueuePage", () => ({
  DraftQueuePage: () => <p>review page</p>,
}));
vi.mock("@/pages/NotFound", () => ({
  NotFound: () => <p>not found</p>,
}));

function CurrentUrl() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/:view" element={<ViewRoute />} />
        <Route path="/draft-queue" element={<DraftQueueRoute />}>
          <Route path=":id" element={<DraftQueueDetailRoute />} />
        </Route>
      </Routes>
      <CurrentUrl />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("old Scheduled and Draft queue links", () => {
  it("opens Drafts from Scheduled, keeping the query", async () => {
    renderAt("/scheduled?q=pricing");
    expect(await screen.findByText("/drafts?q=pricing")).toBeTruthy();
    expect(screen.getByText("mail list")).toBeTruthy();
  });

  it("opens Drafts from the bare Draft queue", async () => {
    renderAt("/draft-queue");
    expect(await screen.findByText("/drafts")).toBeTruthy();
    expect(screen.getByText("mail list")).toBeTruthy();
  });

  it.each([
    "/draft-queue/qd_1",
    "/draft-queue?id=qd_1",
    "/draft-queue?scope=requested",
  ])("keeps %s on the review page", (url) => {
    renderAt(url);
    expect(screen.getByText(url)).toBeTruthy();
    expect(screen.getByText("review page")).toBeTruthy();
  });
});
