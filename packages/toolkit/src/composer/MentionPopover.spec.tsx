// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MentionPopover } from "./MentionPopover.js";
import type { MentionItem } from "./types.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

const items: MentionItem[] = [
  {
    id: "member:alice",
    label: "Alice",
    source: "host",
    refType: "member",
    section: "People",
  },
  {
    id: "ai:claude",
    label: "Claude Haiku 5.5",
    source: "host",
    refType: "ai",
    section: "Agents",
  },
];

function rowLabels(keepSectionOrder: boolean) {
  act(() => {
    root.render(
      <MentionPopover
        type="@"
        position={{ top: 400, left: 0, width: 320 }}
        mentionItems={items}
        skills={[]}
        isLoading={false}
        query=""
        onSelectMention={() => undefined}
        onSelectSkill={() => undefined}
        onClose={() => undefined}
        keepSectionOrder={keepSectionOrder}
      />,
    );
  });
  return [...document.querySelectorAll("[data-mention-index]")].map(
    (row) => row.textContent,
  );
}

describe("mention sections", () => {
  it("puts the default search's agents first", () => {
    expect(rowLabels(false)).toEqual(["Claude Haiku 5.5", "Alice"]);
  });

  it("keeps a host's own order, even for a section named Agents", () => {
    expect(rowLabels(true)).toEqual(["Alice", "Claude Haiku 5.5"]);
  });
});
