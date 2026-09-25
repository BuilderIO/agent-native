import fs from "node:fs";

import { describe, it } from "vitest";

import {
  VISUAL_INDENT,
  parseNfmForEditor,
  normalizeNfmForStorage,
  normalizeNfmForNotion,
  serializeEditorToNfm,
} from "./notion-markdown";

const out: string[] = [];
const show = (label: string, s: string) =>
  out.push(`=== ${label} ===\n${JSON.stringify(s)}`);

describe("probe2", () => {
  it("runs", () => {
    // full pull/edit/push cycle for visual indent: editor uses em-space VISUAL_INDENT,
    // storage uses &emsp; entity. Does a no-edit cycle drift?
    const nfm = "parent\n\tchild";
    const editor1 = parseNfmForEditor(nfm); // pull
    const stored1 = serializeEditorToNfm(editor1); // push back to storage (no edit)
    const editor2 = parseNfmForEditor(stored1); // pull again
    const stored2 = serializeEditorToNfm(editor2);
    show("VI editor1", editor1);
    show("VI stored1", stored1);
    show("VI editor2", editor2);
    show("VI stored2", stored2);
    show("VI stable?", String(stored1 === stored2));

    // em-space vs entity: what does editor produce and does &emsp; in editor input survive?
    show("emsp-entity input", parseNfmForEditor("\tchild"));
    // editor would actually contain the literal em-space char VISUAL_INDENT; feed that back
    const emspChild = `${VISUAL_INDENT}child`;
    show("emsp-char back-to-storage", normalizeNfmForStorage(emspChild));

    // block equation idempotency through full cycle
    const eq = "$$\nx^2\n$$";
    const e1 = parseNfmForEditor(eq);
    const st1 = serializeEditorToNfm(e1);
    show("EQ editor", e1);
    show("EQ stored", st1);

    // Does normalizeNfmForStorage wreck a block equation? $$ lines look like dividers?
    show("EQ storage direct", normalizeNfmForStorage(eq));

    // divider after equation - separateDividers won't touch $$ but does --- get mangled
    // Leading '>' plain text quote that is REAL notion quote becomes tab -> visual indent on pull
    const q = "> Real quote block";
    const qe = parseNfmForEditor(q);
    show("QUOTE editor (pull)", qe);
    const qs = serializeEditorToNfm(qe);
    show("QUOTE stored (push)", qs);

    // multi-paragraph that has a line starting with literal '>' as text content (escaped in NFM)
    show("escaped-gt", normalizeNfmForStorage("\\> not a quote"));

    // empty quote line
    show("bare-quote->storage", normalizeNfmForStorage(">"));

    // nested list visual-indent insertion blowup: indent text then re-pull
    const deep = "a\n\tb\n\tc"; // two siblings under a
    const de = parseNfmForEditor(deep);
    show("siblings editor", de);
    const ds = serializeEditorToNfm(de);
    show("siblings stored", ds);

    // toggle-heading children to Notion: child should be tab-indented under heading;
    // but it's a {toggle} heading, normalizeDetailsForNotion ignores it
    const th = '## Section {toggle="true"}\n\tchild line';
    show("TH storage", normalizeNfmForStorage(th));
    show("TH notion", normalizeNfmForNotion(th));

    fs.writeFileSync("/tmp/nfm_probe2_out.txt", out.join("\n\n"));
  });
});
