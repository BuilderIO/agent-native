import { describe, expect, it } from "vitest";

import {
  assertDesignHtmlCreateIntegrity,
  assertDesignHtmlEditIntegrity,
  assertDesignHtmlWellFormed,
  DESIGN_HTML_INTEGRITY_ERROR_CODE,
  inspectDesignHtmlDocumentIntegrity,
} from "./html-integrity";

const DOCUMENT = `<!doctype html>
<html><head><style data-agent-native-breakpoints>
@media (max-width: 1279px) { [data-agent-native-node-id="an-1"] { font-family: Poppins, sans-serif; } }
</style></head><body x-data="{ open: true }"><template x-if="open"><p>Hi</p></template></body></html>`;

describe("Design HTML integrity", () => {
  it("accepts complete Alpine documents and balanced managed raw-text blocks", () => {
    expect(inspectDesignHtmlDocumentIntegrity(DOCUMENT)).toEqual({
      valid: true,
    });
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: DOCUMENT.replace("Hi", "Hello"),
        fileType: "html",
      }),
    ).not.toThrow();
  });

  it("rejects x-cloak without the CSS rule that hides it before Alpine starts", () => {
    const document = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script><style>.panel{display:block}</style></head><body><div x-cloak class="panel">Hidden until ready</div></body></html>`;
    const result = inspectDesignHtmlDocumentIntegrity(document);
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("runtime-cloak-missing");
    expect(result.detail?.[0]).toMatchObject({
      tag: "div",
      attribute: "x-cloak",
    });
    expect(() =>
      assertDesignHtmlCreateIntegrity({
        content: document,
        fileType: "html",
        filename: "index.html",
      }),
    ).toThrow(/x-cloak/);
  });

  it("accepts x-cloak when the document defines its pre-Alpine hiding rule", () => {
    const document = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script><style>[x-cloak] { display: none !important; } .panel{display:block}</style></head><body><div x-cloak class="panel">Hidden until ready</div></body></html>`;
    expect(inspectDesignHtmlDocumentIntegrity(document)).toEqual({
      valid: true,
    });
  });

  it("rejects x-cloak when the Alpine script URL is malformed", () => {
    const document = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/[email protected]/dist/cdn.min.js"></script><style>[x-cloak]{display:none!important}</style></head><body><div x-cloak>Hidden forever</div></body></html>`;
    const result = inspectDesignHtmlDocumentIntegrity(document);
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("runtime-alpine-missing");
    expect(result.detail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issue: "runtime-alpine-missing" }),
      ]),
    );
  });

  it.each([
    ["a grouped selector", "[x-cloak], .cloak { display: none !important; }"],
    ["the Tailwind idiom", "[x-cloak] { @apply hidden; }"],
    ["visibility instead of display", "[x-cloak] { visibility: hidden; }"],
  ])("accepts a pre-Alpine hiding rule written as %s", (_name, rule) => {
    const document = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script><style>${rule}</style></head><body><div x-cloak class="fixed inset-0">Alerts</div></body></html>`;
    expect(inspectDesignHtmlDocumentIntegrity(document)).toEqual({
      valid: true,
    });
  });

  it("accepts x-cloak when the hiding rule could only live in a linked stylesheet", () => {
    // A stylesheet this parser cannot read is unknown, not missing — reporting
    // it as missing is the coercion this module exists to prevent.
    const document = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script><link rel="stylesheet" href="theme.css"></head><body><div x-cloak class="fixed inset-0">Alerts</div></body></html>`;
    expect(inspectDesignHtmlDocumentIntegrity(document)).toEqual({
      valid: true,
    });
  });

  it("accepts x-cloak pre-hidden by the element's own inline style", () => {
    const document = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script></head><body><div x-cloak style="display:none" class="fixed inset-0">Alerts</div></body></html>`;
    expect(inspectDesignHtmlDocumentIntegrity(document)).toEqual({
      valid: true,
    });
  });

  it("lets an unrelated edit save a screen that already lacked the rule", () => {
    // The person dragging on the canvas did not author this markup and cannot
    // add a CSS rule; refusing their edit would strand the screen.
    const broken = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script></head><body><h1>Ops</h1><div x-cloak class="fixed inset-0">Alerts</div></body></html>`;
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: broken,
        nextContent: broken.replace("<h1>Ops</h1>", "<h1>Operations</h1>"),
        fileType: "html",
      }),
    ).not.toThrow();
    // Still refused where it is authored rather than inherited.
    expect(() => assertDesignHtmlWellFormed({ content: broken })).toThrow(
      /x-cloak/,
    );
  });

  it("still blocks an edit that introduces the missing rule", () => {
    const sound = `<!doctype html><html><head><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script><style>[x-cloak]{display:none!important}</style></head><body><div x-cloak class="fixed inset-0">Alerts</div></body></html>`;
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: sound,
        nextContent: sound.replace("[x-cloak]{display:none!important}", ""),
        fileType: "html",
      }),
    ).toThrow(/x-cloak/);
  });

  it("rejects the screenshot-like missing managed style opener", () => {
    const corrupted = DOCUMENT.replace(
      "<style data-agent-native-breakpoints>",
      'data-agent-native-breakpoints">',
    );

    // The structural pass reaches this before the raw-text count does, and
    // reports the stray `</style>` with its line instead of the unlocated
    // "raw text is unbalanced somewhere" verdict. Same rejection, narrower cause.
    const result = inspectDesignHtmlDocumentIntegrity(corrupted);
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("close-tag-orphaned");
    expect(result.detail?.[0]).toMatchObject({ tag: "style", line: 4 });
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: corrupted,
        fileType: "html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it.each([
    ["style close", DOCUMENT.replace("</style>", "")],
    ["body close", DOCUMENT.replace("</body>", "")],
    ["root close", DOCUMENT.replace("</html>", "")],
    [
      "orphaned marker",
      DOCUMENT.replace("</style>", '</style>data-agent-native-breakpoints">'),
    ],
    [
      "duplicate managed style",
      DOCUMENT.replace(
        "</head>",
        "<style data-agent-native-breakpoints>.x{color:red}</style></head>",
      ),
    ],
    ["raw prefix", `@media(max-width:1px){}${DOCUMENT}`],
  ])("rejects a malformed %s transition", (_label, corrupted) => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: corrupted,
        fileType: "html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it("does not reject Alpine/template fragments that are intentionally not documents", () => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent:
          '<section x-data="{}"><template x-for="x in xs"></template></section>',
        nextContent:
          '<section x-data="{ open: true }"><template x-if="open"><p>Hi</p></template></section>',
        fileType: "html",
      }),
    ).not.toThrow();
  });

  it("does not mistake tag-shaped Alpine attributes, comments, or script strings for a document root", () => {
    for (const fragment of [
      `<section x-data="{ sample: '<html><body></body></html>' }"><p>Hi</p></section>`,
      `<section x-data="{ sample: '>' + '<html><body></body></html>' }"><p>Hi</p></section>`,
      `<section><!-- example: <html><body></body></html> --><p>Hi</p></section>`,
      `<section><script>const sample = '<html><body></body></html>'</script><template x-if="true"><p>Hi</p></template></section>`,
    ]) {
      expect(inspectDesignHtmlDocumentIntegrity(fragment)).toEqual({
        valid: true,
      });
      expect(() =>
        assertDesignHtmlEditIntegrity({
          previousContent: fragment,
          nextContent: fragment.replace("Hi", "Hello"),
          fileType: "html",
        }),
      ).not.toThrow();
    }
  });

  it("ignores tag and managed-marker strings inside legitimate raw-text bodies", () => {
    const withCodeStrings = DOCUMENT.replace(
      "</head>",
      `<script>
        const example = '<html><body><style data-agent-native-motion>.x{}</style></body></html>';
        const selector = 'style[data-agent-native-breakpoints]';
      </script></head>`,
    );
    expect(inspectDesignHtmlDocumentIntegrity(withCodeStrings)).toEqual({
      valid: true,
    });
  });

  it("does not count root or raw-text tags inside Alpine attributes and comments", () => {
    const withMarkupExamples = DOCUMENT.replace(
      '<body x-data="{ open: true }">',
      `<body x-data="{ open: true, sample: '<style></style><body></body>' }">
        <!-- example only: <script></script><html><head></head><body></body></html> -->`,
    );

    expect(inspectDesignHtmlDocumentIntegrity(withMarkupExamples)).toEqual({
      valid: true,
    });
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: withMarkupExamples,
        fileType: "html",
      }),
    ).not.toThrow();
  });

  it("allows a malformed legacy document to be repaired but not re-saved malformed", () => {
    const corrupted = DOCUMENT.replace(
      "</style>",
      '</style>data-agent-native-breakpoints">',
    );
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: corrupted,
        nextContent: DOCUMENT,
        fileType: "html",
      }),
    ).not.toThrow();
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: corrupted,
        nextContent: corrupted.replace("Hi", "Still broken"),
        fileType: "html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it("does not police CSS, JSX, or asset files", () => {
    for (const fileType of ["css", "jsx", "asset"]) {
      expect(() =>
        assertDesignHtmlEditIntegrity({
          previousContent: DOCUMENT,
          nextContent: "not html",
          fileType,
        }),
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Structural pass
//
// Every case below persisted silently before this pass existed: the counting
// checks are blind to nesting, so an unclosed element or a stray closing tag
// left all root-tag counts intact. The browser's HTML parser recovers from all
// of them without an error, which is why nothing downstream ever reported them.
// ---------------------------------------------------------------------------

const SCREEN = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style>:root { --color-accent: #0EA5E9; }</style>
</head><body class="bg-white"><div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div></body></html>`;

describe("Design HTML structural integrity", () => {
  it("accepts a well-formed generated screen", () => {
    expect(inspectDesignHtmlDocumentIntegrity(SCREEN)).toEqual({ valid: true });
  });

  it("names the unterminated attribute rather than the root tags it swallows", () => {
    const corrupted = SCREEN.replace(
      'src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"',
      'src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
    );
    const result = inspectDesignHtmlDocumentIntegrity(corrupted);
    expect(result.valid).toBe(false);
    // The counting pass would have reported `document-root` here — accurate as a
    // symptom, useless as a fix, because <html> is present and correct.
    expect(result.issue).toBe("attribute-unterminated");
    expect(result.detail?.[0]).toMatchObject({
      tag: "script",
      attribute: "src",
    });
    expect(result.detail?.[0]?.line).toBe(3);
  });

  it("detects an unterminated attribute even when a later quote re-syncs the tokenizer", () => {
    const corrupted = SCREEN.replace('class="bg-white"', 'class="bg-white');
    expect(inspectDesignHtmlDocumentIntegrity(corrupted).issue).toBe(
      "attribute-unterminated",
    );
  });

  it("detects an unclosed element and names what closed it instead", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace("</div></body>", "</body>"),
    );
    expect(result.issue).toBe("element-unclosed");
    expect(result.detail?.[0]).toMatchObject({
      tag: "div",
      closedBy: { tag: "body" },
    });
  });

  it("detects a closing tag with no opener", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace("<h1", "</section><h1"),
    );
    expect(result.issue).toBe("close-tag-orphaned");
    expect(result.detail?.[0]?.tag).toBe("section");
  });

  it("detects crossed nesting", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace(
        '<h1 class="text-3xl">Hi</h1></div>',
        '<h1 class="text-3xl">Hi</div></h1>',
      ),
    );
    expect(result.issue).toBe("element-unclosed");
    expect(result.detail?.[0]?.tag).toBe("h1");
  });

  it("detects a payload cut off mid-attribute", () => {
    const truncated = SCREEN.slice(0, SCREEN.indexOf('class="rounded-xl') + 12);
    expect(inspectDesignHtmlDocumentIntegrity(truncated).valid).toBe(false);
  });

  it("distinguishes a cut-off tag from an unterminated quote", () => {
    // Every quote here is closed; the TAG is what got cut off. Deciding this by
    // "is there a quote anywhere after this point" told the author to close a
    // quote that was already closed.
    const result = inspectDesignHtmlDocumentIntegrity(
      '<!doctype html><html><head></head><body><div class="a" data-y',
    );
    expect(result.issue).toBe("content-truncated");
    expect(
      inspectDesignHtmlDocumentIntegrity(
        '<!doctype html><html><head></head><body><div class="a',
      ).issue,
    ).toBe("attribute-unterminated");
  });

  it("reads a spaced closing tag as the character data it is", () => {
    // `< /div>` is text per the spec, not a close tag, so the <div> is never
    // closed and the parser closes it at </body>.
    const result = inspectDesignHtmlDocumentIntegrity(
      "<!doctype html><html><head></head><body><div>x< /div></body></html>",
    );
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("element-unclosed");
    expect(result.detail?.[0]).toMatchObject({ tag: "div" });
  });

  it("detects an unterminated comment", () => {
    expect(
      inspectDesignHtmlDocumentIntegrity(SCREEN.replace("<h1", "<!-- note <h1"))
        .issue,
    ).toBe("content-truncated");
  });

  it("checks fragments too — an unterminated quote is not a document-only defect", () => {
    expect(
      inspectDesignHtmlDocumentIntegrity(
        `<section class="grid gap-4><div class="card">Hi</div></section>`,
      ).issue,
    ).toBe("attribute-unterminated");
  });

  it.each([
    [
      "omitted </td> and </tr>",
      "<table><tbody><tr><td>a<td>b<tr><td>c</tbody></table>",
    ],
    ["omitted </li> and </p>", "<ul><li>a<li>b</ul><p>one<p>two"],
    [
      "void and self-closing elements",
      '<img src="x.png"><br><svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="1"/></svg>',
    ],
    [
      "closing tags inside script text",
      "<script>const s = '</div></body>'</script><div>ok</div>",
    ],
    [
      "closing tags inside a style body",
      "<style>/* </div> */ .a{color:red}</style><div>ok</div>",
    ],
  ])("does not flag legal authoring: %s", (_label, body) => {
    const document = SCREEN.replace(
      '<div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div>',
      body,
    );
    expect(inspectDesignHtmlDocumentIntegrity(document)).toEqual({
      valid: true,
    });
  });

  it("treats a literal closing tag in a script string as the break it is", () => {
    // Not a false positive: per the HTML spec, `</script>` inside a JS string
    // DOES end the element — which is why `"<\\/script>"` escaping exists. The
    // browser ends the script early, leaves `";` as text, and orphans the real
    // closer. Rejecting is the gate working, not over-reach.
    expect(
      inspectDesignHtmlDocumentIntegrity(
        SCREEN.replace(
          '<div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div>',
          '<script>const s = "</script>";</script>',
        ),
      ).valid,
    ).toBe(false);
  });

  it.each([
    [
      "title",
      "<!doctype html><html><head><title>Hi</head><body>x</body></html>",
    ],
    [
      "textarea",
      "<!doctype html><html><head></head><body><textarea>Hi<div>x</div></body></html>",
    ],
  ])("rejects an unclosed raw-text %s", (_label, html) => {
    expect(inspectDesignHtmlDocumentIntegrity(html).valid).toBe(false);
  });

  it.each([
    [
      "title",
      "<!doctype html><html><head><title>How to write <body></title></head><body>x</body></html>",
    ],
    [
      "textarea",
      "<!doctype html><html><head></head><body><textarea>paste <body> here</textarea></body></html>",
    ],
  ])(
    "does not read root tags inside a %s body as document markup",
    (_l, html) => {
      expect(inspectDesignHtmlDocumentIntegrity(html)).toEqual({ valid: true });
    },
  );

  it.each([
    [
      "an invalid end-tag prefix",
      '<script>const s = "</script=template>";</script>',
    ],
    ["a longer tag name", '<script>const s = "</scriptfoo>";</script>'],
  ])("does not treat %s as the raw-text closer", (_label, body) => {
    // A raw-text end tag closes the element only when the name is followed by
    // whitespace, `/`, or `>`. Matching a word boundary instead orphaned the
    // real closer, rejecting a document the browser parses fine.
    expect(
      inspectDesignHtmlDocumentIntegrity(
        SCREEN.replace(
          '<div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div>',
          `${body}<div class="p-6">ok</div>`,
        ),
      ),
    ).toEqual({ valid: true });
  });

  it.each([
    ["rtc", "<ruby>漢<rtc><rt>kan</ruby>"],
    ["rb", "<ruby><rb>漢<rt>kan</ruby>"],
  ])("accepts ruby markup with an omitted optional </%s>", (_label, body) => {
    expect(
      inspectDesignHtmlDocumentIntegrity(
        SCREEN.replace(
          '<div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div>',
          `<div class="p-6">${body}</div>`,
        ),
      ),
    ).toEqual({ valid: true });
  });

  it.each([
    ["li with an inline descendant", "<ul><li><span>one<li>two</ul>"],
    ["tr with an inline descendant", "<table><tr><td><b>a<tr><td>b</table>"],
    ["dt/dd with an inline descendant", "<dl><dt><em>k<dd>v</dl>"],
  ])("closes intervening elements on an implied close: %s", (_label, body) => {
    // The browser closes the descendant along with the list item, so popping
    // only the stack top reported the still-open <span> as unclosed.
    expect(
      inspectDesignHtmlDocumentIntegrity(
        SCREEN.replace(
          '<div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div>',
          `<div class="p-6">${body}</div>`,
        ),
      ),
    ).toEqual({ valid: true });
  });

  it("still reports a missing runtime when the only script tag is commented out", () => {
    const commentedOut = SCREEN.replace(
      '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
      '<!-- <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script> -->',
    );
    expect(
      inspectDesignHtmlDocumentIntegrity(commentedOut).advisory?.[0],
    ).toMatchObject({ issue: "runtime-missing" });
  });

  it("stays linear across many raw-text blocks", () => {
    // Slicing the remaining document per raw-text opener was quadratic
    // allocation on the synchronous save path.
    const build = (count: number) =>
      `<!doctype html><html><head><meta charset="UTF-8"></head><body>${"<style>.a{color:red}</style><script>var a=1</script>".repeat(count)}</body></html>`;
    const time = (html: string) => {
      const samples = Array.from({ length: 5 }, () => {
        const start = performance.now();
        expect(inspectDesignHtmlDocumentIntegrity(html).valid).toBe(true);
        return performance.now() - start;
      });
      return Math.min(...samples);
    };
    time(build(400));
    const small = time(build(800));
    const large = time(build(3200));
    expect(large).toBeLessThan(Math.max(small, 1) * 10);
  });

  it("stays linear on large valid documents", () => {
    // Locating per close tag made this quadratic: a 117KB valid screen cost
    // ~700ms synchronously on every save.
    const build = (count: number) =>
      `<!doctype html><html><head><meta charset="UTF-8"></head><body>${"<div>x</div>".repeat(count)}</body></html>`;
    const time = (html: string) => {
      const samples = Array.from({ length: 5 }, () => {
        const start = performance.now();
        expect(inspectDesignHtmlDocumentIntegrity(html).valid).toBe(true);
        return performance.now() - start;
      });
      return Math.min(...samples);
    };
    time(build(1000));
    const small = time(build(2000));
    const large = time(build(8000));
    // 4x the input must not cost anything like 16x the time.
    expect(large).toBeLessThan(Math.max(small, 1) * 10);
  });

  it("reports a missing Tailwind runtime as advisory, not a rejection", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace(/<script[^>]*><\/script>/, ""),
    );
    expect(result.valid).toBe(true);
    expect(result.advisory?.[0]?.issue).toBe("runtime-missing");
  });

  it("rejects an Alpine expression whose last string literal is never closed", () => {
    // The HTML attribute is well-formed, so every structural rule passes and the
    // screen renders — Alpine then throws "Invalid or unexpected token" and drops
    // every binding on the component.
    const broken = SCREEN.replace(
      "<body",
      `<body x-data="{ items: [] }"><span :class="item.color==='cobalt'?'bg-[var(--color-cobalt)]':'bg-[var(--color-accent)]"></span><span`,
    );
    const result = inspectDesignHtmlDocumentIntegrity(broken);
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("expression-invalid");
    expect(result.detail?.[0]?.attribute).toBe(":class");
    expect(result.detail?.[0]?.tag).toBe("span");
    expect(result.detail?.[0]?.reason).toMatch(/[Uu]nterminated string/);
  });

  it.each([
    ["x-on handler", `<button @click="open = 'yes"></button>`],
    ["x-data object", `<div x-data="{ tab: 'latency }"></div>`],
    ["x-bind alias", `<div x-bind:class="a ? 'b' : 'c"></div>`],
    ["template literal", '<div x-text="`total: ${count}"></div>'],
    ["unclosed call", `<div x-show="hasAny(items"></div>`],
    ["unclosed object", `<div x-data="{ open: false"></div>`],
  ])("rejects a broken expression in %s", (_label, fragment) => {
    expect(() => assertDesignHtmlWellFormed({ content: fragment })).toThrow(
      DESIGN_HTML_INTEGRITY_ERROR_CODE,
    );
  });

  it.each([
    [
      "ternary chain",
      `<span :class="a==='x'?'p-2':b==='y'?'p-3':'p-4'"></span>`,
    ],
    ["nested quotes", `<div x-data="{ label: 'it\\'s here' }"></div>`],
    [
      "object binding",
      `<span :class="{ 'is-on': open, 'is-off': !open }"></span>`,
    ],
    [
      "template literal",
      '<div x-text="`${a} of ${b.map(v => `${v}!`)}`"></div>',
    ],
    [
      "regex holding a quote",
      `<div x-text="s.replace(/'/g, '\\u2019')"></div>`,
    ],
    ["division", `<div x-text="total / count / 2"></div>`],
    ["encoded apostrophe", `<div x-text="&#39;done&#39;"></div>`],
    ["comparison operators", `<div x-show="a < b && c > d"></div>`],
    // Not JavaScript, and reading them as such is how a check like this starts
    // rejecting working markup.
    ["x-for", `<template x-for="(item, i) in items"><li></li></template>`],
    [
      "x-transition class list",
      `<div x-transition:enter="ease-out duration-300"></div>`,
    ],
    ["x-ref name", `<div x-ref="panel'"></div>`],
  ])("accepts %s", (_label, fragment) => {
    expect(() =>
      assertDesignHtmlWellFormed({ content: fragment }),
    ).not.toThrow();
  });

  it.each([
    // Balanced delimiters throughout, so only a real parser rejects these.
    ["trailing garbage", `<div x-text="a) open("></div>`],
    ["doubled operator", `<div x-show="a ==== b"></div>`],
    ["empty object value", `<div x-data="{ open: }"></div>`],
    ["stray comma", `<div x-text="a ,, b"></div>`],
    ["reserved word", `<div x-data="{ open: class }"></div>`],
  ])("rejects %s that delimiter counting cannot see", (_label, fragment) => {
    expect(() => assertDesignHtmlWellFormed({ content: fragment })).toThrow(
      DESIGN_HTML_INTEGRITY_ERROR_CODE,
    );
  });

  it("points at the offending character, not the start of the attribute", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      `<div x-text="okay + + +"></div>`,
    );
    expect(result.valid).toBe(false);
    // The value starts at column 14; the defect is later in the expression.
    expect(result.detail?.[0]?.column).toBeGreaterThan(14);
  });

  it("rejects an inline script whose string literal is never closed", () => {
    const broken = SCREEN.replace(
      "</head>",
      `<script>const label = 'Total;\nconsole.log(label);</script></head>`,
    );
    const result = inspectDesignHtmlDocumentIntegrity(broken);
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("script-invalid");
    expect(result.detail?.[0]?.reason).toMatch(/[Uu]nterminated string/);
  });

  it.each([
    ["JSON importmap", `<script type="importmap">{ "imports": {} }</script>`],
    ["ld+json", `<script type="application/ld+json">{ "@type": "X" }</script>`],
    [
      "x-template",
      `<script type="text/x-template"><div>{{ a }}</div></script>`,
    ],
    ["external script", `<script src="https://example.com/a.js"></script>`],
    ["empty body", `<script></script>`],
    ["top-level await", `<script type="module">await go();</script>`],
  ])("does not read %s as a broken script", (_label, tag) => {
    expect(() =>
      assertDesignHtmlWellFormed({ content: `<div>${tag}</div>` }),
    ).not.toThrow();
  });

  it.each([
    ["import", `<script>import "./a.js";</script>`],
    ["top-level await", `<script>await go();</script>`],
  ])(
    "rejects %s in a classic script, which the browser refuses to run",
    (_label, tag) => {
      expect(() =>
        assertDesignHtmlWellFormed({ content: `<div>${tag}</div>` }),
      ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
    },
  );

  it.each([
    ["an unknown MIME type", `<script type="text/worker">{{{ not js</script>`],
    [
      "a vendor data block",
      `<script type="application/vnd.acme+config">a: [1,</script>`,
    ],
    [
      "a charset parameter",
      `<script type="text/javascript; charset=utf-8">const a = 1;</script>`,
    ],
  ])("treats %s the way the browser does", (_label, tag) => {
    // Anything outside the executable JavaScript MIME types is inert data.
    expect(() =>
      assertDesignHtmlWellFormed({ content: `<div>${tag}</div>` }),
    ).not.toThrow();
  });

  it("rejects a top-level return in a classic script", () => {
    // A <script> body is a Program, so the browser refuses it with "Illegal
    // return statement" and the element never runs.
    expect(() =>
      assertDesignHtmlWellFormed({
        content: `<div><script>return; initUi()</script></div>`,
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it.each([
    ["inside a function", `<script>function go(){ return 1; } go();</script>`],
    [
      "an Alpine handler, which Alpine compiles inside a function",
      `<button @click="doThing(); return"></button>`,
    ],
  ])("still accepts a return %s", (_label, markup) => {
    expect(() =>
      assertDesignHtmlWellFormed({ content: `<div>${markup}</div>` }),
    ).not.toThrow();
  });

  it.each([
    ["nested inline elements", "<div><span>x"],
    ["block inside block", "<section><article>x"],
  ])("rejects %s left unclosed at EOF in a fragment", (_label, fragment) => {
    // The parser invents <body> for a fragment; treating that as an implied
    // close excuses every unclosed element and voids the whole check.
    expect(() => assertDesignHtmlWellFormed({ content: fragment })).toThrow(
      DESIGN_HTML_INTEGRITY_ERROR_CODE,
    );
  });

  it("rejects two documents concatenated by a bad write", () => {
    // The HTML parser merges the second <html> into the first and reports
    // nothing, so the doubled roots exist only in the source.
    const result = inspectDesignHtmlDocumentIntegrity(`${SCREEN}${SCREEN}`);
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("document-root");
  });

  it("does not read root tags inside a template's content as extra roots", () => {
    // A `<template>`'s children hang off `content`, not `childNodes`; missing
    // them made every close tag inside an x-for template look orphaned.
    const withTemplate = SCREEN.replace(
      '<h1 class="text-3xl">Hi</h1>',
      `<template x-for="row in rows"><div class="p-2"><button class="btn"><span>x</span></button></div></template>`,
    );
    expect(inspectDesignHtmlDocumentIntegrity(withTemplate)).toEqual({
      valid: true,
    });
  });

  it("caps broken-expression reports even when the walk later halts", () => {
    const many = `${"<span :class=\"a==='x'?'p-2':'p-3\"></span>".repeat(
      6,
    )}<div class="x`;
    const result = inspectDesignHtmlDocumentIntegrity(many);
    expect(result.valid).toBe(false);
    expect(result.detail!.length).toBeLessThanOrEqual(3);
  });

  it("caps cascading reports so one defect cannot flood a tool result", () => {
    const nested = `<!doctype html><html><head></head><body>${"<div><section><article>".repeat(
      6,
    )}</body></html>`;
    const result = inspectDesignHtmlDocumentIntegrity(nested);
    expect(result.valid).toBe(false);
    expect(result.detail!.length).toBeLessThanOrEqual(3);
  });
});

describe("assertDesignHtmlWellFormed", () => {
  it("accepts a sketch with an implied document skeleton", () => {
    // Variants may omit <html>/<body>; document-shape rules are not its job.
    expect(() =>
      assertDesignHtmlWellFormed({
        content:
          "<!doctype html><style>.app{max-width:390px}</style><div class='app'>One</div>",
      }),
    ).not.toThrow();
  });

  it.each([
    ["script", "<script>const x = 1"],
    ["style", "<div><style>.a{}"],
    ["title", "<title>Hi"],
    ["textarea", "<div><textarea>Hi"],
  ])("rejects an unclosed raw-text <%s> in a fragment", (_label, content) => {
    // Fragments never reach the document-only raw-text balance check, so this
    // has to be caught during the structural scan or it passes entirely.
    expect(() => assertDesignHtmlWellFormed({ content })).toThrow(
      DESIGN_HTML_INTEGRITY_ERROR_CODE,
    );
  });

  it("rejects an unterminated attribute in a fragment", () => {
    expect(() =>
      assertDesignHtmlWellFormed({
        content: '<section class="grid gap-4><div>Hi</div></section>',
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it("rejects x-cloak without its hiding rule in a fragment too", () => {
    expect(() =>
      assertDesignHtmlWellFormed({
        content: '<section><div x-cloak class="panel">Hi</div></section>',
      }),
    ).toThrow(/x-cloak/);
  });
});

describe("assertDesignHtmlCreateIntegrity", () => {
  it("throws a located, explanatory error naming the file", () => {
    const corrupted = SCREEN.replace('class="bg-white"', 'class="bg-white');
    let message = "";
    try {
      assertDesignHtmlCreateIntegrity({
        content: corrupted,
        fileType: "html",
        filename: "index.html",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(DESIGN_HTML_INTEGRITY_ERROR_CODE);
    expect(message).toContain("index.html");
    expect(message).toContain("never closed");
    // The excerpt is what makes the error actionable without a re-read.
    expect(message).toContain("class=");
  });

  it("returns advisory findings instead of throwing when the document is well-formed", () => {
    expect(
      assertDesignHtmlCreateIntegrity({
        content: SCREEN,
        fileType: "html",
        filename: "index.html",
      }),
    ).toEqual([]);
  });

  it("leaves non-HTML file types alone", () => {
    for (const fileType of ["css", "jsx", "asset"]) {
      expect(
        assertDesignHtmlCreateIntegrity({
          content: "export default function Broken() { return <div>; }",
          fileType,
          filename: "Card.jsx",
        }),
      ).toEqual([]);
    }
  });

  it("does not grant creation the legacy-repair leniency edits get", () => {
    const corrupted = SCREEN.replace("</div></body>", "</body>");
    // An edit from malformed to malformed is tolerated so legacy screens stay
    // repairable; a brand-new file has no such history to protect.
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: corrupted,
        nextContent: corrupted.replace("Hi", "Hello"),
        fileType: "html",
      }),
    ).toThrow();
    expect(() =>
      assertDesignHtmlCreateIntegrity({
        content: corrupted,
        fileType: "html",
        filename: "index.html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });
});
