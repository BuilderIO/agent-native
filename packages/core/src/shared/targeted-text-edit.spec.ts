import { describe, expect, it } from "vitest";

import {
  applyTargetedReplace,
  findTargetedMatches,
  type TargetedCandidate,
} from "./targeted-text-edit.js";

describe("findTargetedMatches", () => {
  it("finds an exact substring match", () => {
    const result = findTargetedMatches("<div>Hello</div>", "Hello");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      index: 5,
      end: 10,
      line: 1,
      text: "Hello",
    });
  });

  it("reports 1-based line numbers", () => {
    const result = findTargetedMatches("one\ntwo\nthree", "three");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0]?.line).toBe(3);
  });

  it("reports a whitespace-flexible hit as a not_found candidate instead of applying it", () => {
    const content = "<span>Hello   World</span>";
    const result = findTargetedMatches(content, "Hello World");
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "not_found") return;
    expect(result.candidates[0]).toMatchObject({
      line: 1,
      text: "Hello   World",
      similarity: 1,
    });
  });

  it("reports a CRLF-vs-LF hit as a not_found candidate instead of applying it", () => {
    const content = "a\nb";
    const result = findTargetedMatches(content, "a\r\nb");
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "not_found") return;
    expect(result.candidates[0]).toMatchObject({
      line: 1,
      text: "a\nb",
      similarity: 1,
    });
  });

  it("reports Prettier-style spacing around punctuation as a whitespace-only candidate with the stored bytes", () => {
    const content = '<div style="padding:32px 64px;"><p>Hi</p></div>';
    const result = findTargetedMatches(content, "padding: 32px 64px;");
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const candidates = (result as { candidates: TargetedCandidate[] })
      .candidates;
    expect(candidates[0]).toMatchObject({
      text: "padding:32px 64px;",
      similarity: 1,
      whitespaceOnly: true,
    });
  });

  it("reports a multi-line quote that differs only in formatting as a whitespace-only candidate", () => {
    const content = '<div class="s"><h1>Q3</h1><p>Up 12%</p></div>';
    const quote = '<div class="s">\n  <h1>Q3</h1>\n  <p>Up 12%</p>\n</div>';
    const result = findTargetedMatches(content, quote);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const candidates = (result as { candidates: TargetedCandidate[] })
      .candidates;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toMatchObject({
      text: content,
      whitespaceOnly: true,
    });
  });

  it("scores token-overlap windows when the quote has more lines than the content", () => {
    const content = '<div class="s"><h1>Q3</h1><p>Up 12%</p></div>';
    const quote = '<div class="s">\n  <h1>Q4</h1>\n  <p>Up 15%</p>\n</div>';
    const result = findTargetedMatches(content, quote);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const candidates = (result as { candidates: TargetedCandidate[] })
      .candidates;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]).toMatchObject({ text: content });
    expect(candidates[0]?.whitespaceOnly).toBeUndefined();
  });

  it("marks a flexible hit incomplete when the quote's boundary whitespace was omitted", () => {
    const content = "color:red; font-size:12px;";
    const result = findTargetedMatches(content, " font-size: 12px ");
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const candidates = (result as { candidates: TargetedCandidate[] })
      .candidates;
    expect(candidates[0]).toMatchObject({
      text: "font-size:12px",
      whitespaceOnly: false,
      excerpt: true,
    });
  });

  it("does not mark a whitespace-only candidate that was cut at the snippet limit", () => {
    const items = Array.from(
      { length: 12 },
      (_, i) => `<li style="margin:0;padding:4px;">Item number ${i}</li>`,
    ).join("");
    const content = `<ul style="list-style:none;">${items}</ul>`;
    const quote = content.replace(/></g, ">\n  <").replace(/:/g, ": ");
    const result = findTargetedMatches(content, quote);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const candidates = (result as { candidates: TargetedCandidate[] })
      .candidates;
    expect(candidates[0]).toMatchObject({ similarity: 1 });
    expect(candidates[0]?.text.endsWith("…")).toBe(true);
    expect(candidates[0]).toMatchObject({ whitespaceOnly: false });
  });

  it("lists both near-identical blocks when only spacing between tags differs", () => {
    const content = "<p><b>A</b><i>x</i></p><p><b>A</b> <i>x</i></p>";
    const result = findTargetedMatches(content, "</b>  <i>x");
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const texts = (
      result as { candidates: TargetedCandidate[] }
    ).candidates.map((c) => c.text);
    expect(texts).toEqual(["</b><i>x", "</b> <i>x"]);
  });

  it("never applies a punctuation-spacing match", () => {
    const result = applyTargetedReplace(
      '<div style="padding:32px 64px;">',
      "padding: 32px 64px;",
      "padding: 20px 64px;",
    );
    expect(result.ok).toBe(false);
    expect("content" in result).toBe(false);
  });

  it("does not flag a loose token-overlap candidate as whitespace-only", () => {
    const result = findTargetedMatches("<h1>Q3 Revenue</h1>", "Q3 Revenues");
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    const candidates = (result as { candidates: TargetedCandidate[] })
      .candidates;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.whitespaceOnly).toBeUndefined();
  });

  it("returns not_found with closest-match candidates when nothing matches", () => {
    const content = ["line one", "the target line", "line three"].join("\n");
    const result = findTargetedMatches(content, "totally missing text");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.line).toBeGreaterThan(0);
  });

  it("marks individual lines from a multiline mismatch as incomplete excerpts", () => {
    const content = "<div>\nHello world\n</div>";
    const result = applyTargetedReplace(
      content,
      "<div>\nHello worlds\n</div>",
      "replacement",
    );
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    if (result.ok || result.reason !== "not_found")
      throw new Error("Expected a miss");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(
      result.candidates.every(
        (candidate) => candidate.excerpt && !candidate.whitespaceOnly,
      ),
    ).toBe(true);
    expect(
      result.candidates.some((candidate) =>
        candidate.text.includes("Hello world"),
      ),
    ).toBe(true);
    expect("content" in result).toBe(false);
  });

  it.each(["<p>Alpha Beta</p>\r\n", "\n<p>Alpha Beta</p>"])(
    "never presents a whitespace-trimmed match as a complete copyable candidate: %j",
    (find) => {
      const content = "<p>Alpha   Beta</p>\nNEXT";
      const result = applyTargetedReplace(content, find, "replacement");
      expect(result).toMatchObject({ ok: false, reason: "not_found" });
      if (result.ok || result.reason !== "not_found")
        throw new Error("Expected a miss");
      expect(result.candidates[0]).toMatchObject({
        text: "<p>Alpha   Beta</p>",
        whitespaceOnly: false,
        excerpt: true,
      });
      expect("content" in result).toBe(false);
      expect(
        applyTargetedReplace(content, "<p>Alpha   Beta</p>\n", "replacement"),
      ).toMatchObject({ ok: true, content: "replacementNEXT" });
    },
  );

  it("shows post-match context for long identical ambiguous matches", () => {
    const match = `<p>${"common".repeat(60)}</p>`;
    const prefix = "x".repeat(150);
    const content = `${prefix}${match}<span>first destination</span>${prefix}${match}<span>second destination</span>`;
    const result = applyTargetedReplace(content, match, "changed");
    expect(result).toMatchObject({ ok: false, reason: "ambiguous" });
    if (result.ok || result.reason !== "ambiguous")
      throw new Error("Expected ambiguity");
    expect(result.matches[0]?.snippet).toContain("first destination");
    expect(result.matches[1]?.snippet).toContain("second destination");
    expect(result.matches[0]?.snippet.length).toBeLessThanOrEqual(140);
    expect(result.matches[1]?.snippet.length).toBeLessThanOrEqual(140);
    expect("content" in result).toBe(false);
    expect(
      applyTargetedReplace(content, match, "changed", { occurrence: 2 }),
    ).toMatchObject({
      ok: true,
      content: `${prefix}${match}<span>first destination</span>${prefix}changed<span>second destination</span>`,
    });
  });

  it("finds a useful bounded excerpt near a late one-line non-whitespace mismatch", () => {
    const content = `<main>${'<div class="filler">Nothing</div>'.repeat(100)}<section id="revenue"><h2>Annual revenue</h2><p>Actual total: $42 million</p></section></main>`;
    const result = applyTargetedReplace(
      content,
      '<section id="revenue"><h2>Annual revenue</h2><p>Actual total: $43 million</p></section>',
      "replacement",
    );
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    if (result.ok || result.reason !== "not_found")
      throw new Error("Expected a miss");
    expect(result.candidates[0]?.text).toContain("Actual total: $42 million");
    expect(result.candidates[0]?.text.length).toBeLessThanOrEqual(162);
    expect(result.candidates[0]?.whitespaceOnly).not.toBe(true);
    expect(result.candidates[0]).toMatchObject({ excerpt: true });
    expect("content" in result).toBe(false);
    const anchor = result.candidates[0]?.text.match(
      /Actual total: \$\d+ million/,
    )?.[0];
    expect(anchor).toBe("Actual total: $42 million");
    if (!anchor) throw new Error("Expected a recoverable anchor");
    expect(applyTargetedReplace(content, anchor, "Updated")).toMatchObject({
      ok: true,
      content: content.replace("Actual total: $42 million", "Updated"),
    });
  });

  it("shows the late difference in a long whitespace-only match as an incomplete excerpt", () => {
    const stored = `<section>${"<p>Unchanged content</p>".repeat(30)}<p>Revenue   total</p></section>`;
    const result = findTargetedMatches(
      stored,
      stored.replace("Revenue   total", "Revenue total"),
    );
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    if (result.ok || result.reason !== "not_found")
      throw new Error("Expected a miss");
    expect(result.candidates[0]?.text).toContain("Revenue   total");
    expect(result.candidates[0]).toMatchObject({
      whitespaceOnly: false,
      excerpt: true,
    });
  });

  it("provides occurrence and surrounding context for safe retries on a minified line", () => {
    const content = `<main>${"x".repeat(250)}<section id="first"><p>Same</p></section>${"y".repeat(250)}<section id="second"><p>Same</p></section></main>`;
    const result = applyTargetedReplace(
      content,
      "<p>Same</p>",
      "<p>Changed</p>",
    );
    expect(result).toMatchObject({ ok: false, reason: "ambiguous" });
    if (result.ok || result.reason !== "ambiguous")
      throw new Error("Expected ambiguity");
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({ line: 1, occurrence: 1 });
    expect(result.matches[1]).toMatchObject({ line: 1, occurrence: 2 });
    expect(result.matches[0]?.snippet).toContain('id="first"');
    expect(result.matches[1]?.snippet).toContain('id="second"');
    expect("content" in result).toBe(false);
    expect(
      applyTargetedReplace(content, "<p>Same</p>", "<p>Changed</p>", {
        occurrence: result.matches[1]?.occurrence,
      }),
    ).toMatchObject({
      ok: true,
      content: content.replace(
        '<section id="second"><p>Same</p>',
        '<section id="second"><p>Changed</p>',
      ),
    });
  });

  it("returns ambiguous when the text matches more than once and no occurrence/all is given", () => {
    const content = "<p>Same</p><p>Same</p>";
    const result = findTargetedMatches(content, "<p>Same</p>");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("ambiguous");
    expect(result.matches).toHaveLength(2);
  });

  it("does not flag ambiguity when the caller passes occurrence", () => {
    const content = "<p>Same</p><p>Same</p>";
    const result = findTargetedMatches(content, "<p>Same</p>", {
      occurrence: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(2);
  });

  it("does not flag ambiguity when the caller passes all", () => {
    const content = "<p>Same</p><p>Same</p>";
    const result = findTargetedMatches(content, "<p>Same</p>", { all: true });
    expect(result.ok).toBe(true);
  });

  it("never throws on empty find text", () => {
    const result = findTargetedMatches("anything", "");
    expect(result).toEqual({ ok: false, reason: "not_found", candidates: [] });
  });

  it.each([0, 0.5, -1, NaN])(
    "reports an invalid occurrence (%s) instead of silently coercing to 1",
    (occurrence) => {
      const result = findTargetedMatches(
        "<p>Same</p><p>Same</p>",
        "<p>Same</p>",
        {
          occurrence,
        },
      );
      expect(result).toEqual({
        ok: false,
        reason: "invalid_occurrence",
        occurrence,
      });
    },
  );

  it("reports occurrence_out_of_range (a distinct reason from not_found) when matches exist but fewer than requested", () => {
    const content = "<p>Same</p>";
    const result = findTargetedMatches(content, "<p>Same</p>", {
      occurrence: 2,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "occurrence_out_of_range",
      occurrence: 2,
      matchCount: 1,
    });
    if (result.ok || result.reason !== "occurrence_out_of_range") return;
    expect(result.matches).toHaveLength(1);
  });
});

