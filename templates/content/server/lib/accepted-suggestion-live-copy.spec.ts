import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";
import {
  initProseMirrorDoc,
  prosemirrorJSONToYXmlFragment,
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createContentEditorStructuralSchema } from "../../shared/content-editor-structural-schema";
import { docToNfm, nfmToDoc, type PMNode as PMJson } from "../../shared/nfm";
import { suggestionPlacementForRange } from "../../shared/suggestion-placement";
import {
  liveCopyMarkdown,
  writeAcceptedSuggestion,
} from "./accepted-suggestion-live-copy";

const schema = createContentEditorStructuralSchema();

const page = (markdown: string) => schema.nodeFromJSON(nfmToDoc(markdown));

const markdownOf = (doc: Y.Doc) =>
  docToNfm(
    yXmlFragmentToProsemirrorJSON(doc.getXmlFragment("default")) as PMJson,
  );

/** The server's live copy and a copy for each browser, all holding `stored`. */
function session(stored: string, browsers = 1) {
  const server = new Y.Doc();
  prosemirrorJSONToYXmlFragment(
    schema,
    page(stored).toJSON(),
    server.getXmlFragment("default"),
  );
  const copies = Array.from({ length: browsers }, () => {
    const browser = new Y.Doc();
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(server));
    return browser;
  });
  return { server, browsers: copies };
}

/** Edits a copy the way the editor does; returns the update it sends. */
function edit(doc: Y.Doc, change: (current: PMNode) => PMNode) {
  const fragment = doc.getXmlFragment("default");
  const { doc: current, meta } = initProseMirrorDoc(fragment, schema);
  const vector = Y.encodeStateVector(doc);
  doc.transact(() => updateYFragment(doc, fragment, change(current), meta));
  return Y.encodeStateAsUpdate(doc, vector);
}

function find(doc: PMNode, text: string, occurrence = 0) {
  const hits: Array<{ from: number; to: number }> = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    for (
      let index = node.textContent.indexOf(text);
      index >= 0;
      index = node.textContent.indexOf(text, index + 1)
    )
      hits.push({
        from: position + 1 + index,
        to: position + 1 + index + text.length,
      });
    return false;
  });
  const hit = hits[occurrence];
  if (!hit) throw new Error(`No "${text}" #${occurrence}`);
  return hit;
}

const typeAt =
  (text: string, at: (current: PMNode) => number) => (current: PMNode) => {
    const position = at(current);
    return current.replace(
      position,
      position,
      new Slice(Fragment.from(schema.text(text)), 0, 0),
    );
  };

const before = (words: string) => (current: PMNode) =>
  find(current, words).from;

const after = (words: string) => (current: PMNode) => find(current, words).to;

const endOf = (words: string) => (current: PMNode) => {
  const { from } = find(current, words);
  return current.resolve(from).end();
};

/** Where the browser shows `words`, as it sends it with the accept. */
function placementOf(browser: Y.Doc, words: string, occurrence = 0) {
  const fragment = browser.getXmlFragment("default");
  const { doc, mapping } = initProseMirrorDoc(fragment, schema);
  return suggestionPlacementForRange(
    { doc: browser, type: fragment, mapping },
    find(doc, words, occurrence),
  );
}

const refused = "The live copy shows these words differently";

function accept(
  server: Y.Doc,
  stored: string,
  next: string,
  placement?: unknown,
) {
  const vector = Y.encodeStateVector(server);
  const held = Y.encodeStateAsUpdate(server);
  const written = writeAcceptedSuggestion(server, schema, {
    before: page(stored),
    after: page(next),
    placement,
  });
  if (!written) {
    // A refused accept leaves the live copy exactly as it was.
    expect(Y.encodeStateAsUpdate(server)).toEqual(held);
    throw new Error(refused);
  }
  return Y.encodeStateAsUpdate(server, vector);
}

function exchange(server: Y.Doc, browser: Y.Doc) {
  Y.applyUpdate(
    browser,
    Y.encodeStateAsUpdate(server, Y.encodeStateVector(browser)),
  );
  Y.applyUpdate(
    server,
    Y.encodeStateAsUpdate(browser, Y.encodeStateVector(server)),
  );
}

