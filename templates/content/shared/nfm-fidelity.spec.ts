// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";

import {
  KNOWN_EDITOR_LOSSES,
  ROUND_TRIP_CORPUS,
} from "../acceptance/round-trip-corpus.js";
import { createVisualEditorExtensions } from "../app/components/editor/VisualEditor.js";
import { snapshotBlocksFieldMarkdown } from "./blocks-field-identity.js";
import { createContentEditorStructuralSchema } from "./content-editor-structural-schema.js";
import { LIVE_BODY_FIELD, materializeLiveBody } from "./live-body.js";
import {
  canonicalizeNfmWithFidelity,
  NfmFidelityError,
  requireLosslessNfm,
} from "./nfm-fidelity.js";
import {
  canonicalizeNfm,
  canonicalNfmDoc,
  docToNfm,
  nfmToDoc,
  parseNfmWithLosses,
  type PMMark,
  type PMNode,
} from "./nfm.js";

const editorSchema = getSchema(createVisualEditorExtensions());
const structuralSchema = createContentEditorStructuralSchema();

/** Document JSON with sorted keys and each node's marks as a set. */
function documentKey(value: unknown, key?: string): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => documentKey(item));
    if (key === "marks") items.sort();
    return `[${items.join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, child]) => `${k}:${documentKey(child, k)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function lossKinds(markdown: string) {
  return canonicalizeNfmWithFidelity(markdown).losses.map((loss) => loss.kind);
}

describe("NFM round-trip corpus", () => {
  const ids = new Set<string>();
  for (const sample of ROUND_TRIP_CORPUS) {
    it(`${sample.id} has one meaning`, () => {
      expect(ids.has(sample.id)).toBe(false);
      ids.add(sample.id);
    });

    if (sample.canonical !== undefined) {
      const canonical = sample.canonical;
      it(`${sample.id} canonicalizes without loss`, () => {
        const result = canonicalizeNfmWithFidelity(sample.markdown);
        expect(result).toEqual({
          kind: "canonical",
          markdown: canonical,
          changed: canonical !== sample.markdown,
          losses: [],
        });
        expect(canonicalizeNfm(sample.markdown)).toBe(canonical);
        expect(requireLosslessNfm(sample.markdown)).toBe(canonical);
        expect(canonicalizeNfm(canonical)).toBe(canonical);
        expect(parseNfmWithLosses(canonical).losses).toEqual([]);
      });

      it(`${sample.id} is what the editor's live copy saves`, () => {
        const json = editorSchema.nodeFromJSON(nfmToDoc(canonical)).toJSON();
        const live = materializeLiveBody(
          prosemirrorJSONToYDoc(editorSchema, json, LIVE_BODY_FIELD),
        );
        expect(live).toMatchObject({ kind: "body", markdown: canonical });
      });
    } else {
      const refusal = sample.losses;
      it(`${sample.id} is refused`, () => {
        expect(lossKinds(sample.markdown)).toEqual(refusal);
        let thrown: unknown;
        try {
          requireLosslessNfm(sample.markdown);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(NfmFidelityError);
        const error = thrown as NfmFidelityError;
        expect(error.code).toBe("NFM_FIDELITY_LOSS");
        expect(error.message).toMatch(/\b[A-Z][A-Z_]*FIDELITY[A-Z_]*\b/);
        expect(error.losses.map((loss) => loss.kind)).toEqual(refusal);
        expect(error.canonical).toBe(canonicalizeNfm(sample.markdown));
      });
    }
  }
});

describe("canonicalizeNfmWithFidelity", () => {
  it("reports an unreadable body as unparseable, not as an empty page", () => {
    const unreadable = {
      replace() {
        throw new Error("not text");
      },
    } as unknown as string;
    expect(canonicalizeNfmWithFidelity(unreadable)).toEqual({
      kind: "unparseable",
      losses: [{ kind: "unparseable", count: 1, samples: ["not text"] }],
    });
    expect(() => requireLosslessNfm(unreadable)).toThrow(NfmFidelityError);
  });

  it("counts every loss and keeps a few samples", () => {
    const source = Array.from(
      { length: 8 },
      (_, index) => `<span color="red" data-n="${index}">t${index}</span>`,
    ).join("\n");
    const [loss] = canonicalizeNfmWithFidelity(source).losses;
    expect(loss).toMatchObject({ kind: "dropped-attribute", count: 8 });
    expect(loss!.samples).toHaveLength(5);
  });

  it("reads many underscore openers in linear time", () => {
    const started = performance.now();
    canonicalizeNfm("_a ".repeat(20_000));
    canonicalizeNfm("__a_".repeat(20_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads many short lists and unmatched brackets in linear time", () => {
    const started = performance.now();
    canonicalizeNfm(" - a\nx\n".repeat(20_000));
    canonicalizeNfm("[".repeat(20_000));
    canonicalizeNfm("[".repeat(10_000) + "$".repeat(10_000));
    canonicalizeNfm(
      Array.from({ length: 500 }, (_, i) => `${"\t".repeat(i)}- a`).join("\n"),
    );
    canonicalizeNfm(`<table>\n<tr>\n${"<td>\n".repeat(16_000)}</tr>\n</table>`);
    for (const cell of ["<td>a", "<td a", "<td>`"])
      canonicalizeNfm(
        `<table>\n<tr>${cell.repeat(48_000)}</th></tr>\n</table>`,
      );
    canonicalizeNfm("$`a".repeat(60_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads unmatched backtick runs of many lengths in linear time", () => {
    const runs = (lengths: number[]) =>
      lengths.map((length) => "`".repeat(length)).join("a");
    const ascending = runs(Array.from({ length: 400 }, (_, i) => i + 1));
    const started = performance.now();
    canonicalizeNfm(ascending);
    canonicalizeNfm(`*${ascending}*`);
    canonicalizeNfm(`[${ascending}](u)`);
    canonicalizeNfm(`<table>\n<tr>\n<td>${ascending}</td>\n</tr>\n</table>`);
    canonicalizeNfm(runs(Array.from({ length: 400 }, (_, i) => 400 - i)));
    canonicalizeNfm(`a${"`".repeat(80_000)}`);
    canonicalizeNfm(`*${"`".repeat(80_000)}*`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads space-indented lines under deep tab nesting in linear time", () => {
    const nested = (under: string) =>
      Array.from(
        { length: 1_000 },
        (_, depth) => `${"\t".repeat(depth)}- a\n${"\t".repeat(depth)}${under}`,
      ).join("\n") + "\nafter";
    const started = performance.now();
    canonicalizeNfm(nested("  - b"));
    canonicalizeNfm(nested("  > q"));
    canonicalizeNfm(nested("  ```"));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads blank lines and fences under deep nesting in linear time", () => {
    const deep = (item: (depth: number) => string) =>
      Array.from({ length: 1_000 }, (_, depth) => item(depth)).join("\n");
    const started = performance.now();
    canonicalizeNfm(
      `${deep((d) => `${"\t".repeat(d)}- a`)}${"\n".repeat(300_000)}  x`,
    );
    canonicalizeNfm(
      `${deep((d) => `${"\t".repeat(d)}- a`)}\n${"\t\n".repeat(300_000)}  x`,
    );
    canonicalizeNfm(
      `${deep((d) => `${"\t".repeat(d)}- c\n${"\t".repeat(d)}  \`\`\`js`)}${"\n".repeat(300_000)}b`,
    );
    // Read only: the writer indents each code line to its depth.
    nfmToDoc(
      `${deep((d) => `${"\t".repeat(d)}- a`)}\n${"\t".repeat(1_000)}\`\`\`\n${"x\n".repeat(300_000)}${"\t".repeat(1_000)}\`\`\`\n  x`,
    );
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads long runs of word and space characters in linear time", () => {
    const started = performance.now();
    canonicalizeNfm(`<span ${"a".repeat(200_000)}>x</span>`);
    canonicalizeNfm(`<span a${" ".repeat(200_000)}b>x</span>`);
    canonicalizeNfm(`a${" ".repeat(200_000)}{`);
    canonicalizeNfm(`a${"\\".repeat(200_000)}`);
    canonicalizeNfm(
      `<mention-user url="u">${" ".repeat(200_000)}a</mention-user>`,
    );
    canonicalizeNfm(`x <mention-${"u".repeat(100_000)}>a</mention-u>`);
    canonicalizeNfm('<span color="red">a '.repeat(20_000));
    canonicalizeNfm('<mention-user url="u">a '.repeat(20_000));
    canonicalizeNfm(
      `<table>\n<col${" ".repeat(200_000)}x\n<tr>\n<td>a</td>\n</tr>\n</table>`,
    );
    canonicalizeNfm(
      `<table>\n<tr>\n<td>a\nb${" ".repeat(200_000)}c\n</td></tr>\n</table>`,
    );
    const runs = Array.from({ length: 600 }, (_, i) => "`".repeat(i + 1));
    canonicalizeNfm(`| a |\n| - |\n|${runs.join("|")}|`);
    canonicalizeNfm("[a](b".repeat(100_000));
    canonicalizeNfm("<table>\n".repeat(60_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads links nested past the inline limit as text and reports it", () => {
    const nested = (depth: number) =>
      "[".repeat(depth) + "x" + "](u)".repeat(depth);
    expect(canonicalizeNfmWithFidelity(nested(30)).losses).toEqual([]);
    const deep = canonicalizeNfmWithFidelity(nested(40));
    expect(deep.losses.map((loss) => loss.kind)).toEqual([
      "dropped-formatting",
    ]);
    const started = performance.now();
    expect(() => requireLosslessNfm(nested(50_000))).toThrow(NfmFidelityError);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("nests a space-indented list only as deep as the stack allows", () => {
    const nested = (depth: number) =>
      Array.from({ length: depth }, (_, i) => `${"  ".repeat(i)}- a`).join(
        "\n",
      );
    expect(canonicalizeNfmWithFidelity(nested(200)).losses).toEqual([]);
    const deep = canonicalizeNfmWithFidelity(nested(4_000));
    expect(deep.losses.map((loss) => loss.kind)).toEqual([
      "dropped-formatting",
    ]);
    expect(() => requireLosslessNfm(nested(4_000))).toThrow(NfmFidelityError);
  });

  it("reads a table with more rows than a call takes arguments", () => {
    const table = canonicalizeNfm(`| a |\n| - |\n${"| b |\n".repeat(130_000)}`);
    expect(table.startsWith('<table header-row="true">')).toBe(true);
  });

  it("writes code holding more fence runs than a call takes arguments", () => {
    const code = "~x".repeat(130_000);
    for (const markdown of [
      `~~~a\`b\n${code}\n~~~`,
      `\`\`\`\n${code.replace(/~/g, "`")}\n\`\`\``,
      `a \`\` ${"`x".repeat(130_000)} \`\``,
    ])
      expect(canonicalizeNfmWithFidelity(markdown).losses).toEqual([]);
  });

  it("reads a list nested a thousand deep", () => {
    const nested = Array.from(
      { length: 1_000 },
      (_, i) => `${"\t".repeat(i)}- a`,
    ).join("\n");
    expect(canonicalizeNfm(nested)).toBe(nested);
  });
});

describe("space-indented lists in a blocks field", () => {
  it("nests the item instead of splitting it into a top-level block", () => {
    const blocks = snapshotBlocksFieldMarkdown("- a\n    - b\n- c");
    expect(blocks.filter((block) => block.parentPath === null)).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "bulletList",
      markdown: "- a\n\t- b\n- c",
    });
  });
});

/** A small seeded generator, so a failure names the input that made it. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

const AGENT_TOKENS = [
  "a",
  "word",
  " ",
  "  ",
  "    ",
  "\t",
  "\n",
  "\n",
  "\n\n",
  "- ",
  "* ",
  "1. ",
  "2) ",
  "- [ ] ",
  "# ",
  "> ",
  "_",
  "__",
  "*",
  "**",
  "~~",
  "`",
  "```",
  "~~~",
  "$",
  "$x$",
  "1",
  "\\",
  "\\_",
  "\\*",
  "|",
  "[",
  "]",
  "(",
  ")",
  "| a | b |\n|---|---|\n",
  "<br>",
  "&",
  "{",
  '{color="red"}',
  "<empty-block/>",
  '<span color="blue">',
  "</span>",
  "[x](https://example.com/a_b)",
  "<table>\n<tr>\n<td>",
  "</td>\n</tr>\n</table>",
  "<th>",
  "<details>\n<summary>s</summary>\n",
  "\n</details>",
  '<callout icon="i">\n\t',
  "\n</callout>",
];

describe("canonical form properties over agent-shaped Markdown", () => {
  it("is total, idempotent, and keeps the parsed document unless it reports a loss", () => {
    const rng = random(0x5eed);
    const failures: string[] = [];
    for (let run = 0; run < 3_000; run++) {
      let source = "";
      const length = 1 + rng.int(24);
      for (let i = 0; i < length; i++) source += rng.pick(AGENT_TOKENS);

      const result = canonicalizeNfmWithFidelity(source);
      if (result.kind !== "canonical") {
        failures.push(`unparseable: ${JSON.stringify(source)}`);
        continue;
      }
      const { markdown, losses } = result;
      if (markdown !== canonicalizeNfm(source))
        failures.push(`markdown differs: ${JSON.stringify(source)}`);
      if (canonicalizeNfm(markdown) !== markdown)
        failures.push(`not idempotent: ${JSON.stringify(source)}`);
      if (parseNfmWithLosses(markdown).losses.length > 0)
        failures.push(`writes what it drops: ${JSON.stringify(source)}`);
      const sameDocument =
        documentKey(nfmToDoc(markdown)) ===
        documentKey(canonicalNfmDoc(nfmToDoc(source)));
      if (
        !sameDocument &&
        !losses.some((loss) => loss.kind === "reparse-mismatch")
      )
        failures.push(`changed silently: ${JSON.stringify(source)}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

const TEXT_PIECES = [
  "a",
  "word",
  " ",
  "  ",
  "_",
  "__init__",
  "*",
  "**",
  "\\",
  "<",
  ">",
  "$",
  "$5",
  "`",
  "~",
  "|",
  "[",
  "]",
  "{",
  "}",
  "#",
  "- ",
  "1. ",
  "&",
  "&amp;",
  "snake_case",
];
// The plain underline mark is left out: it reads back as a styled span, one
// of the editor losses `KNOWN_EDITOR_LOSSES` records.
const MARKS: PMMark[] = [
  { type: "bold" },
  { type: "italic" },
  { type: "strike" },
  { type: "code" },
  { type: "link", attrs: { href: "https://example.com/a_b" } },
  {
    type: "notionSpan",
    attrs: {
      color: "red",
      bgColor: null,
      underline: null,
      href: null,
      attrsJson: "{}",
    },
  },
];

function text(rng: ReturnType<typeof random>): PMNode {
  let value = "";
  const length = 1 + rng.int(4);
  for (let i = 0; i < length; i++) value += rng.pick(TEXT_PIECES);
  if (!value.trim()) value += "a";
  const marks = MARKS.filter(() => rng.chance(0.2));
  return marks.length
    ? { type: "text", text: value, marks }
    : { type: "text", text: value };
}

// Unformatted: the live copy keeps no formatting on math or a mention.
const ATOMS: PMNode[] = [
  ...["a_b*c", "x ", "`y`"].map((label) => ({
    type: "notionInlineAtom",
    attrs: { tagName: "math", attrsJson: "{}", label },
  })),
  {
    type: "notionInlineAtom",
    attrs: {
      tagName: "mention-page",
      attrsJson: JSON.stringify({ url: "https://example.com/p" }),
      label: "Page",
    },
  },
];

function inline(rng: ReturnType<typeof random>, heading = false): PMNode[] {
  const nodes: PMNode[] = [];
  const count = rng.int(4);
  for (let i = 0; i < count; i++) {
    const roll = rng.int(100);
    nodes.push(
      roll < 8
        ? { type: "hardBreak" }
        : roll < 20
          ? rng.pick(ATOMS)
          : text(rng),
    );
  }
  // Plain text opening a block with a star and a space, or opening a heading
  // with a space, is a known loss.
  const first = nodes[0];
  if (
    first?.type === "text" &&
    !first.marks &&
    (heading ? /^\s|^\*\s/ : /^\*\s/).test(first.text!)
  )
    nodes[0] = { ...first, text: `a${first.text}` };
  return nodes;
}

function paragraph(rng: ReturnType<typeof random>): PMNode {
  return { type: "paragraph", content: inline(rng) };
}

function block(rng: ReturnType<typeof random>, depth: number): PMNode {
  const kinds = depth > 2 ? ["paragraph", "heading", "code"] : undefined;
  switch (
    rng.pick(
      kinds ?? [
        "paragraph",
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "taskList",
        "blockquote",
        "code",
        "rule",
        "table",
        "toggle",
        "callout",
      ],
    )
  ) {
    case "heading":
      return {
        type: "heading",
        attrs: { level: 1 + rng.int(6) },
        content: inline(rng, true),
      };
    case "bulletList":
    case "orderedList": {
      const type = rng.chance(0.5) ? "bulletList" : "orderedList";
      return {
        type,
        content: Array.from({ length: 1 + rng.int(3) }, () => ({
          type: "listItem",
          content: [
            paragraph(rng),
            ...(rng.chance(0.4) ? [block(rng, depth + 1)] : []),
          ],
        })),
      };
    }
    case "taskList":
      return {
        type: "taskList",
        content: Array.from({ length: 1 + rng.int(3) }, () => ({
          type: "taskItem",
          attrs: { checked: rng.chance(0.5) },
          content: [paragraph(rng)],
        })),
      };
    case "blockquote":
      return { type: "blockquote", content: [paragraph(rng)] };
    case "code": {
      const lines = Array.from({ length: 1 + rng.int(3) }, () =>
        rng.pick(["x = 1", "", "  indented", "```", "~~~", "- item"]),
      );
      return {
        type: "codeBlock",
        attrs: { language: rng.chance(0.5) ? "ts" : null },
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
    case "rule":
      return { type: "horizontalRule" };
    case "table": {
      const columns = 1 + rng.int(3);
      const headerRow = rng.chance(0.5);
      return {
        type: "table",
        attrs: { headerRow },
        content: Array.from({ length: 1 + rng.int(3) }, (_, row) => ({
          type: "tableRow",
          content: Array.from({ length: columns }, () => ({
            type: headerRow && row === 0 ? "tableHeader" : "tableCell",
            content: [{ type: "paragraph", content: inline(rng) }],
          })),
        })),
      };
    }
    case "toggle":
      return {
        type: "notionToggle",
        attrs: { summary: rng.pick(["Summary", "a_b", "More"]) },
        content: [paragraph(rng)],
      };
    case "callout":
      return {
        type: "notionCallout",
        attrs: { icon: "i" },
        content: [paragraph(rng)],
      };
    default:
      return paragraph(rng);
  }
}

describe("canonical form properties over editor documents", () => {
  it("writes every editor document in a form that reads back unchanged", () => {
    const rng = random(0xed170);
    const failures: string[] = [];
    let checked = 0;
    while (checked < 1_500) {
      const content: PMNode[] = [];
      for (let count = 1 + rng.int(4); content.length < count; ) {
        const next = block(rng, 0);
        // Two lists of one kind in a row are one list in Markdown.
        const last = content[content.length - 1];
        if (last?.type === next.type && next.type.endsWith("List"))
          content.push(paragraph(rng));
        content.push(next);
      }
      // An empty paragraph after another kind of block is the editor's own
      // trailing filler, which its save drops.
      const last = content[content.length - 1]!;
      if (
        content.length > 1 &&
        last.type === "paragraph" &&
        !last.content?.length &&
        content[content.length - 2]!.type !== "paragraph"
      )
        content.pop();
      const json = { type: "doc", content };
      let root: ProseMirrorNode;
      try {
        root = editorSchema.nodeFromJSON(json);
        root.check();
      } catch {
        continue;
      }
      checked++;
      const markdown = docToNfm(root.toJSON());
      const result = canonicalizeNfmWithFidelity(markdown);
      if (result.kind !== "canonical" || result.losses.length > 0) {
        failures.push(
          `lossy: ${JSON.stringify(markdown)} ${JSON.stringify(result.losses)}`,
        );
        continue;
      }
      if (result.markdown !== markdown)
        failures.push(`not canonical: ${JSON.stringify(markdown)}`);
      const back = editorSchema.nodeFromJSON(nfmToDoc(markdown));
      if (!back.eq(root))
        failures.push(
          `reads back different: ${JSON.stringify(markdown)} ${JSON.stringify(root.toJSON())}`,
        );
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  for (const loss of KNOWN_EDITOR_LOSSES) {
    it(`${loss.id} is still a known loss`, () => {
      const root = editorSchema.nodeFromJSON(loss.doc);
      root.check();
      expect(docToNfm(root.toJSON())).toBe(loss.markdown);
      expect(editorSchema.nodeFromJSON(nfmToDoc(loss.markdown)).eq(root)).toBe(
        false,
      );
    });
  }

  it("uses the editor schema the structural schema mirrors", () => {
    expect(Object.keys(structuralSchema.nodes).sort()).toEqual(
      Object.keys(editorSchema.nodes).sort(),
    );
  });
});
