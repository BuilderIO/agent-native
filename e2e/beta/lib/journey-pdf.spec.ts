import assert from "node:assert/strict";
import test from "node:test";

import { buildMinimalPdf } from "./journey-pdf";

function text(pdf: Buffer): string {
  return pdf.toString("latin1");
}

test("starts with the PDF signature the Slides upload route checks", () => {
  const pdf = buildMinimalPdf(["one"]);
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(text(pdf), /%%EOF\n$/);
});

test("declares one page object per page and the matching count", () => {
  const pdf = text(buildMinimalPdf(["one", "two", "three"]));
  assert.match(pdf, /\/Count 3 >>/);
  assert.equal(pdf.match(/\/Type \/Page /g)?.length, 3);
  assert.match(pdf, /\/Kids \[4 0 R 6 0 R 8 0 R\]/);
});

test("every xref entry points at the start of its own object", () => {
  const pdf = text(buildMinimalPdf(["alpha", "beta"]));
  const startxref = Number(pdf.match(/startxref\n(\d+)\n/)?.[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");

  const entries = [...pdf.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map(
    (match) => Number(match[1]),
  );
  assert.equal(entries.length, 7);
  entries.forEach((offset, index) => {
    assert.equal(
      pdf.slice(offset, offset + `${index + 1} 0 obj`.length),
      `${index + 1} 0 obj`,
    );
  });
});

test("stream lengths match the bytes they declare", () => {
  const pdf = text(buildMinimalPdf(["hello"]));
  const match = pdf.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.ok(match);
  assert.equal(Number(match[1]), match[2].length);
});

test("escapes text that would break the string literal", () => {
  const pdf = text(buildMinimalPdf(["a (b) \\ cé"]));
  assert.match(pdf, /\(a \\\(b\\\) \\\\ c\?\) Tj/);
});

test("refuses an empty document", () => {
  assert.throws(() => buildMinimalPdf([]), /at least one page/);
});
