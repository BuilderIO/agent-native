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
];

const proposals = edits.map((edit) => {
  const start = page.indexOf(edit.find);
  return markdownSuggestionOperationsForFindReplace({
    before: page,
    find: edit.find,
    replace: edit.replace,
    start,
  });
});

const approved = edits.reduce(
  (text, edit) => text.replace(edit.find, edit.replace),
  page,
);

type Operation = (typeof proposals)[number][number];

const accepted = (operation: Operation): AcceptedSiblingRange => ({
  from: operation.anchor.from,
  to: operation.anchor.to,
  text: operation.after.changedText,
});

/** Accepts each piece in turn, as the server does, or reports the first that fails. */
function acceptInOrder(pieces: Operation[], withText = true) {
  let body = page;
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
    const [vendor] = proposals;
    expect(vendor!.length).toBeGreaterThan(5);
    expect(
      vendor!.filter(
        (operation) =>
          operation.anchor.prefix === " " && operation.anchor.suffix === " ",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("places every piece when the edit below is accepted first", () => {
    const [vendor, host] = proposals;
    const result = acceptInOrder([...host!, ...vendor!]);
    expect(result.failed).toBeNull();
    expect(result.body).toBe(approved);
  });

  it("places every piece in page order and in reverse", () => {
    const pieces = proposals.flat();
    expect(acceptInOrder(pieces).body).toBe(approved);
    const reversed = acceptInOrder([...pieces].reverse());
    expect(reversed.failed).toBeNull();
    expect(reversed.body).toBe(approved);
  });

  it("needed the text the siblings wrote", () => {
    const [vendor, host] = proposals;
    expect(acceptInOrder([...host!, ...vendor!], false).failed).not.toBeNull();
  });

  it("still refuses a piece whose words someone else changed", () => {
    const [vendor, host] = proposals;
    const pieces = [...host!, ...vendor!];
    const target = vendor!.find(
      (operation) => operation.before.changedText === "can",
    )!;
    const before = acceptInOrder(pieces.slice(0, pieces.indexOf(target)));
    expect(before.failed).toBeNull();
    const edited = before.body.replace(" can point at", " could point at");
    expect(edited).not.toBe(before.body);
    const done = pieces.slice(0, pieces.indexOf(target)).map(accepted);
    expect(
      applyMarkdownSuggestionWithSiblings(edited, target, done),
    ).toBeNull();
  });
});

describe("rebaseOntoAcceptedSiblings", () => {
  const [vendor] = proposals;
  const target = vendor![3]!;

  it("needs the text every accepted sibling wrote", () => {
    const sibling = vendor![2]!;
    expect(
      rebaseOntoAcceptedSiblings(target, [
        { from: sibling.anchor.from, to: sibling.anchor.to },
      ]),
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

  it("reads its context from the text the siblings left", () => {
    const earlier = vendor!.slice(0, 3).map(accepted);
    const rebased = rebaseOntoAcceptedSiblings(target, earlier)!;
    const text = rebased.before.markdown;
    expect(text.slice(rebased.anchor.from, rebased.anchor.to)).toBe(
      target.before.changedText,
    );
    expect(rebased.anchor.prefix.length).toBe(32);
    expect(
      text.slice(0, rebased.anchor.from).endsWith(rebased.anchor.prefix),
    ).toBe(true);
    expect(rebased.after.markdown).toBe(
      text.slice(0, rebased.anchor.from) +
        target.after.changedText +
        text.slice(rebased.anchor.to),
    );
  });
});
