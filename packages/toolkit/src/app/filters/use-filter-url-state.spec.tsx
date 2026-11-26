// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addFilterRule,
  createFilterRule,
  createFilterState,
  type FilterField,
} from "./model.js";
import { filterStateKey } from "./url.js";
import {
  useFilterUrlState,
  type FilterUrlState,
} from "./use-filter-url-state.js";

const ownerField: FilterField = {
  id: "owner",
  label: "Made by",
  type: "person",
  options: [
    { id: "alice", label: "Alice" },
    { id: "bob", label: "Bob" },
  ],
};

const fields = [ownerField];

let container: HTMLDivElement;
let root: Root;
let filters: FilterUrlState;
let publish: (search: string) => void;
let requests: { search: string; replace: boolean }[];

function Harness({ initial }: { initial: string }) {
  const [search, setSearch] = useState(initial);
  publish = setSearch;
  filters = useFilterUrlState({
    fields,
    search,
    onSearchChange: (next, options) => {
      requests.push({ search: next, replace: options.replace });
    },
  });
  return null;
}

function owners(...ids: string[]) {
  return addFilterRule(
    createFilterState(fields),
    createFilterRule(ownerField, ids),
  );
}

function shownKey() {
  return filterStateKey(filters.state, fields);
}

beforeEach(() => {
  requests = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useFilterUrlState", () => {
  it("writes each change to the URL once", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    expect(requests).toEqual([]);
    act(() => filters.setState(owners("alice", "bob")));
    expect(requests).toEqual([
      { search: "?r=owner:equals:alice,bob", replace: false },
    ]);
  });

  it("follows the URL when it changes from outside", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => publish("?r=owner:equals:bob"));
    expect(shownKey()).toBe("?r=owner:equals:bob");
    expect(requests).toEqual([]);
  });

  it("waits for a navigation to land before writing the next change", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => filters.setState(owners("bob")));
    expect(requests.map((request) => request.search)).toEqual([
      "?r=owner:equals:alice,bob",
    ]);
    act(() => publish("?r=owner:equals:alice,bob"));
    expect(requests.map((request) => request.search)).toEqual([
      "?r=owner:equals:alice,bob",
      "?r=owner:equals:bob",
    ]);
    act(() => publish("?r=owner:equals:bob"));
    expect(shownKey()).toBe("?r=owner:equals:bob");
    expect(requests).toHaveLength(2);
  });

  it("keeps a newer change when an earlier navigation lands late", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => filters.setState(owners("bob")));
    act(() => publish("?r=owner:equals:alice,bob"));
    expect(shownKey()).toBe("?r=owner:equals:bob");
    act(() => publish("?r=owner:equals:bob"));
    expect(shownKey()).toBe("?r=owner:equals:bob");
    expect(requests).toHaveLength(2);
  });

  it("writes nothing more when changes return to the one in flight", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => filters.setState(owners("alice")));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => publish("?r=owner:equals:alice,bob"));
    expect(shownKey()).toBe("?r=owner:equals:alice,bob");
    expect(requests).toEqual([
      { search: "?r=owner:equals:alice,bob", replace: false },
    ]);
  });

  it("follows an outside navigation that lands before its own write", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => filters.setState(owners("alice")));
    act(() => publish("?r=owner:equals:bob"));
    expect(shownKey()).toBe("?r=owner:equals:bob");
    expect(requests).toHaveLength(1);
  });

  it("follows its own write when it lands after an outside navigation", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => publish("?r=owner:equals:bob"));
    expect(shownKey()).toBe("?r=owner:equals:bob");
    act(() => publish("?r=owner:equals:alice,bob"));
    expect(shownKey()).toBe("?r=owner:equals:alice,bob");
    expect(requests).toHaveLength(1);
  });

  it("follows Back after a repeated change", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => filters.setState(owners("alice")));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => publish("?r=owner:equals:alice,bob"));
    act(() => publish("?r=owner:equals:alice"));
    expect(shownKey()).toBe("?r=owner:equals:alice");
    expect(requests).toHaveLength(1);
  });

  it("keeps the newest change when repeated writes land one by one", () => {
    act(() => root.render(<Harness initial="?r=owner:equals:alice" />));
    act(() => filters.setState(owners("alice", "bob")));
    act(() => filters.setState(owners("alice")));
    act(() => publish("?r=owner:equals:alice,bob"));
    expect(shownKey()).toBe("?r=owner:equals:alice");
    act(() => filters.setState(owners("alice", "bob")));
    act(() => publish("?r=owner:equals:alice"));
    expect(shownKey()).toBe("?r=owner:equals:alice,bob");
    act(() => publish("?r=owner:equals:alice,bob"));
    expect(shownKey()).toBe("?r=owner:equals:alice,bob");
    expect(requests.map((request) => request.search)).toEqual([
      "?r=owner:equals:alice,bob",
      "?r=owner:equals:alice",
      "?r=owner:equals:alice,bob",
    ]);
    act(() => publish("?r=owner:equals:alice"));
    expect(shownKey()).toBe("?r=owner:equals:alice");
    expect(requests).toHaveLength(3);
  });
});
