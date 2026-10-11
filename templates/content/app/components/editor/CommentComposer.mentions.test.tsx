// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  setRichEditorValue,
  typeRichEditorText,
} from "./comment-composer-test-utils";
import { CommentComposer, type MentionEntry } from "./CommentComposer";

vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({
    data: [
      { name: "Sam Lee", email: "sam.lee@example.test" },
      { name: "Sam Lee", email: "sam.l@example.test" },
    ],
    isError: false,
    refetch: vi.fn(),
  }),
}));

const first = { email: "sam.lee@example.test", name: "Sam Lee" };
const second = { email: "sam.l@example.test", name: "Sam Lee" };

describe("CommentComposer people who share a name", () => {
  let container: HTMLDivElement;
  let root: Root;
  let saved: { value: string; mentions: MentionEntry[] };

  function Owner({
    value: initialValue = "",
    mentions: initialMentions = [],
  }: {
    value?: string;
    mentions?: MentionEntry[];
  }) {
    const [value, setValue] = useState(initialValue);
    const [mentions, setMentions] = useState(initialMentions);
    saved = { value, mentions };
    return (
      <CommentComposer
        value={value}
        onChange={setValue}
        mentions={mentions}
        onMentionsChange={setMentions}
        onSubmit={vi.fn()}
      />
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const editor = () => container.querySelector<HTMLElement>(".ProseMirror")!;
  const settle = () =>
    act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  const options = () => [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-agent-native-composer-popover="true"] [data-mention-index]',
    ),
  ];
  const chips = () =>
    [
      ...editor().querySelectorAll(
        '[data-mention-ref-type="content-comment-member"]',
      ),
    ].map((chip) => chip.getAttribute("data-mention-ref-id"));

  it("lists both by email, and each pick mentions that person, in text order", async () => {
    await act(async () => root.render(<Owner />));
    await settle();

    await typeRichEditorText(editor(), "@Sam");
    expect(options().map((option) => option.textContent)).toEqual([
      "SSam Leesam.lee@example.test",
      "SSam Leesam.l@example.test",
    ]);
    await act(async () => options()[1]!.click());
    await settle();
    await typeRichEditorText(editor(), "and @Sam");
    await act(async () => options()[0]!.click());
    await settle();

    expect(chips()).toEqual([second.email, first.email]);
    expect(saved.mentions).toEqual([second, first]);
    expect(saved.value).toBe("@Sam Lee and @Sam Lee");

    await setRichEditorValue(editor(), "Never mind");
    expect(saved.mentions).toEqual([]);
  });

  it("gives a restored draft back each person's chip, unchanged", async () => {
    await act(async () =>
      root.render(
        <Owner value="@Sam Lee, then @Sam Lee" mentions={[second, first]} />,
      ),
    );
    await settle();

    expect(chips()).toEqual([second.email, first.email]);
    expect(saved).toEqual({
      value: "@Sam Lee, then @Sam Lee",
      mentions: [second, first],
    });
  });

  it("keeps a word typed after a restored draft's last chip apart from it", async () => {
    await act(async () =>
      root.render(<Owner value="Ask @Sam Lee" mentions={[second]} />),
    );
    await settle();
    await act(async () => {
      (
        editor() as HTMLElement & {
          editor: { commands: { focus(position: "end"): boolean } };
        }
      ).editor.commands.focus("end");
    });
    await typeRichEditorText(editor(), "today");

    expect(saved).toEqual({ value: "Ask @Sam Lee today", mentions: [second] });
  });
});
