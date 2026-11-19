// @vitest-environment happy-dom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MentionPopover, type MentionPopoverRef } from "./MentionPopover.js";
import { ComposerRuntimeAdaptersProvider } from "./runtime-adapters.js";
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

describe("listbox semantics", () => {
  it("exposes the rows as options and reports the highlighted one", () => {
    const popover = createRef<MentionPopoverRef>();
    const onActiveOptionChange = vi.fn();
    act(() => {
      root.render(
        <MentionPopover
          ref={popover}
          type="@"
          position={{ top: 400, left: 0, width: 320 }}
          mentionItems={items}
          skills={[]}
          isLoading={false}
          query=""
          onSelectMention={() => undefined}
          onSelectSkill={() => undefined}
          onClose={() => undefined}
          listboxId="mentions"
          onActiveOptionChange={onActiveOptionChange}
        />,
      );
    });
    const listbox = document.getElementById("mentions");
    expect(listbox?.getAttribute("role")).toBe("listbox");
    expect(listbox?.getAttribute("aria-label")).toBe("Add context");
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.id)).toEqual([
      "mentions-option-0",
      "mentions-option-1",
    ]);
    expect(
      options.map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["true", "false"]);
    const group = options[0]?.closest('[role="group"]');
    expect(
      document.getElementById(group?.getAttribute("aria-labelledby") ?? "")
        ?.textContent,
    ).toBe("Agents");
    expect(onActiveOptionChange).toHaveBeenLastCalledWith("mentions-option-0");

    act(() => popover.current?.moveDown());
    expect(onActiveOptionChange).toHaveBeenLastCalledWith("mentions-option-1");
    expect(
      document
        .getElementById("mentions-option-1")
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    act(() => root.render(<></>));
    expect(onActiveOptionChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("provider section names", () => {
  it("translates a provider label that is a catalog key and keeps a plain one", () => {
    const providerItems: MentionItem[] = [
      {
        id: "chat:1",
        label: "Planning chat",
        source: "chats",
        refType: "chat",
        section: "composerSources.group",
      },
      {
        id: "mail:1",
        label: "Weekly digest",
        source: "mail",
        refType: "email",
        section: "Emails",
      },
    ];
    act(() => {
      root.render(
        <ComposerRuntimeAdaptersProvider
          adapters={{
            translate: (key, options) =>
              key === "composerSources.group"
                ? "Conversations"
                : String(options?.defaultValue ?? key),
          }}
        >
          <MentionPopover
            type="@"
            position={{ top: 400, left: 0, width: 320 }}
            mentionItems={providerItems}
            skills={[]}
            isLoading={false}
            query=""
            onSelectMention={() => undefined}
            onSelectSkill={() => undefined}
            onClose={() => undefined}
            keepSectionOrder
          />
        </ComposerRuntimeAdaptersProvider>,
      );
    });
    const headers = [...document.querySelectorAll('[role="group"]')].map(
      (group) =>
        document.getElementById(group.getAttribute("aria-labelledby") ?? "")
          ?.textContent,
    );
    expect(headers).toEqual(["Conversations", "Emails"]);
  });
});
