// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChapterList } from "./chapter-list";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const editsWithCut = JSON.stringify({
  version: 1,
  trims: [{ startMs: 10_000, endMs: 20_000, excluded: true }],
  blurs: [],
});

const chapters = [
  { startMs: 0, title: "Intro" },
  { startMs: 15_000, title: "Cut away" },
  { startMs: 65_000, title: "Demo" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(element: React.ReactElement) {
  act(() => root.render(element));
}

function rows() {
  return Array.from(container.querySelectorAll("li button")).map(
    (button) => button.textContent,
  );
}

describe("ChapterList", () => {
  it("shows times as the trimmed player does and leaves out chapters in a cut", () => {
    render(
      <ChapterList
        chapters={chapters}
        editsJson={editsWithCut}
        onSeek={() => {}}
      />,
    );
    expect(container.querySelector("h3")?.textContent).toBe("chapters.title");
    expect(rows()).toEqual(["0:00 Intro", "0:55 Demo"]);
  });

  it("seeks to the chapter's stored time when a row is clicked", () => {
    const onSeek = vi.fn();
    render(
      <ChapterList
        chapters={chapters}
        editsJson={editsWithCut}
        onSeek={onSeek}
      />,
    );
    const demo = container.querySelectorAll<HTMLButtonElement>("li button")[1];
    act(() => demo.click());
    expect(onSeek).toHaveBeenCalledWith(65_000);
  });

  it("renders nothing without chapters", () => {
    render(<ChapterList chapters={[]} editsJson={null} onSeek={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when every chapter falls inside a cut", () => {
    render(
      <ChapterList
        chapters={[{ startMs: 12_000, title: "Hidden" }]}
        editsJson={editsWithCut}
        onSeek={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
