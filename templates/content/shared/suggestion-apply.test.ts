import { describe, expect, it } from "vitest";

import {
  applyMarkdownSuggestionWithSiblings,
  rebaseOntoAcceptedSiblings,
  type AcceptedSiblingRange,
} from "./suggestion-apply.js";
import { markdownSuggestionOperationsForFindReplace } from "./suggestion-diff.js";

// Two agent edits saved from one version of a Page, the second just below the
// first. Each is split into pieces, and most of the first edit's pieces are
// anchored only to the single space between them.
const page = [
  "# Plan",
  "**To confirm:**",
  "- **Vendor:** whether to feature request signing, and in which piece; which plan includes the retry hooks we'd use; whether the vendor's test tool can point at our host; whether the vendor's latency-versus-cost numbers can be cited; and the vendor's technical reviewer.",
  "- **Host:** which regions to test, whether the free tier covers the demo, and who reviews the benchmark.",
  "Thanks.",
].join("\n");

const edits = [
  {
    find: "whether to feature request signing, and in which piece; which plan includes the retry hooks we'd use; whether the vendor's test tool can point at our host; whether the vendor's latency-versus-cost numbers can be cited; and the vendor's technical reviewer.",
    replace:
      "\n\t- **Request signing.** Would the vendor like to show that, and in which article?\n\t- **Retries.** Which vendor plan includes them, so readers know what they need?\n\t- **Testing.** The vendor's docs list two hosts for its test tool. Can it point at our host?\n\t- **Numbers.** The vendor found latency close to cost on some tasks. Can we cite those, and is there a write-up to link?\n\t- **Reviewer.** Who should check the vendor claims and code?",
  },
  {
    find: "which regions to test, whether the free tier covers the demo, and who reviews the benchmark.",
    replace:
      "\n\t- **Regions.** Which three should we test?\n\t- **Free tier.** Does it cover the demo?\n\t- **Benchmark.** Who reviews it?",
  },
] as const;

function split(edit: { find: string; replace: string }) {
  return markdownSuggestionOperationsForFindReplace({
    before: page,
    find: edit.find,
    replace: edit.replace,
    start: page.indexOf(edit.find),
  });
}

const vendor = split(edits[0]);
const host = split(edits[1]);

const approved = edits.reduce(
  (text, edit) => text.replace(edit.find, edit.replace),
  page,
);

type Operation = (typeof vendor)[number];

const accepted = (operation: Operation): AcceptedSiblingRange => ({
  from: operation.anchor.from,
  to: operation.anchor.to,
  text: operation.after.changedText,
});

/** The piece of `pieces` that rewrites `text`. */
function pieceChanging(pieces: Operation[], text: string) {
  const piece = pieces.find(
    (operation) => operation.before.changedText === text,
  );
  if (!piece) throw new Error(`No piece rewrites "${text}"`);
  return piece;
}

/** Accepts each piece in turn, as the server does, or reports the first that fails. */
function acceptInOrder(pieces: Operation[], withText = true, start = page) {
  let body = start;
  const done: AcceptedSiblingRange[] = [];
  for (const piece of pieces) {
    const next = applyMarkdownSuggestionWithSiblings(
      body,
      piece,
      withText ? done : done.map(({ from, to }) => ({ from, to })),
    );
    if (next === null) return { body, failed: piece };
    body = next;
    done.push(accepted(piece));
  }
  return { body, failed: null };
}