/**
 * Accepts with the browser's placement while the browser's typing is still
 * on its way, then lets both sync. Returns the Page both now show.
 */
function acceptWhileTyping(input: {
  stored: string;
  next: string;
  words: string;
  occurrence?: number;
  typing: (current: PMNode) => PMNode;
  /** The typing reached the server before the accept did. */
  typingArrivedFirst?: boolean;
}) {
  const {
    server,
    browsers: [browser],
  } = session(input.stored);
  const placement = placementOf(browser!, input.words, input.occurrence);
  expect(placement).not.toBeNull();
  const typed = edit(browser!, input.typing);
  if (input.typingArrivedFirst) Y.applyUpdate(server, typed);
  accept(server, input.stored, input.next, placement);
  exchange(server, browser!);
  const shown = markdownOf(server);
  expect(markdownOf(browser!)).toBe(shown);
  return shown;
}

describe("writeAcceptedSuggestion at the reviewer's placement", () => {
  it("keeps typing beside a word whose replacement repeats it", () => {
    // y-prosemirror's whole-text diff put "so " inside the new words about
    // one run in four; the placement pins the insert to the reviewed word.
    for (let run = 0; run < 24; run += 1) {
      for (const typingArrivedFirst of [false, true]) {
        expect(
          acceptWhileTyping({
            stored: "A very, good day.",
            next: "A very, very, good day.",
            words: "very",
            typing: typeAt("so ", before("good")),
            typingArrivedFirst,
          }),
        ).toBe("A very, very, so good day.");
      }
    }
  });

  it("swaps whole emoji, skin tones included", () => {
    expect(
      acceptWhileTyping({
        stored: "Status: 🤔. Ok.",
        next: "Status: 🔔. Ok.",
        words: "🤔",
        typing: typeAt(" More.", endOf("Status")),
      }),
    ).toBe("Status: 🔔. Ok. More.");
    expect(
      acceptWhileTyping({
        stored: "Vote 👍🏽 now.",
        next: "Vote 👎🏽 now.",
        words: "👍🏽",
        typing: typeAt("!", endOf("Vote")),
        typingArrivedFirst: true,
      }),
    ).toBe("Vote 👎🏽 now.!");
  });

  it("keeps a word typed before the changed one, apart from it", () => {
    for (const typingArrivedFirst of [false, true])
      expect(
        acceptWhileTyping({
          stored: "We sell books.",
          next: "We resell books.",
          words: "sell",
          typing: typeAt("really ", before("sell")),
          typingArrivedFirst,
        }),
      ).toBe("We really resell books.");
    expect(
      acceptWhileTyping({
        stored: "One café here.",
        next: "One restaurant here.",
        words: "café",
        typing: typeAt(" quickly", after("café")),
        typingArrivedFirst: true,
      }),
    ).toBe("One restaurant quickly here.");
  });

  it("changes a link, bold, or escaped text in a paragraph being typed in", () => {
    expect(
      acceptWhileTyping({
        stored: "Read [one two three](https://old.example) today.",
        next: "Read [one two three](https://new.example) today.",
        words: "one two three",
        typing: typeAt(" Please.", endOf("today")),
        typingArrivedFirst: true,
      }),
    ).toBe("Read [one two three](https://new.example) today. Please.");
    expect(
      acceptWhileTyping({
        stored: "The lazy dog.",
        next: "The **lazy** dog.",
        words: "lazy",
        typing: typeAt(" It naps.", endOf("dog")),
      }),
    ).toBe("The **lazy** dog. It naps.");
    expect(
      acceptWhileTyping({
        stored: "See \\[x\\*\\] and lazy dog.",
        next: "See \\[x\\*\\] and sleepy dog.",
        words: "lazy",
        typing: typeAt(" Yes.", endOf("dog")),
        typingArrivedFirst: true,
      }),
    ).toBe("See \\[x\\*\\] and sleepy dog. Yes.");
  });

  it("changes the repeated words the reviewer saw, not their twin", () => {
    expect(
      acceptWhileTyping({
        stored: "the cat and the cat.",
        next: "the cat and the dog.",
        words: "cat",
        occurrence: 1,
        typing: typeAt("big ", before("the cat and")),
        typingArrivedFirst: true,
      }),
    ).toBe("big the cat and the dog.");
  });

  it("refuses when someone else changed the reviewed words first", () => {
    const stored = "Status: 🤔. Ok.";
    const {
      server,
      browsers: [browser, other],
    } = session(stored, 2);
    const placement = placementOf(browser!, "🤔");
    Y.applyUpdate(
      server,
      edit(other!, (current) => {
        const range = find(current, "🤔");
        return current.replace(
          range.from,
          range.to,
          new Slice(Fragment.from(schema.text("🤓")), 0, 0),
        );
      }),
    );
    expect(() => accept(server, stored, "Status: 🔔. Ok.", placement)).toThrow(
      refused,
    );
    expect(markdownOf(server)).toBe("Status: 🤓. Ok.");
  });

  it("refuses when someone else typed a letter onto the reviewed word", () => {
    const stored = "We sell books.";
    const {
      server,
      browsers: [browser, other],
    } = session(stored, 2);
    const placement = placementOf(browser!, "sell");
    Y.applyUpdate(server, edit(other!, typeAt("re", before("sell"))));
    expect(() => accept(server, stored, "We resell books.", placement)).toThrow(
      refused,
    );
  });

  it("keeps typing beside reviewed words that end in a space", () => {
    for (const typingArrivedFirst of [false, true]) {
      expect(
        acceptWhileTyping({
          stored: "The cat sleeps.",
          next: "The sleeps.",
          words: "cat ",
          typing: typeAt("happily ", before("sleeps")),
          typingArrivedFirst,
        }),
      ).toBe("The happily sleeps.");
    }
  });

  it("keeps a word typed before reviewed words that start with a space", () => {
    const input = {
      stored: "The cat sleeps.",
      next: "The sleeps.",
      words: " cat",
      typing: typeAt(" happy", before(" cat")),
    };
    expect(acceptWhileTyping(input)).toBe("The happy sleeps.");
    // y-prosemirror records " happy" as "happy " after the reviewed space, so
    // once it arrives it is inside the words and the accept waits.
    expect(() =>
      acceptWhileTyping({ ...input, typingArrivedFirst: true }),
    ).toThrow(refused);
  });

  it("keeps typing beside words a suggestion replaces", () => {
    for (let run = 0; run < 12; run += 1) {
      for (const typingArrivedFirst of [false, true]) {
        expect(
          acceptWhileTyping({
            stored: "A cat day.",
            next: "A dog day.",
            words: "cat",
            typing: typeAt("!", after("cat")),
            typingArrivedFirst,
          }),
        ).toBe("A dog! day.");
        expect(
          acceptWhileTyping({
            stored: "The cat sleeps.",
            next: "The dog sleeps.",
            words: " cat",
            typing: typeAt(" happy", before(" cat")),
          }),
        ).toBe("The happy dog sleeps.");
        expect(
          acceptWhileTyping({
            stored: "A cat day.",
            next: "A big cat day.",
            words: "cat",
            typing: typeAt("!", after("cat")),
            typingArrivedFirst,
          }),
        ).toBe("A big cat! day.");
        // One character made of two code points has an inside too.
        expect(
          acceptWhileTyping({
            stored: "A 👍🏽 day.",
            next: "A 👎🏽 day.",
            words: "👍🏽",
            typing: typeAt("!", after("👍🏽")),
            typingArrivedFirst,
          }),
        ).toBe("A 👎🏽! day.");
      }
    }
  });

  it("deletes the reviewed word, not the same word after it", () => {
    const pages = [
      ["The cat cat sleeps.", "The cat sleeps.", "The dog sleeps."],
      ["The cat **cat sleeps.**", "The **cat sleeps.**", "The **dog sleeps.**"],
      [
        "The cat [cat](https://example.com) sleeps.",
        "The [cat](https://example.com) sleeps.",
        "The [dog](https://example.com) sleeps.",
      ],
    ];
    // Someone else turns the second "cat" into "dog", keeping its formatting.
    const renameSecondCat = (current: PMNode) => {
      const { from, to } = find(current, "cat", 1);
      const marks = current.resolve(from + 1).marks();
      return current.replace(
        from,
        to,
        new Slice(Fragment.from(schema.text("dog", marks)), 0, 0),
      );
    };
    for (const [stored, next, shown] of pages)
      for (let run = 0; run < 12; run += 1)
        for (const typingArrivedFirst of [false, true])
          expect(
            acceptWhileTyping({
              stored: stored!,
              next: next!,
              words: "cat ",
              typing: renameSecondCat,
              typingArrivedFirst,
            }),
          ).toBe(shown);
  });

  it("refuses, rather than changing the twin, when someone edited the reviewed words", () => {
    const stored = "The lazy dog.\nThe lazy dog.";
    const {
      server,
      browsers: [browser, other],
    } = session(stored, 2);
    const placement = placementOf(browser!, "lazy");
    Y.applyUpdate(
      server,
      edit(other!, (current) => {
        const { from, to } = find(current, "lazy");
        return current.replace(
          from,
          to,
          new Slice(Fragment.from(schema.text("active")), 0, 0),
        );
      }),
    );
    expect(() =>
      accept(server, stored, "The sleepy dog.\nThe lazy dog.", placement),
    ).toThrow(refused);
    expect(markdownOf(server)).toBe("The active dog.\nThe lazy dog.");
  });

  it("refuses a link someone else split while the reviewer looked", () => {
    const stored = "Read [one two three](https://old.example) today.";
    const {
      server,
      browsers: [browser, other],
    } = session(stored, 2);
    const placement = placementOf(browser!, "one two three");
    Y.applyUpdate(
      server,
      edit(other!, (current) => {
        const range = find(current, "three");
        return new Transform(current).addMark(
          range.from,
          range.to,
          schema.marks.bold!.create(),
        ).doc;
      }),
    );
    expect(() =>
      accept(
        server,
        stored,
        "Read [one two three](https://new.example) today.",
        placement,
      ),
    ).toThrow(refused);
  });

  it("lands every member of a group where each was shown", () => {
    const stored = "The lazy dog sleeps.\nSecond paragraph.";
    const middle = "The sleepy dog sleeps.\nSecond paragraph.";
    const next = "The sleepy dog sleeps.\nNext paragraph.";
    for (let run = 0; run < 8; run += 1) {
      const {
        server,
        browsers: [browser],
      } = session(stored);
      const lazy = placementOf(browser!, "lazy");
      const second = placementOf(browser!, "Second");
      const typed = edit(browser!, typeAt(" Typed", endOf("sleeps")));
      if (run % 2) Y.applyUpdate(server, typed);
      accept(server, stored, middle, lazy);
      accept(server, middle, next, second);
      exchange(server, browser!);
      expect(markdownOf(server)).toBe(
        "The sleepy dog sleeps. Typed\nNext paragraph.",
      );
      expect(markdownOf(browser!)).toBe(markdownOf(server));
    }
  });

  it("ignores a placement that isn't one and places the accept itself", () => {
    const stored = "The lazy dog.\nOther.";
    for (const placement of [
      { from: { tname: "evil" }, to: { tname: "evil" } },
      { from: { item: { client: 1, clock: 999 } }, to: {} },
      "nope",
    ]) {
      const { server } = session(stored);
      accept(server, stored, "The sleepy dog.\nOther.", placement);
      expect(markdownOf(server)).toBe("The sleepy dog.\nOther.");
      expect(server.share.has("evil")).toBe(false);
    }
  });

  it("ignores a placement in a text outside the Page", () => {
    const stored = "The lazy dog.";
    const { server } = session(stored);
    const outside = server.getXmlFragment("elsewhere");
    const text = new Y.XmlText("lazy");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [text]);
    outside.insert(0, [paragraph]);
    const placement = {
      from: Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(text, 0, 0),
      ),
      to: Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(text, 4, -1),
      ),
    };
    accept(server, stored, "The sleepy dog.", placement);
    expect(markdownOf(server)).toBe("The sleepy dog.");
    expect(text.toString()).toBe("lazy");
  });
});

