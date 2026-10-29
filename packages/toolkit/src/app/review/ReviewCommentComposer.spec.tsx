// @vitest-environment happy-dom

import type { ReviewMention } from "@agent-native/core/review/types";
import type { Editor } from "@tiptap/core";
import { act, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewCommentComposer } from "./ReviewCommentComposer.js";

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

const alice = { label: "Alice", email: "alice@example.com" };
const bob = { label: "Bob", email: "bob@example.com" };
const claude = {
  label: "Claude Sonnet 5.5",
  email: null,
  id: "agent:claude:claude-sonnet-5.5",
  description: "Anthropic",
};

describe("ReviewCommentComposer", () => {
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
    vi.unstubAllGlobals();
  });

  async function render(node: React.ReactNode) {
    await act(async () => root.render(node));
    await act(async () => {});
  }

  function editorDom(): HTMLElement & { editor: Editor } {
    const dom = container.querySelector<HTMLElement & { editor: Editor }>(
      ".ProseMirror",
    );
    if (!dom) throw new Error("editor not mounted");
    return dom;
  }

  function typeText(text: string) {
    act(() => {
      const { state, view } = editorDom().editor;
      view.dispatch(state.tr.insertText(text));
    });
  }

  function placeCaret(position: number, to = position) {
    act(() => {
      editorDom().editor.commands.setTextSelection({ from: position, to });
    });
  }

  function keydown(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      editorDom().dispatchEvent(event);
    });
    return event;
  }

  function mentionOptionElements() {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    );
  }

  function mentionOptionLabels() {
    return mentionOptionElements().map((item) => item.textContent ?? "");
  }

  function mentionOption(name: string) {
    const option = mentionOptionElements().find((item) =>
      item.textContent?.includes(name),
    );
    if (!option) throw new Error(`no mention option for ${name}`);
    return option;
  }

  function mentionListbox() {
    return document.querySelector<HTMLElement>('[role="listbox"]');
  }

  function liveRegion() {
    const region = container.querySelector<HTMLElement>('[role="status"]');
    if (!region) throw new Error("live region not mounted");
    return region;
  }

  function focusEditor() {
    act(() => {
      editorDom().editor.view.focus();
    });
    expect(document.activeElement).toBe(editorDom());
  }

  function Harness(
    props: Partial<ComponentProps<typeof ReviewCommentComposer>> & {
      initialValue?: string;
      initialMentions?: ReviewMention[];
      onState?: (state: { value: string; mentions: ReviewMention[] }) => void;
    },
  ) {
    const { initialValue = "", initialMentions = [], onState, ...rest } = props;
    const [value, setValue] = useState(initialValue);
    const [mentions, setMentions] = useState<ReviewMention[]>(initialMentions);
    onState?.({ value, mentions });
    return (
      <ReviewCommentComposer
        value={value}
        onChange={setValue}
        mentions={mentions}
        onMentionsChange={setMentions}
        mentionOptions={[alice, bob]}
        onSubmit={() => {}}
        {...rest}
      />
    );
  }

  it("renders a rich editor instead of a textarea", async () => {
    await render(
      <ReviewCommentComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Write something"
        textareaProps={{ "data-review-reply-input": true }}
      />,
    );
    expect(container.querySelector("textarea")).toBeNull();
    const dom = editorDom();
    expect(dom.getAttribute("role")).toBe("textbox");
    expect(dom.getAttribute("aria-label")).toBe("Write something");
    expect(dom.hasAttribute("data-review-reply-input")).toBe(true);
    expect(
      container
        .querySelector("p.is-editor-empty")
        ?.getAttribute("data-placeholder"),
    ).toBe("Write something");
  });

  it("keeps the reply variant collapsed until it is focused", async () => {
    await render(
      <ReviewCommentComposer
        variant="reply"
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        showCommentTools
        mentionOptions={[alice]}
      />,
    );
    const field = container.querySelector("[data-review-composer-field]");
    expect(field?.hasAttribute("data-expanded")).toBe(false);
    expect(container.querySelector("[data-review-comment-tools]")).toBeNull();
    expect(
      container
        .querySelector("p.is-editor-empty")
        ?.getAttribute("data-placeholder"),
    ).toBe("Reply");
    const collapsedSend = container.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(collapsedSend?.disabled).toBe(true);

    act(() => {
      editorDom().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(field?.hasAttribute("data-expanded")).toBe(true);
    expect(
      container.querySelector(
        '[data-review-comment-tools] [aria-label="Add emoji"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-review-comment-tools] [aria-label="Mention someone"]',
      ),
    ).not.toBeNull();
  });

  it("stays expanded while the reply has content", async () => {
    await render(
      <ReviewCommentComposer
        variant="reply"
        value="Already typed"
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(
      container
        .querySelector("[data-review-composer-field]")
        ?.hasAttribute("data-expanded"),
    ).toBe(true);
  });

  it("disables send until there is content", async () => {
    await render(
      <ReviewCommentComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(true);
    await render(
      <ReviewCommentComposer
        value="Looks good"
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
  });

  it("can expose only a dedicated agent action", async () => {
    const onSubmit = vi.fn();
    await render(
      <ReviewCommentComposer
        value="Make the heading concise"
        onChange={() => {}}
        onSubmit={onSubmit}
        showCommentAction={false}
        showAgentAction
        agentLabel="Edit with AI"
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    const editWithAi = buttons.find(
      (button) => button.textContent?.trim() === "Edit with AI",
    );
    expect(editWithAi).toBeTruthy();
    act(() => editWithAi?.click());
    expect(onSubmit).toHaveBeenCalledWith("agent");
  });

  it("hides the agent action unless a consumer asks for it", async () => {
    await render(
      <ReviewCommentComposer
        value="Looks good"
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(container.textContent).not.toContain("Send to agent");

    await render(
      <ReviewCommentComposer
        value="Looks good"
        onChange={() => {}}
        onSubmit={() => {}}
        agentAction={<button type="button">Ask the agent</button>}
      />,
    );
    expect(container.textContent).toContain("Ask the agent");
    expect(container.textContent).not.toContain("Send to agent");

    await render(
      <ReviewCommentComposer
        value="Looks good"
        onChange={() => {}}
        onSubmit={() => {}}
        showAgentAction={false}
        agentAction={<button type="button">Ask the agent</button>}
      />,
    );
    expect(container.textContent).not.toContain("Ask the agent");
  });

  it("routes implicit submission to the visible agent action", async () => {
    const onSubmit = vi.fn();
    await render(
      <ReviewCommentComposer
        value="Make the heading concise"
        onChange={() => {}}
        onSubmit={onSubmit}
        showCommentAction={false}
        showAgentAction
        submitOnEnter
      />,
    );
    const event = keydown("Enter");
    expect(event.defaultPrevented).toBe(true);
    act(() => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenNthCalledWith(1, "agent");
    expect(onSubmit).toHaveBeenNthCalledWith(2, "agent");
  });

  it("puts attachments above the toolbar and tools-end inside the tools", async () => {
    await render(
      <ReviewCommentComposer
        value="A useful reply"
        onChange={() => {}}
        onSubmit={() => {}}
        showCommentTools
        mentionOptions={[alice]}
        commentToolsEnd={<span data-review-tools-end />}
        attachments={<span data-review-attachments-slot />}
      />,
    );
    const tools = container.querySelector<HTMLElement>(
      "[data-review-comment-tools]",
    );
    const trailingTools = container.querySelector<HTMLElement>(
      "[data-review-comment-tools-end]",
    );
    expect(trailingTools?.parentElement).toBe(tools);
    expect(
      trailingTools?.previousElementSibling?.getAttribute("aria-label"),
    ).toBe("Mention someone");
    expect(tools?.querySelector('[aria-label="Add emoji"]')).not.toBeNull();
    expect(
      container.querySelector('button[type="submit"]')?.parentElement,
    ).not.toBe(tools);
    const attachments = container.querySelector(
      "[data-review-attachments-slot]",
    );
    expect(
      attachments!.compareDocumentPosition(tools!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("inserts an emoji into the text", async () => {
    let state: { value: string } = { value: "" };
    await render(
      <Harness showCommentTools onState={(next) => (state = next)} />,
    );
    const emojiButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add emoji"]',
    );
    await act(async () => {
      emojiButton!.dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      );
      emojiButton!.click();
    });
    const party = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("🎉"));
    expect(party).toBeTruthy();
    await act(async () => party?.click());
    expect(state.value).toBe("🎉");
  });

  it("marks the portaled emoji menu as review UI", async () => {
    await render(<Harness showCommentTools />);
    const emojiButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add emoji"]',
    );
    await act(async () => {
      emojiButton!.dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      );
      emojiButton!.click();
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.hasAttribute("data-review-popover")).toBe(true);
    expect(container.contains(menu)).toBe(false);
  });

  it("marks the portaled mention picker as review UI", async () => {
    await render(<Harness />);
    keydown("@");
    await act(async () => {});
    const listbox = mentionListbox();
    expect(listbox?.hasAttribute("data-review-popover")).toBe(true);
    expect(container.contains(listbox)).toBe(false);
  });

  it("submits the same plain string a textarea would, without a mention", async () => {
    const onSubmit = vi.fn();
    let state = { value: "", mentions: [] as ReviewMention[] };
    await render(
      <Harness
        submitOnEnter
        onSubmit={onSubmit}
        onState={(next) => (state = next)}
      />,
    );
    typeText("Hello");
    const shiftEnter = keydown("Enter", { shiftKey: true });
    expect(shiftEnter.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    typeText("world");
    expect(state.value).toBe("Hello\nworld");

    keydown("Enter");
    expect(onSubmit).toHaveBeenCalledWith("human");
    expect(state).toEqual({ value: "Hello\nworld", mentions: [] });
  });

  it("opens the picker above the field on @ and picks with the keyboard", async () => {
    const onSubmit = vi.fn();
    let state = { value: "", mentions: [] as ReviewMention[] };
    await render(
      <Harness
        submitOnEnter
        onSubmit={onSubmit}
        onState={(next) => (state = next)}
      />,
    );
    typeText("Hey ");
    const atKey = keydown("@");
    expect(atKey.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(state.value).toBe("Hey @");
    const options = mentionOptionLabels();
    expect(options).toHaveLength(2);
    expect(options[0]).toContain("alice@example.com");
    expect(options[1]).toContain("bob@example.com");
    expect(mentionListbox()?.getAttribute("data-side")).toBe("top");

    keydown("ArrowDown");
    expect(
      document.querySelector("[data-review-mention-option][data-active]")
        ?.textContent,
    ).toContain("Bob");
    keydown("Enter");
    await act(async () => {});

    expect(onSubmit).not.toHaveBeenCalled();
    expect(state.value).toBe("Hey @Bob");
    expect(state.mentions).toEqual([bob]);
    expect(
      container.querySelector("[data-review-mention-chip]")?.textContent,
    ).toBe("@Bob");
    expect(mentionListbox()).toBeNull();

    typeText(" thanks");
    keydown("Enter");
    expect(onSubmit).toHaveBeenCalledWith("human");
    expect(state.value).toBe("Hey @Bob thanks");
    expect(state.mentions).toEqual([bob]);
  });

  it("reports what follows the @ to the host, and an empty query once the picker closes", async () => {
    const onMentionQueryChange = vi.fn();
    await render(<Harness onMentionQueryChange={onMentionQueryChange} />);
    keydown("@");
    expect(onMentionQueryChange).not.toHaveBeenCalled();
    typeText("al");
    await act(async () => {});
    expect(onMentionQueryChange).toHaveBeenLastCalledWith("al");
    keydown("Escape");
    expect(onMentionQueryChange).toHaveBeenLastCalledWith("");
  });

  it("keeps the picker open, saying no one matched, when the host answers a query with no one", async () => {
    function SearchedHarness() {
      const [query, setQuery] = useState("");
      return (
        <Harness
          mentionOptions={query === "zzz" ? [] : [alice, bob]}
          onMentionQueryChange={setQuery}
        />
      );
    }
    await render(<SearchedHarness />);
    keydown("@");
    typeText("zzz");
    await act(async () => {});
    expect(mentionOptionLabels()).toEqual([]);
    expect(mentionListbox()).toBeNull();
    expect(document.body.textContent).toContain("No people found");
  });

  it("tells the host to drop its query when the composer goes away mid-search", async () => {
    const onMentionQueryChange = vi.fn();
    await render(<Harness onMentionQueryChange={onMentionQueryChange} />);
    keydown("@");
    typeText("al");
    await act(async () => {});
    onMentionQueryChange.mockClear();

    act(() => root.unmount());
    expect(onMentionQueryChange).toHaveBeenCalledTimes(1);
    expect(onMentionQueryChange).toHaveBeenCalledWith("");
    // The afterEach unmount must find a mounted root again.
    root = createRoot(container);
  });

  it("does not call the host on unmount when no search was open", async () => {
    const onMentionQueryChange = vi.fn();
    await render(<Harness onMentionQueryChange={onMentionQueryChange} />);
    keydown("@");
    await act(async () => {});
    onMentionQueryChange.mockClear();

    act(() => root.unmount());
    expect(onMentionQueryChange).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("says nothing about no one matching while the host is still searching", async () => {
    function SearchingHarness({ loading }: { loading: boolean }) {
      return (
        <Harness
          mentionOptions={[alice, bob]}
          mentionOptionsLoading={loading}
          onMentionQueryChange={() => {}}
        />
      );
    }
    await render(<SearchingHarness loading />);
    keydown("@");
    typeText("zzz");
    await act(async () => {});
    expect(mentionListbox()).toBeNull();
    expect(document.body.textContent).not.toContain("No people found");

    await render(<SearchingHarness loading={false} />);
    expect(document.body.textContent).toContain("No people found");
  });

  it("shows matches the host's stale list already has while it searches", async () => {
    await render(
      <Harness
        mentionOptions={[alice, bob]}
        mentionOptionsLoading
        onMentionQueryChange={() => {}}
      />,
    );
    keydown("@");
    typeText("ali");
    await act(async () => {});
    expect(mentionOptionLabels()).toHaveLength(1);
    expect(mentionOptionLabels()[0]).toContain("Alice");
  });

  it("does not open a picker for a bare @ when there is no one to offer", async () => {
    await render(
      <Harness mentionOptions={[]} onMentionQueryChange={vi.fn()} />,
    );
    keydown("@");
    await act(async () => {});
    expect(document.body.textContent).not.toContain("No people found");
  });

  it("filters the picker by what follows the @", async () => {
    await render(<Harness />);
    keydown("@");
    typeText("ali");
    await act(async () => {});
    expect(mentionOptionLabels()).toHaveLength(1);
    expect(mentionOptionLabels()[0]).toContain("Alice");
    typeText("zzz");
    await act(async () => {});
    expect(document.body.textContent).toContain("No people found");
  });

  it("moves the highlight across the Agents heading and inserts the agent", async () => {
    let state: { value: string; mentions: ReviewMention[] } = {
      value: "",
      mentions: [],
    };
    await render(
      <Harness
        mentionOptions={[alice, bob, claude]}
        onState={(next) => (state = next)}
      />,
    );
    keydown("@");
    await act(async () => {});
    expect(mentionListbox()?.textContent).toContain("Agents");
    keydown("ArrowDown");
    keydown("ArrowDown");
    expect(
      document.querySelector("[data-review-mention-option][data-active]")
        ?.textContent,
    ).toContain("Claude Sonnet 5.5");
    keydown("Enter");
    await act(async () => {});

    expect(state.value).toBe("@Claude Sonnet 5.5");
    // The description is picker-only; the stored mention keeps label/email/id.
    expect(state.mentions).toEqual([
      { label: "Claude Sonnet 5.5", email: null, id: claude.id },
    ]);
  });

  it("filters the picker by an agent's description", async () => {
    await render(<Harness mentionOptions={[alice, claude]} />);
    keydown("@");
    typeText("anthro");
    await act(async () => {});
    expect(mentionOptionLabels()).toHaveLength(1);
    expect(mentionOptionLabels()[0]).toContain("Claude Sonnet 5.5");
  });

  it("renders the agents heading with the label it is given", async () => {
    await render(
      <Harness mentionOptions={[alice, claude]} agentsLabel="Agenten" />,
    );
    keydown("@");
    await act(async () => {});
    expect(mentionListbox()?.textContent).toContain("Agenten");
  });

  it("closes the picker on Escape before it cancels the composer", async () => {
    const onEscape = vi.fn();
    const outsideEscape = vi.fn();
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") outsideEscape();
    };
    await render(<Harness onEscape={onEscape} />);
    window.addEventListener("keydown", onWindowKeyDown);
    try {
      keydown("@");
      await act(async () => {});
      expect(mentionListbox()).not.toBeNull();

      keydown("Escape");
      await act(async () => {});
      expect(mentionListbox()).toBeNull();
      expect(onEscape).not.toHaveBeenCalled();
      // Nothing outside the composer may read this Escape as "leave".
      expect(outsideEscape).not.toHaveBeenCalled();

      keydown("Escape");
      expect(onEscape).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", onWindowKeyDown);
    }
  });

  it("opens the picker from the toolbar button", async () => {
    let state = { value: "", mentions: [] as ReviewMention[] };
    await render(
      <Harness showCommentTools onState={(next) => (state = next)} />,
    );
    const mentionButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Mention someone"]',
    );
    expect(mentionButton).toBeTruthy();
    await act(async () => mentionButton!.click());
    await act(async () => {});
    expect(state.value).toBe("@");
    expect(mentionOptionLabels()).toHaveLength(2);
  });

  it("selects a mention with the pointer", async () => {
    let state = { value: "", mentions: [] as ReviewMention[] };
    await render(<Harness onState={(next) => (state = next)} />);
    keydown("@");
    await act(async () => {});
    await act(async () => mentionOption("Alice").click());
    expect(state.value).toBe("@Alice");
    expect(state.mentions).toEqual([alice]);
  });

  it("replaces the full typed mention token and submits only its metadata", async () => {
    let state = { value: "", mentions: [alice] as ReviewMention[] };
    await render(
      <Harness
        initialMentions={[alice]}
        showCommentTools
        onState={(next) => (state = next)}
      />,
    );
    keydown("@");
    typeText("ali");
    await act(async () => {});
    expect(mentionOptionLabels().some((label) => label.includes("Bob"))).toBe(
      false,
    );
    await act(async () => mentionOption("Alice").click());
    expect(state.value).toBe("@Alice");
    expect(state.mentions).toEqual([alice]);
  });

  it("drops a replaced mention from the metadata", async () => {
    let state = { value: "@Alice", mentions: [alice] as ReviewMention[] };
    await render(
      <Harness
        initialValue="@Alice"
        initialMentions={[alice]}
        showCommentTools
        onState={(next) => (state = next)}
      />,
    );
    expect(
      container.querySelector("[data-review-mention-chip]")?.textContent,
    ).toBe("@Alice");
    act(() => {
      editorDom().editor.commands.selectAll();
    });
    keydown("@");
    typeText("bo");
    await act(async () => {});
    await act(async () => mentionOption("Bob").click());
    expect(state.value).toBe("@Bob");
    expect(state.mentions).toEqual([bob]);
  });

  it("ignores composing @ keys and email address boundaries", async () => {
    const onChange = vi.fn();
    async function renderValue(value: string) {
      await render(
        <ReviewCommentComposer
          value={value}
          onChange={onChange}
          onSubmit={() => {}}
          mentionOptions={[alice]}
        />,
      );
    }
    async function atKeyAfter(value: string) {
      await renderValue(value);
      const end = editorDom().editor.state.doc.content.size - 1;
      placeCaret(end);
      return keydown("@");
    }

    await renderValue("");
    const composing = keydown("@", { isComposing: true });
    expect(composing.defaultPrevented).toBe(false);
    const legacyComposing = new KeyboardEvent("keydown", {
      key: "@",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(legacyComposing, "keyCode", { value: 229 });
    act(() => {
      editorDom().dispatchEvent(legacyComposing);
    });
    expect(legacyComposing.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    expect((await atKeyAfter("email")).defaultPrevented).toBe(false);
    expect((await atKeyAfter("café")).defaultPrevented).toBe(false);
    expect((await atKeyAfter("𝒜")).defaultPrevented).toBe(false);
    expect((await atKeyAfter("alice+")).defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    expect((await atKeyAfter("Hi,")).defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith("Hi,@");
  });

  it("follows an external value and renders known mentions as chips", async () => {
    await render(
      <ReviewCommentComposer
        value="Hi @Alice and @Alicia"
        mentions={[alice]}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    const chips = container.querySelectorAll("[data-review-mention-chip]");
    expect(chips).toHaveLength(1);
    expect(editorDom().textContent).toContain("@Alicia");

    await render(
      <ReviewCommentComposer
        value=""
        mentions={[]}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(
      container.querySelectorAll("[data-review-mention-chip]"),
    ).toHaveLength(0);
    expect(editorDom().textContent).toBe("");
  });

  describe("mention combobox", () => {
    // A `role="textbox"` does not allow these, and axe reports them as critical.
    function expectTextboxOmitsPopupState(dom: HTMLElement) {
      expect(dom.hasAttribute("aria-expanded")).toBe(false);
      expect(dom.hasAttribute("aria-haspopup")).toBe(false);
    }

    it("tells assistive technology about the list on the editor itself", async () => {
      await render(<Harness />);
      const dom = editorDom();
      expect(dom.getAttribute("role")).toBe("textbox");
      expect(dom.getAttribute("aria-autocomplete")).toBe("list");
      expectTextboxOmitsPopupState(dom);
      expect(dom.hasAttribute("aria-controls")).toBe(false);
      expect(dom.hasAttribute("aria-activedescendant")).toBe(false);

      focusEditor();
      keydown("@");
      await act(async () => {});
      const listbox = mentionListbox();
      expect(listbox).not.toBeNull();
      expect(listbox?.getAttribute("aria-label")).toBe("Mention someone");
      expect(dom.getAttribute("aria-autocomplete")).toBe("list");
      expectTextboxOmitsPopupState(dom);
      expect(dom.getAttribute("aria-controls")).toBe(listbox?.id);
      expect(document.getElementById(listbox?.id ?? "")).toBe(listbox);

      const options = mentionOptionElements();
      const ids = options.map((option) => option.id);
      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(options.length);
      for (const option of options) {
        expect(listbox?.contains(option)).toBe(true);
      }
      expect(dom.getAttribute("aria-activedescendant")).toBe(ids[0]);
      expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
        "true",
        "false",
      ]);

      keydown("ArrowDown");
      expect(dom.getAttribute("aria-activedescendant")).toBe(ids[1]);
      expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
        "false",
        "true",
      ]);
      keydown("ArrowDown");
      expect(dom.getAttribute("aria-activedescendant")).toBe(ids[0]);
      keydown("ArrowUp");
      expect(dom.getAttribute("aria-activedescendant")).toBe(ids[1]);

      keydown("Escape");
      await act(async () => {});
      expectTextboxOmitsPopupState(dom);
      expect(dom.hasAttribute("aria-controls")).toBe(false);
      expect(dom.hasAttribute("aria-activedescendant")).toBe(false);
    });

    it("leaves the editor a plain textbox when there is nobody to mention", async () => {
      await render(<Harness mentionOptions={[]} />);
      const dom = editorDom();
      expect(dom.getAttribute("role")).toBe("textbox");
      for (const name of [
        "aria-autocomplete",
        "aria-haspopup",
        "aria-expanded",
        "aria-controls",
        "aria-activedescendant",
      ]) {
        expect(dom.hasAttribute(name)).toBe(false);
      }
    });

    it("names the highlighted person without moving focus out of the editor", async () => {
      const focusTargets: EventTarget[] = [];
      const recordFocus = (event: Event) => {
        if (event.target) focusTargets.push(event.target);
      };
      await render(<Harness showCommentTools />);
      const dom = editorDom();
      focusEditor();
      document.addEventListener("focusin", recordFocus);
      try {
        keydown("@");
        await act(async () => {});
        // Anything deferred (a focus bounce through requestAnimationFrame, say)
        // has run by now.
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(mentionListbox()).not.toBeNull();
        expect(document.activeElement).toBe(dom);

        keydown("ArrowDown");
        typeText("b");
        await act(async () => {});
        expect(document.activeElement).toBe(dom);
        expect(mentionOptionLabels()).toHaveLength(1);

        const bobOption = mentionOption("Bob");
        const press = new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        });
        bobOption.dispatchEvent(press);
        expect(press.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(dom);

        await act(async () => bobOption.click());
        expect(mentionListbox()).toBeNull();
        expect(document.activeElement).toBe(dom);

        const mentionButton = container.querySelector<HTMLButtonElement>(
          'button[aria-label="Mention someone"]',
        );
        await act(async () => mentionButton?.click());
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(mentionListbox()).not.toBeNull();
        expect(document.activeElement).toBe(dom);
      } finally {
        document.removeEventListener("focusin", recordFocus);
      }
      expect(focusTargets.every((target) => target === dom)).toBe(true);
    });

    it("selects the highlighted option with Enter or Tab and by click", async () => {
      let state = { value: "", mentions: [] as ReviewMention[] };
      await render(<Harness onState={(next) => (state = next)} />);
      focusEditor();

      keydown("@");
      await act(async () => {});
      keydown("ArrowDown");
      const tab = keydown("Tab");
      await act(async () => {});
      expect(tab.defaultPrevented).toBe(true);
      expect(state).toEqual({ value: "@Bob", mentions: [bob] });
      expectTextboxOmitsPopupState(editorDom());
      expect(document.activeElement).toBe(editorDom());

      typeText(" ");
      keydown("@");
      await act(async () => {});
      expect(mentionOption("Alice").getAttribute("aria-selected")).toBe("true");
      const bobOption = mentionOption("Bob");
      act(() => {
        bobOption.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true }),
        );
      });
      expect(editorDom().getAttribute("aria-activedescendant")).toBe(
        bobOption.id,
      );
      expect(bobOption.getAttribute("aria-selected")).toBe("true");
      await act(async () => bobOption.click());
      expect(state.value).toBe("@Bob @Bob");
      expect(document.activeElement).toBe(editorDom());
    });

    it("closes on a press outside the field but not inside it", async () => {
      await render(<Harness />);
      focusEditor();
      keydown("@");
      await act(async () => {});
      // Radix arms its outside-press listener on the next tick.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Radix settles a press outside on the click that completes it.
      const press = async (target: HTMLElement) => {
        await act(async () => {
          target.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
          );
          target.dispatchEvent(
            new MouseEvent("click", { bubbles: true, button: 0 }),
          );
        });
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      };

      await press(editorDom());
      expect(mentionListbox()).not.toBeNull();

      await press(document.body);
      expect(mentionListbox()).toBeNull();
      expectTextboxOmitsPopupState(editorDom());
      expect(editorDom().hasAttribute("aria-controls")).toBe(false);
    });

    it("closes when focus moves out of the editor", async () => {
      await render(<Harness />);
      const elsewhere = document.createElement("button");
      document.body.appendChild(elsewhere);
      try {
        focusEditor();
        keydown("@");
        await act(async () => {});
        expect(mentionListbox()).not.toBeNull();

        await act(async () => elsewhere.focus());
        expect(mentionListbox()).toBeNull();
        expectTextboxOmitsPopupState(editorDom());
        expect(editorDom().hasAttribute("aria-controls")).toBe(false);
      } finally {
        elsewhere.remove();
      }
    });

    it("announces an empty result in a polite live region that is always mounted", async () => {
      await render(<Harness noMentionsLabel="Nobody matches" />);
      const region = liveRegion();
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.className).toContain("sr-only");
      expect(region.textContent).toBe("");

      focusEditor();
      keydown("@");
      await act(async () => {});
      expect(liveRegion()).toBe(region);
      expect(region.textContent).toBe("");

      typeText("zzz");
      await act(async () => {});
      expect(liveRegion()).toBe(region);
      expect(region.textContent).toBe("Nobody matches");
      // Nothing to choose from, so there is no listbox to point at.
      expect(mentionListbox()).toBeNull();
      expectTextboxOmitsPopupState(editorDom());
      expect(editorDom().hasAttribute("aria-controls")).toBe(false);

      keydown("Escape");
      await act(async () => {});
      expect(region.textContent).toBe("");
      expect(document.activeElement).toBe(editorDom());
    });

    it("keeps the @ in the chip for people and agents without changing the submitted text", async () => {
      const sam = { label: "Sam", email: "sam@example.com" };
      const claude = { label: "Claude", id: "agent:claude" };
      let state = { value: "", mentions: [] as ReviewMention[] };
      await render(
        <Harness
          initialValue="Hi @Sam and @Claude"
          initialMentions={[sam, claude]}
          onState={(next) => (state = next)}
        />,
      );
      const chips = Array.from(
        container.querySelectorAll("[data-review-mention-chip]"),
      );
      expect(chips.map((chip) => chip.textContent)).toEqual([
        "@Sam",
        "@Claude",
      ]);
      expect(editorDom().textContent).toBe("Hi @Sam and @Claude");

      placeCaret(editorDom().editor.state.doc.content.size - 1);
      typeText("!");
      expect(state.value).toBe("Hi @Sam and @Claude!");
    });
  });
});