describe("placing a piece of an agent's edit after its siblings", () => {
  it("splits the first edit into pieces anchored to single spaces", () => {
    expect(vendor.length).toBeGreaterThan(5);
    expect(
      vendor.filter(
        (operation) =>
          operation.anchor.prefix === " " && operation.anchor.suffix === " ",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("places every piece when the edit below is accepted first", () => {
    const result = acceptInOrder([...host, ...vendor]);
    expect(result.failed).toBeNull();
    expect(result.body).toBe(approved);
  });

  it("places every piece in page order and in reverse", () => {
    const pieces = [...vendor, ...host];
    expect(acceptInOrder(pieces).body).toBe(approved);
    const reversed = acceptInOrder([...pieces].reverse());
    expect(reversed.failed).toBeNull();
    expect(reversed.body).toBe(approved);
  });

  it("needed the text the siblings wrote", () => {
    expect(acceptInOrder([...host, ...vendor], false).failed).not.toBeNull();
  });

  it("places every piece after an edit to the Page below them", () => {
    const signed = page.replace("Thanks.", "Thanks, Sam.");
    const result = acceptInOrder([...host, ...vendor], true, signed);
    expect(result.failed).toBeNull();
    expect(result.body).toBe(approved.replace("Thanks.", "Thanks, Sam."));
  });

  it("still refuses a piece whose words someone else changed", () => {
    const pieces = [...host, ...vendor];
    const target = pieceChanging(vendor, "can");
    const earlier = pieces.slice(0, pieces.indexOf(target));
    const before = acceptInOrder(earlier);
    expect(before.failed).toBeNull();
    const edited = before.body.replace(" can point at", " could point at");
    expect(edited).not.toBe(before.body);
    expect(
      applyMarkdownSuggestionWithSiblings(
        edited,
        target,
        earlier.map(accepted),
      ),
    ).toBeNull();
  });

  it("refuses a piece whose context someone repeated elsewhere", () => {
    // Accepting "A" to "C" makes the text around the first "foo" unique. Then
    // someone rewrites that "foo" and changes the second copy's "A" to "C":
    // the context is unique on the Page too, but around the wrong "foo".
    const left = `${"x".repeat(20)} A ${"x".repeat(10)} `;
    const block = `${left}foo ${"y".repeat(40)}`;
    const before = `${block}\n\nMIDDLE\n\n${block}`;
    const from = left.length;
    const operation = {
      kind: "replace_text",
      before: { markdown: before, changedText: "foo" },
      after: {
        markdown: `${before.slice(0, from)}new${before.slice(from + 3)}`,
        changedText: "new",
      },
      anchor: { from, to: from + 3, prefix: " ", suffix: " " },
    };
    const sibling = {
      from: before.indexOf("A"),
      to: before.indexOf("A") + 1,
      text: "C",
    };
    const current = `${block.replace("A", "C").replace("foo", "bar")}\n\nMIDDLE\n\n${block.replace("A", "C")}`;
    expect(
      applyMarkdownSuggestionWithSiblings(current, operation, [sibling]),
    ).toBeNull();
  });
});

describe("rebaseOntoAcceptedSiblings", () => {
  const target = pieceChanging(vendor, "can");
  const earlier = vendor.slice(0, vendor.indexOf(target));

  it("needs the text every accepted sibling wrote", () => {
    expect(
      rebaseOntoAcceptedSiblings(
        target,
        earlier.map(({ anchor }) => ({ from: anchor.from, to: anchor.to })),
      ),
    ).toBeNull();
  });

  it("refuses a sibling that overlaps the suggestion", () => {
    expect(
      rebaseOntoAcceptedSiblings(target, [
        { from: target.anchor.from, to: target.anchor.to, text: "x" },
      ]),
    ).toBeNull();
  });

  it("refuses two insertions at the same place", () => {
    const at = target.anchor.to + 1;
    expect(
      rebaseOntoAcceptedSiblings(target, [
        { from: at, to: at, text: "a" },
        { from: at, to: at, text: "b" },
      ]),
    ).toBeNull();
  });

  it("rebuilds the before-text as the siblings left it", () => {
    const rebased = rebaseOntoAcceptedSiblings(target, earlier.map(accepted));
    expect(rebased?.text).toBe(
      earlier.reduceRight(
        (text, piece) =>
          `${text.slice(0, piece.anchor.from)}${piece.after.changedText}${text.slice(piece.anchor.to)}`,
        page,
      ),
    );
    expect(rebased && rebased.text.slice(rebased.from, rebased.to)).toBe("can");
  });
});