describe("writeAcceptedSuggestion without a placement", () => {
  it("writes the stored result into an empty live copy", () => {
    const server = new Y.Doc();
    accept(server, "The lazy dog.", "The sleepy dog.");
    expect(markdownOf(server)).toBe("The sleepy dog.");
  });

  it("changes a paragraph the live copy still holds as stored", () => {
    for (const typingArrivedFirst of [false, true]) {
      const stored = "The lazy dog.\nSecond paragraph.";
      const {
        server,
        browsers: [browser],
      } = session(stored);
      const typed = edit(browser!, typeAt(" Typed.", endOf("Second")));
      if (typingArrivedFirst) Y.applyUpdate(server, typed);
      accept(server, stored, "The sleepy dog.\nSecond paragraph.");
      exchange(server, browser!);
      expect(markdownOf(server)).toBe(
        "The sleepy dog.\nSecond paragraph. Typed.",
      );
      expect(markdownOf(browser!)).toBe(markdownOf(server));
    }
  });

  it("refuses when the live copy changed that paragraph", () => {
    const stored = "The lazy dog.\nSecond paragraph.";
    const {
      server,
      browsers: [browser],
    } = session(stored);
    Y.applyUpdate(server, edit(browser!, typeAt(" Typed.", endOf("lazy"))));
    expect(() =>
      accept(server, stored, "The sleepy dog.\nSecond paragraph."),
    ).toThrow(refused);
    expect(markdownOf(server)).toBe("The lazy dog. Typed.\nSecond paragraph.");
  });

  it("adds a block beside paragraphs being typed in", () => {
    const stored = "First.\nSecond.";
    const {
      server,
      browsers: [browser],
    } = session(stored);
    Y.applyUpdate(server, edit(browser!, typeAt(" Typed.", endOf("Second"))));
    accept(server, stored, "First.\nAdded.\nSecond.");
    expect(markdownOf(server)).toBe("First.\nAdded.\nSecond. Typed.");
  });

  it("refuses a paragraph that appears twice once the live copy moved on", () => {
    const stored = "Yes.\nMiddle.\nYes.";
    const {
      server,
      browsers: [browser],
    } = session(stored);
    Y.applyUpdate(server, edit(browser!, typeAt(" Typed.", endOf("Middle"))));
    expect(() => accept(server, stored, "Yes!\nMiddle.\nYes.")).toThrow(
      refused,
    );
  });

  it("refuses, rather than changing the twin, a repeated paragraph with typing", () => {
    const stored = "The lazy dog.\nThe lazy dog.";
    const {
      server,
      browsers: [browser],
    } = session(stored);
    Y.applyUpdate(server, edit(browser!, typeAt(" Typed.", endOf("lazy"))));
    expect(() =>
      accept(server, stored, "The sleepy dog.\nThe lazy dog."),
    ).toThrow(refused);
    expect(markdownOf(server)).toBe("The lazy dog. Typed.\nThe lazy dog.");
  });

  it("refuses, rather than changing the twin, repeated blocks with typing", () => {
    const stored = "Alpha.\nBeta.\nAlpha.\nBeta.";
    const {
      server,
      browsers: [browser],
    } = session(stored);
    Y.applyUpdate(server, edit(browser!, typeAt(" Typed.", endOf("Alpha"))));
    expect(() => accept(server, stored, "Gamma.\nAlpha.\nBeta.")).toThrow(
      refused,
    );
    expect(markdownOf(server)).toBe("Alpha. Typed.\nBeta.\nAlpha.\nBeta.");
  });
});

describe("liveCopyMarkdown", () => {
  it("keeps the stored text when the live copy holds the same Page", () => {
    const stored = "The *lazy* dog.";
    const { server } = session(stored);
    expect(
      liveCopyMarkdown(server, schema, {
        content: stored,
        document: page(stored),
      }),
    ).toBe(stored);
  });

  it("reads typing the stored text doesn't have", () => {
    const stored = "The lazy dog.";
    const {
      server,
      browsers: [browser],
    } = session(stored);
    Y.applyUpdate(server, edit(browser!, typeAt(" Typed.", endOf("dog"))));
    expect(
      liveCopyMarkdown(server, schema, {
        content: stored,
        document: page(stored),
      }),
    ).toBe("The lazy dog. Typed.");
  });
});
