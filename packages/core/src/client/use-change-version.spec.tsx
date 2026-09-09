// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetChangeVersionStoreForTests,
  bumpChangeVersion,
  getChangeVersion,
  useChangeVersion,
  useChangeVersions,
} from "./use-change-version.js";

const MAX_TRACKED_SOURCES = 1_000;

describe("use-change-version", () => {
  let roots: Root[] = [];
  let containers: HTMLDivElement[] = [];

  beforeEach(() => {
    _resetChangeVersionStoreForTests();
    roots = [];
    containers = [];
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const container of containers) container.remove();
    _resetChangeVersionStoreForTests();
  });

  it("bounds retention of dynamic source keys", () => {
    bumpChangeVersion("dynamic-0", 1);
    for (let index = 1; index <= MAX_TRACKED_SOURCES; index++) {
      bumpChangeVersion(`dynamic-${index}`, 1);
    }

    expect(getChangeVersion("dynamic-0")).toBe(0);
    expect(getChangeVersion(`dynamic-${MAX_TRACKED_SOURCES}`)).toBe(1);
  });

  it("does not evict a source while a component is subscribed", async () => {
    function Probe() {
      useChangeVersion("active");
      return null;
    }

    const container = document.createElement("div");
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<Probe />));
    bumpChangeVersion("active", 7);
    for (let index = 0; index <= MAX_TRACKED_SOURCES; index++) {
      bumpChangeVersion(`other-${index}`, 1);
    }

    expect(getChangeVersion("active")).toBe(7);
  });

  it("advances single and multi-source hook snapshots", async () => {
    const values: Array<[number, number]> = [];
    function Probe() {
      values.push([
        useChangeVersion("projects"),
        useChangeVersions(["projects", "action"]),
      ]);
      return null;
    }

    const container = document.createElement("div");
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<Probe />));
    expect(values.at(-1)).toEqual([0, 0]);

    await act(async () => {
      bumpChangeVersion("projects", 3);
      bumpChangeVersion("action", 2);
    });
    expect(values.at(-1)).toEqual([3, 5]);
  });

  it("keeps subscriptions and snapshots stable across no-op rerenders", async () => {
    let renders = 0;
    function Probe({ tick }: { tick: number }) {
      renders++;
      useChangeVersion("projects");
      return <span>{tick}</span>;
    }

    const container = document.createElement("div");
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<Probe tick={0} />));
    await act(async () => root.render(<Probe tick={1} />));
    expect(renders).toBe(2);

    await act(async () => bumpChangeVersion("projects", 1));
    expect(renders).toBe(3);
  });

  it("uses the preserved zero snapshot during SSR", () => {
    bumpChangeVersion("projects", 4);

    function Probe() {
      return <>{useChangeVersion("projects")}</>;
    }

    expect(renderToString(<Probe />)).toContain("0");
  });
});
