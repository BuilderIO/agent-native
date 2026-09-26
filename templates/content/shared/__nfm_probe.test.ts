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
    const nfm = "parent\n\tchild";
    const editor1 = parseNfmForEditor(nfm);
    const stored1 = serializeEditorToNfm(editor1);
    const editor2 = parseNfmForEditor(stored1);
    const stored2 = serializeEditorToNfm(editor2);
    show("VI editor1", editor1);
    show("VI stored1", stored1);
    show("VI editor2", editor2);
    show("VI stored2", stored2);
    show("VI stable?", String(stored1 === stored2));

    show("emsp-entity input", parseNfmForEditor("\tchild"));
    const emspChild = `${VISUAL_INDENT}child`;
    show("emsp-char back-to-storage", normalizeNfmForStorage(emspChild));

    const eq = "$$\nx^2\n$$";
    const e1 = parseNfmForEditor(eq);
    const st1 = serializeEditorToNfm(e1);
    show("EQ editor", e1);
    show("EQ stored", st1);

    show("EQ storage direct", normalizeNfmForStorage(eq));

    const q = "> Real quote block";
    const qe = parseNfmForEditor(q);
    show("QUOTE editor (pull)", qe);
    const qs = serializeEditorToNfm(qe);
    show("QUOTE stored (push)", qs);

    show("escaped-gt", normalizeNfmForStorage("\\> not a quote"));

    show("bare-quote->storage", normalizeNfmForStorage(">"));

    const deep = "a\n\tb\n\tc";
    const de = parseNfmForEditor(deep);
    show("siblings editor", de);
    const ds = serializeEditorToNfm(de);
    show("siblings stored", ds);

    const th = '## Section {toggle="true"}\n\tchild line';
    show("TH storage", normalizeNfmForStorage(th));
    show("TH notion", normalizeNfmForNotion(th));

    fs.writeFileSync("/tmp/nfm_probe2_out.txt", out.join("\n\n"));
  });
});
