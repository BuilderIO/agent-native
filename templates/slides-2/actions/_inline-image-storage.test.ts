import { describe, expect, it } from "vitest";

import { MAX_INLINE_IMAGE_BASE64_CHARS } from "../shared/upload-types.js";
import {
  assertDesignSystemAssetUrlsPersistable,
  assertSlideInlineImagesPersistable,
} from "./_inline-image-storage.js";
import { assertNoDeckRenderArtifacts } from "./_render-artifacts.js";

const INLINE_IMAGE = "data:image/png;base64,aGVsbG8=";

describe("slide inline image storage boundary", () => {
  it("rejects image data URLs with a typed error", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content: `<img src="${INLINE_IMAGE}">` },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
        details: expect.objectContaining({ resource: "slide" }),
      }),
    );
  });

  it("rejects inline image data URLs in Markdown destinations", () => {
    for (const content of [
      `![Preview](${INLINE_IMAGE})`,
      `![Preview](<${INLINE_IMAGE}>)`,
      "![Preview](data&#58;image/png;base64,aGVsbG8=)",
      `![Preview][preview]\n\n[preview]: ${INLINE_IMAGE}`,
    ]) {
      expect(() =>
        assertSlideInlineImagesPersistable({}, { content }, "slide-markdown"),
      ).toThrow(
        expect.objectContaining({
          errorCode: "inline_image_data_url_not_persistable",
          details: expect.objectContaining({ resource: "slide" }),
        }),
      );
    }
  });

  it("ignores Markdown image syntax in code spans and code blocks", () => {
    const content = [
      `\`![Inline](${INLINE_IMAGE})\``,
      "```markdown",
      `![Fenced](${INLINE_IMAGE})`,
      "```",
      `    ![Indented](${INLINE_IMAGE})`,
    ].join("\n");

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content },
        "slide-markdown-code",
      ),
    ).not.toThrow();
  });

  it("does not pair inline code delimiters across a code block", () => {
    const content = [
      "`unclosed",
      "```text",
      "code block",
      "```",
      `![Active](${INLINE_IMAGE})\``,
    ].join("\n");

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content },
        "slide-markdown-block-boundary",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );
  });

  it("rejects oversized inline payloads before decoding them", () => {
    const oversized = `data:image/png;base64,${"A".repeat(MAX_INLINE_IMAGE_BASE64_CHARS)}`;

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content: `<img src="${oversized}">` },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_too_large",
        statusCode: 413,
      }),
    );
  });

  it("rejects malformed data URLs instead of treating them as stored images", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { content: '<img src="data:image/png;base64,%%%">' },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "invalid_inline_image_data_url",
      }),
    );
  });

  it("rejects data URLs in escaped or comment-obfuscated CSS functions", () => {
    for (const cssUrl of [
      `u\\72l(${INLINE_IMAGE})`,
      `u/**/rl(${INLINE_IMAGE})`,
      `url(d\\61ta:image/png;base64,aGVsbG8=)`,
      ["u\\", "\n", `rl(${INLINE_IMAGE})`].join(""),
    ]) {
      expect(() =>
        assertSlideInlineImagesPersistable(
          {},
          { content: `<div style="background-image:${cssUrl}">x</div>` },
          "slide-css",
        ),
      ).toThrow(
        expect.objectContaining({
          errorCode: "inline_image_data_url_not_persistable",
        }),
      );
    }
  });

  it("ignores CSS URL text inside strings and comments", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          content: `<div style="content: 'url(${INLINE_IMAGE})'; /* url(${INLINE_IMAGE}) */ background-image: url(https://example.com/image.png)">x</div>`,
        },
        "slide-css-text",
      ),
    ).not.toThrow();
  });

  it("allows asset handles and external URLs and preserves an unchanged legacy URL", () => {
    const previous = {
      content: `<img src="${INLINE_IMAGE}">`,
      imageUrl: "https://example.com/slide.png",
    };
    expect(() =>
      assertSlideInlineImagesPersistable(previous, previous, "slide-1"),
    ).not.toThrow();
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          content:
            '<img src="asset://uploaded-image"><img src="https://example.com/image.png">',
          imageUrl: "asset://uploaded-image",
        },
        "slide-2",
      ),
    ).not.toThrow();
  });

  it("checks full-deck source fields and Excalidraw file payloads", () => {
    expect(() =>
      assertNoDeckRenderArtifacts(null, {
        slides: [
          {
            id: "slide-1",
            content: "<div />",
            sourceTsx: `const image = "${INLINE_IMAGE}"; export default function Slide() { return <img src={image} />; }`,
          },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          excalidrawData: JSON.stringify({
            files: { image: { dataURL: INLINE_IMAGE } },
          }),
        },
        "slide-2",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
        details: expect.objectContaining({
          field: "slide slide-2 excalidrawData.files.image.dataURL",
        }),
      }),
    );
  });

  it("does not treat ordinary TSX data properties and labels as image URLs", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `// ${INLINE_IMAGE}
            const row = { data: items };
            const label = "Example: ${INLINE_IMAGE} is a field label";
            export default function Slide() { return <p>{label}</p>; }`,
        },
        "slide-3",
      ),
    ).not.toThrow();
  });

  it("rejects a data URL reached through an image source variable", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `const imageUrl = "${INLINE_IMAGE}";
            export default function Slide() { return <img src={imageUrl} />; }`,
        },
        "slide-4",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );
  });

  it("does not resolve a component prop through a shadowed module variable", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `const href = "data: documentation label";
            function Link({ href }) { return <a href={href}>Link</a>; }
            export default function Slide() { return <Link href="https://example.com" />; }`,
        },
        "slide-shadowed-prop",
      ),
    ).not.toThrow();

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `const imageUrl = "data:text/plain,hello";
            export default function Slide() {
              if (enabled) { var imageUrl = "https://example.com/image.png"; }
              return <img src={imageUrl} />;
            }`,
        },
        "slide-shadowed-var",
      ),
    ).not.toThrow();
  });

  it("keeps object method props in their own lexical scope", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `const imageUrl = "${INLINE_IMAGE}";
            const Link = { render({ imageUrl }) { return <a href={imageUrl} />; } };
            export default function Slide() { return <img src={imageUrl} />; }`,
        },
        "slide-method-scope",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );
  });

  it("rejects data URLs inside CSS source constants, including dynamic payloads", () => {
    const sourceVariants = [
      [
        "const slideCss = `.card { background-image: url(",
        INLINE_IMAGE,
        "); }`;",
        'export default function Slide() { return <div className="card" />; }',
      ].join(""),
      [
        'const slideCss = ".card { background-image: url(',
        INLINE_IMAGE,
        ');"; export default function Slide() { return <div />; }',
      ].join(""),
      [
        "const slideCss = `.card { background-image: url(data:image/png;base64,${encoded}); }`;",
        'export default function Slide() { return <div className="card" />; }',
      ].join("\n"),
    ];
    for (const sourceTsx of sourceVariants) {
      expect(() =>
        assertSlideInlineImagesPersistable(
          {},
          { sourceTsx },
          "slide-css-source",
        ),
      ).toThrow(
        expect.objectContaining({
          errorCode: expect.stringMatching(
            /^(?:inline_image_data_url_not_persistable|invalid_inline_image_data_url)$/,
          ),
        }),
      );
    }
  });

  it("checks data URLs in CSS at-rules and inline style objects", () => {
    const sourceVariants = [
      [
        "const slideCss = `@import url(",
        INLINE_IMAGE,
        ");`;",
        "export default function Slide() { return <div />; }",
      ].join(""),
      [
        'const slideCss = `@import "',
        INLINE_IMAGE,
        '";`; export default function Slide() { return <div />; }',
      ].join(""),
      [
        'const slideCss = `@import "',
        INLINE_IMAGE,
        '"; .broken {`; export default function Slide() { return <div />; }',
      ].join(""),
      [
        `const imageUrl = "${INLINE_IMAGE}";`,
        "export default function Slide() { return <div style={{ backgroundImage: `url(${imageUrl})` }} />; }",
      ].join("\n"),
      `export default function Slide() { return <div style={{ backgroundImage: enabled ? "url(${INLINE_IMAGE})" : "url(https://example.com/image.png)" }} />; }`,
      [
        "const sheet = `.card { background-image: url(",
        INLINE_IMAGE,
        "); }`; export default function Slide() { return <style>{sheet}</style>; }",
      ].join(""),
      [
        "const sheet = css`.card { background-image: url(",
        INLINE_IMAGE,
        "); }`; export default function Slide() { return <style>{sheet}</style>; }",
      ].join(""),
    ];

    for (const sourceTsx of sourceVariants) {
      expect(() =>
        assertSlideInlineImagesPersistable(
          {},
          { sourceTsx },
          "slide-css-usage",
        ),
      ).toThrow(
        expect.objectContaining({
          errorCode: expect.stringMatching(
            /^(?:inline_image_data_url_not_persistable|invalid_inline_image_data_url)$/,
          ),
        }),
      );
    }
  });

  it("rejects dynamic data URLs in image source attributes", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx:
            "export default function Slide() { return <img src={`data:image/png;base64,${encoded}`} />; }",
        },
        "slide-5",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "invalid_inline_image_data_url",
      }),
    );

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `export default function Slide() { return <img src={enabled ? "${INLINE_IMAGE}" : "https://example.com/image.png"} />; }`,
        },
        "slide-5-conditional",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );
  });

  it("rejects dynamic data URLs whose template prefix comes from a variable", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx:
            'const prefix = "data:image/png;base64,"; const imageUrl = `${prefix}aGVsbG8=`; export default function Slide() { return <img src={imageUrl} />; }',
        },
        "slide-5a",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );
  });

  it("rejects data URLs constructed with TSX string concatenation", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `const imageUrl = "data:image/png;base64," + "aGVsbG8=";
            export default function Slide() { return <img src={imageUrl} />; }`,
        },
        "slide-6",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
      }),
    );

    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        {
          sourceTsx: `const imageUrl = "data:image/png;base64," + encoded;
            export default function Slide() { return <img src={imageUrl} />; }`,
        },
        "slide-7",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "invalid_inline_image_data_url",
      }),
    );
  });

  it("rejects malformed Excalidraw JSON instead of skipping the storage check", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { excalidrawData: "not json" },
        "slide-1",
      ),
    ).toThrow(
      expect.objectContaining({ errorCode: "invalid_excalidraw_data" }),
    );
  });

  it("rejects unparseable source rather than skipping the storage check", () => {
    expect(() =>
      assertSlideInlineImagesPersistable(
        {},
        { sourceTsx: "export default function Slide() { return <img" },
        "slide-8",
      ),
    ).toThrow(expect.objectContaining({ errorCode: "invalid_slide_source" }));
  });
});

describe("design system binary URL storage boundary", () => {
  it("rejects inline image bodies inside design system data and asset metadata", () => {
    expect(() =>
      assertDesignSystemAssetUrlsPersistable(
        { logos: [{ name: "Brand", url: INLINE_IMAGE }] },
        "data",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "inline_image_data_url_not_persistable",
        details: expect.objectContaining({ resource: "design-system" }),
      }),
    );

    expect(() =>
      assertDesignSystemAssetUrlsPersistable(
        [{ id: "brand-logo", url: "data:image/png;base64,%%%" }],
        "assets",
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "invalid_inline_image_data_url",
      }),
    );
  });

  it("checks URL fields without treating structured design metadata as binary", () => {
    expect(() =>
      assertDesignSystemAssetUrlsPersistable(
        {
          notes: "A detailed brand note",
          colors: { primary: "data: is a field label" },
          logos: [{ url: "asset://brand-logo" }],
          imageStyle: { referenceUrls: ["https://example.com/reference.png"] },
        },
        "data",
      ),
    ).not.toThrow();
  });
});
