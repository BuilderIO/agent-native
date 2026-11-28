// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import ViewRoute from "./$view";
import ThreadRoute from "./$view.$threadId";

vi.mock("@/pages/InboxPage", () => ({
  InboxPage: () => <p>mail list</p>,
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
        <Route path="/:view" element={<ViewRoute />}>
          <Route path=":threadId" element={<ThreadRoute />} />
        </Route>
      </Routes>
      <CurrentUrl />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("old Unread and Starred links", () => {
  it.each([
    ["/unread", "/inbox?r=unread:is_checked"],
    ["/starred", "/all?r=starred:is_checked"],
    [
      "/unread?accountEmail=a%40example.com",
      "/inbox?accountEmail=a%40example.com&r=unread:is_checked",
    ],
    ["/starred/thread-1", "/all/thread-1?r=starred:is_checked"],
    ["/unread/thread-1?q=hi", "/inbox/thread-1?q=hi&r=unread:is_checked"],
  ])("opens %s as the filtered list it became", async (from, to) => {
    renderAt(from);
    expect(await screen.findByText(to)).toBeTruthy();
    expect(screen.getByText("mail list")).toBeTruthy();
  });

  it("leaves other views where they are", () => {
    renderAt("/sent/thread-1");
    expect(screen.getByText("/sent/thread-1")).toBeTruthy();
    expect(screen.getByText("mail list")).toBeTruthy();
  });
});