describe("applyTargetedReplace", () => {
  it("replaces the sole match and leaves the rest of the document untouched", () => {
    const result = applyTargetedReplace(
      "<div>Old</div><p>Keep</p>",
      "Old",
      "New",
    );
    expect(result).toMatchObject({
      ok: true,
      content: "<div>New</div><p>Keep</p>",
    });
  });

  it("never applies a whitespace-flexible match — reports it as a not_found candidate, content untouched", () => {
    const content = "<span>Hello   World</span>";
    const result = applyTargetedReplace(content, "Hello World", "Hi There");
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    if (result.ok || result.reason !== "not_found") return;
    expect(result.candidates[0]).toMatchObject({
      text: "Hello   World",
      similarity: 1,
    });
  });

  it("replaces only the requested occurrence", () => {
    const content = "<p>Same</p><p>Same</p>";
    const result = applyTargetedReplace(
      content,
      "<p>Same</p>",
      "<p>Different</p>",
      {
        occurrence: 2,
      },
    );
    expect(result).toMatchObject({
      ok: true,
      content: "<p>Same</p><p>Different</p>",
    });
  });

  it("replaces every match when all is set", () => {
    const content = "<p>Same</p><p>Same</p>";
    const result = applyTargetedReplace(
      content,
      "<p>Same</p>",
      "<p>Different</p>",
      {
        all: true,
      },
    );
    expect(result).toMatchObject({
      ok: true,
      content: "<p>Different</p><p>Different</p>",
      matchCount: 2,
    });
  });

  it("returns ambiguous instead of silently replacing the first match", () => {
    const content = "<p>Same</p><p>Same</p>";
    const result = applyTargetedReplace(
      content,
      "<p>Same</p>",
      "<p>Different</p>",
    );
    expect(result).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(
      applyTargetedReplace(content, "<p>Same</p>", "<p>Different</p>"),
    ).toMatchObject({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("returns occurrence_out_of_range (not not_found) when matches exist but fewer than requested", () => {
    const content = "<p>Same</p>";
    const result = applyTargetedReplace(
      content,
      "<p>Same</p>",
      "<p>Different</p>",
      {
        occurrence: 2,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "occurrence_out_of_range",
      occurrence: 2,
      matchCount: 1,
    });
    if (result.ok || result.reason !== "occurrence_out_of_range") return;
    expect(result.matches).toHaveLength(1);
  });

  it.each([0, 0.5, -1, NaN])(
    "rejects an invalid occurrence (%s) instead of silently coercing to 1",
    (occurrence) => {
      const content = "<p>Same</p><p>Same</p>";
      const result = applyTargetedReplace(
        content,
        "<p>Same</p>",
        "<p>Different</p>",
        { occurrence },
      );
      expect(result).toEqual({
        ok: false,
        reason: "invalid_occurrence",
        occurrence,
      });
    },
  );

  it("lets occurrence win over all when both are given", () => {
    const content = "<p>Same</p><p>Same</p><p>Same</p>";
    const result = applyTargetedReplace(
      content,
      "<p>Same</p>",
      "<p>Different</p>",
      { occurrence: 2, all: true },
    );
    expect(result).toMatchObject({
      ok: true,
      content: "<p>Same</p><p>Different</p><p>Same</p>",
    });
  });
});
