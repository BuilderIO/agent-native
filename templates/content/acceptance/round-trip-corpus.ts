import type { PMNode } from "../shared/nfm";
import type { NfmFidelityLossKind } from "../shared/nfm-fidelity";

/**
 * SF-04's round-trip corpus: Markdown an agent or the editor writes, with the
 * canonical form it is stored in. L1 owns this fixture and adds every
 * difference it fixes and every shape the census finds. L1's unit and
 * property tests check every sample; the e2e round trip drives each sample
 * that says how it renders. An id never changes meaning, so censuses can
 * cite it.
 */
export type RoundTripSample = {
  /** Stable id, used in test titles. */
  id: string;
  /** Who writes this shape: an agent through the API, or the editor's save. */
  origin: "agent" | "editor";
  /** The Markdown exactly as it is sent. */
  markdown: string;
  /**
   * What a reader sees in the editor when the page opens, after a save and
   * after export and import: an element inside the editor and its exact text.
   * A sample stored with loss fails here even when its bytes look canonical.
   * Samples without it are checked by the unit tests only, since each browser
   * trip costs a page.
   */
  renders?: ReadonlyArray<{ selector: string; text: string }>;
  note?: string;
} & (
  | {
      /** The bytes the stored form holds: what the editor's live copy saves. */
      canonical: string;
      unrepresentable?: never;
    }
  | {
      /**
       * Why the stored form cannot hold this sample. A sample with a reason
       * must be refused at write time with a typed fidelity error; one without
       * must be stored, so refusing it fails SF-04 like losing it would.
       */
      unrepresentable: string;
      /** The losses canonicalizing reports, which the refusal names. */
      losses: readonly NfmFidelityLossKind[];
      canonical?: never;
    }
);

export const ROUND_TRIP_CORPUS: readonly RoundTripSample[] = [
  {
    id: "blank-line-paragraphs",
    origin: "agent",
    markdown: "First paragraph.\n\nSecond paragraph.",
    canonical: "First paragraph.\nSecond paragraph.",
    renders: [
      { selector: "p", text: "First paragraph." },
      { selector: "p", text: "Second paragraph." },
    ],
    note: "The editor writes one block per line.",
  },
  {
    id: "escaped-underscore",
    origin: "agent",
    markdown: "Call snake\\_case once.",
    canonical: "Call snake_case once.",
    renders: [{ selector: "p", text: "Call snake_case once." }],
  },
  {
    id: "underscore-bold",
    origin: "agent",
    markdown: "Some __bold__ text.",
    canonical: "Some **bold** text.",
    renders: [{ selector: "strong", text: "bold" }],
  },
  {
    id: "underscore-italic",
    origin: "agent",
    markdown: "Some _italic_ text.",
    canonical: "Some *italic* text.",
    renders: [{ selector: "em", text: "italic" }],
  },
  {
    id: "dollar-amount",
    origin: "agent",
    markdown: "It costs $60.",
    canonical: "It costs \\$60.",
    renders: [{ selector: "p", text: "It costs $60." }],
  },
  {
    id: "four-space-nested-list",
    origin: "agent",
    markdown: "- Parent item\n    - Nested item",
    canonical: "- Parent item\n\t- Nested item",
    renders: [{ selector: "li li", text: "Nested item" }],
  },
  {
    id: "two-space-nested-list",
    origin: "agent",
    markdown: "- Parent item\n  - Nested item",
    canonical: "- Parent item\n\t- Nested item",
    renders: [{ selector: "li li", text: "Nested item" }],
  },
  {
    // The editor's own nested-list form, so a regression in the control shows.
    id: "tab-nested-list",
    origin: "editor",
    markdown: "- Parent item\n\t- Nested item",
    canonical: "- Parent item\n\t- Nested item",
    renders: [{ selector: "li li", text: "Nested item" }],
  },
  {
    id: "table-cell-edge-spaces",
    origin: "agent",
    markdown: "| Name | Price |\n| --- | --- |\n|  padded  | $5 |",
    canonical:
      '<table header-row="true">\n<tr>\n<td>Name</td>\n<td>Price</td>\n</tr>\n<tr>\n<td>padded</td>\n<td>\\$5</td>\n</tr>\n</table>',
    renders: [
      { selector: "td, th", text: "padded" },
      { selector: "td, th", text: "$5" },
    ],
  },
  {
    id: "tilde-fence",
    origin: "agent",
    markdown: "~~~py\nprint(1)\n~~~",
    canonical: "```py\nprint(1)\n```",
    renders: [{ selector: "pre", text: "print(1)" }],
  },
  {
    id: "html-table-th-header-row",
    origin: "agent",
    markdown:
      "<table>\n<tr>\n<th>A</th>\n<th>B</th>\n</tr>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</table>",
    canonical:
      '<table header-row="true">\n<tr>\n<td>A</td>\n<td>B</td>\n</tr>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</table>',
    // The editor draws a header cell as a td with this class, never as a th.
    renders: [
      { selector: "td.notion-table-header-cell", text: "A" },
      { selector: "td:not(.notion-table-header-cell)", text: "2" },
    ],
  },
  {
    id: "space-nested-paragraph-after-blank",
    origin: "agent",
    markdown: "- a\n\n  more about a\n- b",
    canonical: "- a\n\tmore about a\n- b",
    renders: [{ selector: "li p", text: "more about a" }],
  },
  {
    id: "bare-currency",
    origin: "agent",
    markdown: "costs $60 and $20,000",
    canonical: "costs \\$60 and \\$20,000",
  },
  {
    id: "github-inline-math",
    origin: "agent",
    markdown: "area $`\\pi r^2`$",
    canonical: "area $\\pi r^2$",
  },
  {
    id: "bare-inline-math",
    origin: "agent",
    markdown: "$x+y$ is math",
    canonical: "$x+y$ is math",
  },
  {
    id: "crlf-line-endings",
    origin: "agent",
    markdown: "A\r\nB\rC",
    canonical: "A\nB\nC",
  },
  {
    id: "self-closing-break",
    origin: "agent",
    markdown: "a<br/>b",
    canonical: "a<br>b",
  },
  {
    id: "star-plus-bullets",
    origin: "agent",
    markdown: "* a\n+ b",
    canonical: "- a\n- b",
  },
  {
    id: "paren-ordered-list",
    origin: "agent",
    markdown: "7) a\n9) b",
    canonical: "7. a\n8. b",
    note: "Only the first number is kept, as the list's start.",
  },
  {
    id: "page-edge-newlines",
    origin: "agent",
    markdown: "\nText\n",
    canonical: "Text",
  },
  {
    id: "pipe-table",
    origin: "agent",
    markdown: "| A | B |\n|---|:-:|\n|  1 | 2  |\n| 3 |",
    canonical:
      '<table header-row="true">\n<tr>\n<td>A</td>\n<td align="center">B</td>\n</tr>\n<tr>\n<td>1</td>\n<td align="center">2</td>\n</tr>\n<tr>\n<td>3</td>\n<td align="center"></td>\n</tr>\n</table>',
    note: "Cells are trimmed and ragged rows padded, as GFM reads them.",
  },
  {
    id: "pipe-table-short-delimiter",
    origin: "agent",
    markdown: "| a |\n|-|\n| 1 |",
    canonical:
      '<table header-row="true">\n<tr>\n<td>a</td>\n</tr>\n<tr>\n<td>1</td>\n</tr>\n</table>',
  },
  {
    id: "unnecessary-escape-underscore",
    origin: "agent",
    markdown: "snake\\_case and 1\\. not a list",
    canonical: "snake_case and 1. not a list",
  },
  {
    id: "unnecessary-escape-punctuation",
    origin: "agent",
    markdown: "a\\-b \\# c \\! d",
    canonical: "a-b # c ! d",
  },
  {
    id: "escaped-ordered-marker",
    origin: "agent",
    markdown: "1\\. x",
    canonical: "\\1. x",
  },
  {
    id: "underscore-bold-italic",
    origin: "agent",
    markdown: "__bold__ and _it_ and ___both___",
    canonical: "**bold** and *it* and ***both***",
  },
  {
    id: "underscore-intraword",
    origin: "agent",
    markdown: "snake_case_name and foo__bar__ and _a_b_",
    canonical: "snake_case_name and foo__bar__ and *a_b*",
  },
  {
    id: "underscore-dunder",
    origin: "agent",
    markdown: "__init__ method",
    canonical: "**init** method",
    note: "CommonMark reads `__init__` as bold; code spans keep it literal.",
  },
  {
    id: "underscore-nested-in-bold",
    origin: "agent",
    markdown: "**bold _nested_ text**",
    canonical: "**bold *****nested***** text**",
  },
  {
    id: "underscore-in-code-math-link",
    origin: "agent",
    markdown: "`a_b` $a_b$ [a_b](https://example.com/a_b)",
    canonical: "`a_b` $a_b$ [a_b](https://example.com/a_b)",
  },
  {
    id: "underscore-literal-editor-text",
    origin: "editor",
    markdown: "\\_\\_init\\_\\_",
    canonical: "\\_\\_init\\_\\_",
  },
  {
    id: "nested-marks-editor-text",
    origin: "editor",
    markdown: "**bold *****nested***** text**",
    canonical: "**bold *****nested***** text**",
  },
  {
    id: "special-characters",
    origin: "agent",
    markdown: "a > b {x} ^ | ~",
    canonical: "a \\> b \\{x\\} \\^ \\| \\~",
  },
  {
    id: "autolink-stays-text",
    origin: "agent",
    markdown: "<https://example.com>",
    canonical: "\\<https://example.com\\>",
  },
  {
    id: "github-alert-stays-quote",
    origin: "agent",
    markdown: "> [!TIP]\n> text",
    canonical: "> \\[!TIP\\]\n> text",
  },
  {
    id: "setext-heading-stays-text",
    origin: "agent",
    markdown: "Title\n===",
    canonical: "Title\n===",
  },
  {
    id: "space-nested-list-two",
    origin: "agent",
    markdown: "- a\n  - b\n  - c",
    canonical: "- a\n\t- b\n\t- c",
  },
  {
    id: "space-nested-list-four",
    origin: "agent",
    markdown: "- a\n    - b\n        - c\n    - d",
    canonical: "- a\n\t- b\n\t\t- c\n\t- d",
  },
  {
    id: "space-nested-ordered-three",
    origin: "agent",
    markdown: "1. a\n   1. b",
    canonical: "1. a\n\t1. b",
  },
  {
    id: "space-ordered-two-is-sibling",
    origin: "agent",
    markdown: "1. a\n  2. b",
    canonical: "1. a\n2. b",
    note: "Two spaces do not reach the text column of `1. `, so CommonMark makes a sibling.",
  },
  {
    id: "space-nested-task",
    origin: "agent",
    markdown: "- [ ] a\n  - [x] b",
    canonical: "- [ ] a\n\t- [x] b",
  },
  {
    id: "space-nested-mixed-kinds",
    origin: "agent",
    markdown: "1. a\n    - b\n    - c\n2. d",
    canonical: "1. a\n\t- b\n\t- c\n2. d",
  },
  {
    id: "space-nested-wide-marker",
    origin: "agent",
    markdown: "1. a\n10. b\n    - c",
    canonical: "1. a\n2. b\n\t- c",
  },
  {
    id: "space-nested-fence",
    origin: "agent",
    markdown: "- a\n    ```js\n    x = 1\n\n    y = 2\n    ```\n- b",
    canonical: "- a\n\t```js\n\tx = 1\n\t\n\ty = 2\n\t```\n- b",
  },
  {
    id: "space-nested-quote",
    origin: "agent",
    markdown: "- a\n  > q\n- b",
    canonical: "- a\n\t> q\n- b",
  },
  {
    id: "space-nested-after-blank-lines",
    origin: "agent",
    markdown: "- a\n\n\n    - b",
    canonical: "- a\n\t- b",
  },
  {
    id: "space-lazy-continuation",
    origin: "agent",
    markdown: "- a\n  more",
    canonical: "- a\n  more",
    note: "Without a blank line CommonMark joins this to the item's text; it stays its own paragraph.",
  },
  {
    id: "space-nested-under-tab-nested",
    origin: "agent",
    markdown: "- a\n\t- b\n  - c",
    canonical: "- a\n\t- b\n\t- c",
  },
  {
    id: "space-nested-in-details",
    origin: "agent",
    markdown: "<details>\n<summary>S</summary>\n- a\n    - b\n</details>",
    canonical: "<details>\n<summary>S</summary>\n\t- a\n\t\t- b\n</details>",
  },
  {
    id: "space-indented-first-item",
    origin: "agent",
    markdown: "  - leading spaces item",
    canonical: "- leading spaces item",
  },
  {
    id: "editor-paragraph-with-spaced-marker",
    origin: "editor",
    markdown: "\\  - not a list",
    canonical: "\\  - not a list",
  },
  {
    id: "untabbed-container-body",
    origin: "agent",
    markdown: "<details>\n<summary>S</summary>\nBody\n</details>",
    canonical: "<details>\n<summary>S</summary>\n\tBody\n</details>",
  },
  {
    id: "unclosed-container",
    origin: "agent",
    markdown: '<callout icon="x">\nHello',
    canonical: '\\<callout icon="x"\\>\nHello',
    note: "The tags stay as text.",
  },
  {
    id: "quoted-boolean-open",
    origin: "agent",
    markdown: '<details open="">\n<summary>S</summary>\n\tB\n</details>',
    canonical: "<details open>\n<summary>S</summary>\n\tB\n</details>",
  },
  {
    id: "mention-raw-ampersand",
    origin: "agent",
    markdown: '<mention-page url="https://example.com/p">R&D</mention-page>',
    canonical:
      '<mention-page url="https://example.com/p">R&amp;D</mention-page>',
  },
  {
    id: "multi-line-quote",
    origin: "agent",
    markdown: "> a\n> b",
    canonical: "> a\n> b",
    note: "Each `> ` line is its own quote block.",
  },
  {
    id: "loose-list",
    origin: "agent",
    markdown: "- a\n\n- b",
    canonical: "- a\n- b",
  },
  {
    id: "empty-emphasis",
    origin: "agent",
    markdown: "x*** and ** ** and ~~~~",
    canonical: "x**\\* and ** \\*\\* and \\~\\~\\~\\~",
    note: "Delimiters around nothing stay text.",
  },
  {
    id: "long-backtick-fence",
    origin: "agent",
    markdown: "``````ts\ncode\n``````",
    canonical: "```ts\ncode\n```",
  },
  {
    id: "tilde-fence-holds-backticks",
    origin: "agent",
    markdown: "~~~\n```\ninner\n```\n~~~",
    canonical: "````\n```\ninner\n```\n````",
  },
  {
    id: "code-language-with-backtick",
    origin: "agent",
    markdown: "~~~a`b\nx\n~~~",
    canonical: "~~~a`b\nx\n~~~",
    note: "A backtick fence's language cannot hold a backtick.",
  },
  {
    id: "long-code-span-at-line-start",
    origin: "editor",
    markdown: "``` `` ```",
    canonical: "``` `` ```",
    note: "A backtick fence's language holds no backtick, so this is a code span.",
  },
  {
    id: "emphasis-around-code-span",
    origin: "editor",
    markdown: "*`*args`*",
    canonical: "*`*args`*",
    note: "Code spans bind tighter than emphasis.",
  },
  {
    id: "emphasis-around-code-span-in-bold",
    origin: "agent",
    markdown: "**a `*` b** and *`a_b`*",
    canonical: "**a ****`*`**** b** and *`a_b`*",
  },
  {
    id: "italic-space-opening-block",
    origin: "editor",
    markdown: "\\* a*",
    canonical: "\\* a*",
    note: "The editor escapes a star that opens italics at the start of a block.",
  },
  {
    id: "link-around-code-with-bracket",
    origin: "editor",
    markdown: "[`a[`](https://example.com)",
    canonical: "[`a[`](https://example.com)",
    note: "Code spans bind tighter than link brackets.",
  },
  {
    id: "math-before-digit",
    origin: "editor",
    markdown: "$`x`$1 and $`a`$$b$",
    canonical: "$`x`$1 and $`a`$$b$",
    note: "Plain math does not close before a digit or another `$`.",
  },
  {
    id: "html-table-th-header-column",
    origin: "agent",
    markdown:
      "<table>\n<tr>\n<th>R1</th>\n<td>1</td>\n</tr>\n<tr>\n<th>R2</th>\n<td>2</td>\n</tr>\n</table>",
    canonical:
      '<table header-column="true">\n<tr>\n<td>R1</td>\n<td>1</td>\n</tr>\n<tr>\n<td>R2</td>\n<td>2</td>\n</tr>\n</table>',
  },
  {
    id: "html-table-thead-one-line-rows",
    origin: "agent",
    markdown:
      "<table>\n<thead>\n<tr><th>A</th><th>B</th></tr>\n</thead>\n<tbody>\n<tr><td>1</td><td>2</td></tr>\n</tbody>\n</table>",
    canonical:
      '<table header-row="true">\n<tr>\n<td>A</td>\n<td>B</td>\n</tr>\n<tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</table>',
  },
  {
    id: "html-table-multi-line-cell",
    origin: "agent",
    markdown: "<table>\n<tr>\n<td>\nfirst\nsecond\n</td>\n</tr>\n</table>",
    canonical: "<table>\n<tr>\n<td>first second</td>\n</tr>\n</table>",
  },
  {
    id: "html-table-cells-one-line",
    origin: "agent",
    markdown: "<table>\n<tr>\n<td>a</td><td>b</td>\n</tr>\n</table>",
    canonical: "<table>\n<tr>\n<td>a</td>\n<td>b</td>\n</tr>\n</table>",
  },
  {
    id: "html-table-cells-one-line-with-prices",
    origin: "agent",
    markdown: "<table>\n<tr>\n<td>$5</td><td>a\\b</td>\n</tr>\n</table>",
    canonical: "<table>\n<tr>\n<td>\\$5</td>\n<td>a\\\\b</td>\n</tr>\n</table>",
    note: "A dollar sign or a backslash does not hide the close tag after it.",
  },
  {
    id: "html-table-close-tag-in-code",
    origin: "editor",
    markdown: "<table>\n<tr>\n<td>`</td>`</td>\n</tr>\n</table>",
    canonical: "<table>\n<tr>\n<td>`</td>`</td>\n</tr>\n</table>",
    note: "A close tag in code is the cell's text.",
  },
  {
    id: "html-table-row-closed-on-cell-line",
    origin: "agent",
    markdown:
      "<table>\n<tr>\n<td>a</td></tr>\n<tr>\n<td>b</td>\n</tr>\n</table>",
    canonical:
      "<table>\n<tr>\n<td>a</td>\n</tr>\n<tr>\n<td>b</td>\n</tr>\n</table>",
    note: "A row closed on its last cell's line ends there.",
  },
  {
    id: "html-table-row-closed-after-wrapped-cell",
    origin: "agent",
    markdown:
      "<table>\n<tr>\n<td>a\nb</td></tr>\n<tr>\n<td>c</td>\n</tr>\n</table>",
    canonical:
      "<table>\n<tr>\n<td>a b</td>\n</tr>\n<tr>\n<td>c</td>\n</tr>\n</table>",
    note: "A cell wrapped over lines may close its row on its last line.",
  },
  {
    id: "html-table-cell-edge-spaces",
    origin: "editor",
    markdown: "<table>\n<tr>\n<td> a </td>\n</tr>\n</table>",
    canonical: "<table>\n<tr>\n<td> a </td>\n</tr>\n</table>",
    note: "HTML cells keep their spaces, so a cell the editor holds as ` a ` reads back the same.",
  },
  {
    id: "heading-extra-spaces",
    origin: "agent",
    markdown: "#   Title",
    canonical: "# Title",
  },
  {
    id: "empty-span",
    origin: "agent",
    markdown: "<span>plain</span> text",
    canonical: "plain text",
  },
  {
    id: "unknown-inline-tag-stays-text",
    origin: "agent",
    markdown: "a <kbd>Ctrl</kbd> b",
    canonical: "a \\<kbd\\>Ctrl\\</kbd\\> b",
  },
  {
    id: "code-span-whitespace-only",
    origin: "editor",
    markdown: "`\t `",
    canonical: "`\t `",
    note: "Padding is stripped only around code that is not all whitespace, so none is added.",
  },
  {
    id: "empty-code-fence",
    origin: "agent",
    markdown: "```\n```",
    canonical: "```\n\n```",
  },
  {
    id: "colored-paragraph-holding-a-marker",
    origin: "editor",
    markdown: '#{color="red"}\n-{color="red"}\n1.{color="red"}',
    canonical: '#{color="red"}\n-{color="red"}\n1.{color="red"}',
    note: "With a space before the color, the text would read as a heading or list item.",
  },
  {
    id: "trailing-empty-block-after-heading",
    origin: "agent",
    markdown: "# H\n<empty-block/>",
    canonical: "# H",
    note: "The editor adds an empty paragraph after a last block of another kind, and its save drops it.",
  },
  {
    id: "refuse-colored-trailing-empty-block",
    origin: "agent",
    markdown: '# H\n{color="red"}',
    unrepresentable: "The writer keeps no color on an empty block.",
    losses: ["reparse-mismatch"],
  },
  {
    id: "refuse-formatted-math",
    origin: "agent",
    markdown: "**$a*b$**",
    unrepresentable:
      "Yjs keeps marks only on text, so the editor cannot hold formatting on math.",
    losses: ["dropped-formatting"],
  },
  {
    id: "refuse-formatted-mention",
    origin: "agent",
    markdown:
      '[<mention-page url="https://example.com/p">P</mention-page>](https://example.com) and <span color="red">*$x$*</span>',
    unrepresentable:
      "Yjs keeps marks only on text, so the editor cannot hold formatting on a mention or math.",
    losses: ["dropped-formatting"],
  },
  {
    id: "refuse-empty-block-trailing-text",
    origin: "agent",
    markdown: "<empty-block/> tail",
    unrepresentable: "An empty block holds no text.",
    losses: ["dropped-source"],
  },
  {
    id: "refuse-span-unknown-attribute",
    origin: "agent",
    markdown: '<span color="red" extra="retained">t</span>',
    unrepresentable: "A span keeps only color, background and underline.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-table-colspan",
    origin: "agent",
    markdown: '<table>\n<tr>\n<td colspan="2">x</td>\n</tr>\n</table>',
    unrepresentable: "Table cells do not span columns.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-table-stray-text",
    origin: "agent",
    markdown: "<table>\nstray\n<tr>\n<td>x</td>\n</tr>\n</table>",
    unrepresentable: "A table holds only rows.",
    losses: ["dropped-source"],
  },
  {
    id: "refuse-mention-label-edge-spaces",
    origin: "agent",
    markdown:
      'See <mention-page url="https://example.com/p"> Plan </mention-page>.',
    unrepresentable: "A mention's label has no spaces at its edges.",
    losses: ["dropped-source"],
  },
  {
    id: "refuse-table-cell-open-at-row-end",
    origin: "agent",
    markdown: "<table>\n<tr>\n<td>a\n</tr>\n<tr>\n<td>b</td>\n</tr>\n</table>",
    unrepresentable: "A cell closes inside its row.",
    losses: ["dropped-source"],
  },
  {
    id: "refuse-table-header-flag-not-boolean",
    origin: "agent",
    markdown: '<table header-row="yes">\n<tr>\n<td>a</td>\n</tr>\n</table>',
    unrepresentable: 'A table flag is "true" or "false".',
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-details-open-false",
    origin: "agent",
    markdown:
      '<details open="false">\n<summary>S</summary>\n\tbody\n</details>',
    unrepresentable:
      'HTML reads any value of `open` as open, so `open="false"` is a toggle that is open.',
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-table-th-in-body",
    origin: "agent",
    markdown: "<table>\n<tr>\n<td>a</td>\n<th>b</th>\n</tr>\n</table>",
    unrepresentable:
      "Header cells are a whole first row or a whole first column.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-table-unknown-attribute",
    origin: "agent",
    markdown: '<table style="x">\n<tr>\n<td>a</td>\n</tr>\n</table>',
    unrepresentable: "A table has no style.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-callout-unknown-attribute",
    origin: "agent",
    markdown: '<callout icon="x" kind="warn">\n\tbody\n</callout>',
    unrepresentable: "A callout keeps only its icon and color.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-callout-unindented-line",
    origin: "agent",
    markdown: '<callout icon="i">\n\tkept\nlost\n</callout>',
    unrepresentable:
      "A callout holds the lines indented under it, so an unindented line inside it is skipped.",
    losses: ["dropped-source"],
  },
  {
    id: "refuse-column-unindented-line",
    origin: "agent",
    markdown:
      "<columns>\n\t<column>\n\t\tkept\n\tlost\n\t</column>\n</columns>",
    unrepresentable:
      "A column holds the lines indented under it, so an unindented line inside it is skipped.",
    losses: ["dropped-source"],
  },
  {
    id: "refuse-mention-unquoted-attribute",
    origin: "agent",
    markdown: "<mention-page url=abc>Page</mention-page>",
    unrepresentable: "Only double-quoted attributes are read.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-file-bare-attribute",
    origin: "agent",
    markdown: '<file url="x" bogus/>',
    unrepresentable: "An attribute without a value is not read.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-audio-unknown-color",
    origin: "agent",
    markdown: '<audio src="x" color="bad"/>',
    unrepresentable: "Only the editor's named colors are kept.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-columns-stray-child",
    origin: "agent",
    markdown: "<columns>\n\tstray\n\t<column>\n\t\ta\n\t</column>\n</columns>",
    unrepresentable: "Columns hold only columns.",
    losses: ["dropped-source"],
  },
  {
    id: "refuse-columns-empty",
    origin: "agent",
    markdown: "<columns>\n</columns>",
    unrepresentable: "Columns need at least one column.",
    losses: ["invalid-structure"],
  },
  {
    id: "refuse-video-poster",
    origin: "agent",
    markdown: '<video src="a.mp4" poster="p.png"></video>',
    unrepresentable: "The editor's video block has no poster.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-video-color",
    origin: "agent",
    markdown: '<video src="a.mp4" color="red"></video>',
    unrepresentable: "The editor's video block has no color.",
    losses: ["editor-mismatch"],
  },
  {
    id: "refuse-image-color",
    origin: "agent",
    markdown: '![a](b.png) {color="red"}',
    unrepresentable: "The editor's image block has no color.",
    losses: ["editor-mismatch"],
  },
  {
    id: "refuse-image-width",
    origin: "agent",
    markdown: '![a](b.png) {width="200" color="red"}',
    unrepresentable: "The editor's image block has no width or color.",
    losses: ["dropped-attribute", "editor-mismatch"],
  },
  {
    id: "refuse-paragraph-toggle",
    origin: "agent",
    markdown: 'text {toggle="true"}',
    unrepresentable: "Only headings can be toggles.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-paragraph-extra-attribute",
    origin: "agent",
    markdown: 'text {color="red" size="2"}',
    unrepresentable: "A paragraph keeps only its color.",
    losses: ["dropped-attribute"],
  },
  {
    id: "refuse-heading-toggle-level-five",
    origin: "agent",
    markdown: '##### H {toggle="true"}\n\tchild',
    unrepresentable: "Toggle headings go to level 4.",
    losses: ["reparse-mismatch"],
  },
];

/**
 * Editor documents whose Markdown reads back as a different document. Each
 * is a loss main has too; the test fails when one is fixed, so its entry
 * moves into the corpus instead of going stale.
 */
export interface KnownEditorLoss {
  id: string;
  doc: PMNode;
  /** What the editor's live copy saves for `doc`. */
  markdown: string;
  note: string;
}

const text = (value: string, marks?: PMNode["marks"]): PMNode =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const paragraph = (value: string): PMNode => ({
  type: "paragraph",
  content: [text(value)],
});
const bulletList = (value: string): PMNode => ({
  type: "bulletList",
  content: [{ type: "listItem", content: [paragraph(value)] }],
});
const mathParagraph = (label: string): PMNode => ({
  type: "paragraph",
  content: [
    {
      type: "notionInlineAtom",
      attrs: { tagName: "math", attrsJson: "{}", label },
    },
  ],
});

export const KNOWN_EDITOR_LOSSES: readonly KnownEditorLoss[] = [
  {
    id: "whitespace-only-text",
    doc: { type: "doc", content: [paragraph("  ")] },
    markdown: "  ",
    note: "Edge spaces are trimmed from a line, so a block holding only spaces reads back empty.",
  },
  {
    id: "heading-leading-space",
    doc: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [text(" a")] },
      ],
    },
    markdown: "##  a",
    note: "A heading's text is trimmed, as CommonMark reads it.",
  },
  {
    id: "literal-star-opening-block",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("* "), text(";", [{ type: "italic" }])],
        },
      ],
    },
    markdown: "\\* *;*",
    note: "A literal star is written `\\*`, and so is a star opening italics at the start of a block. Stored pages read it as italics, so this one changes.",
  },
  {
    id: "adjacent-lists-of-one-kind",
    doc: { type: "doc", content: [bulletList("a"), bulletList("b")] },
    markdown: "- a\n- b",
    note: "Two lists of one kind in a row read back as one list. The editor joins them as they are typed.",
  },
  {
    id: "underline-mark",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [text("u", [{ type: "underline" }])],
        },
      ],
    },
    markdown: '<span underline="true">u</span>',
    note: "Underlined text reads back as an underlined span, which looks the same.",
  },
  {
    id: "formatted-inline-math",
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "notionInlineAtom",
              attrs: { tagName: "math", attrsJson: "{}", label: "x" },
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    },
    markdown: "$x$",
    note: "The editor can format math or a mention, but Yjs keeps marks only on text, so the live copy never has the formatting to save.",
  },
  {
    id: "math-label-closing-early",
    doc: { type: "doc", content: [mathParagraph("a`$b")] },
    markdown: "$a`$b$",
    note: "Both inline math forms close at a backtick followed by `$`, so neither holds a label with one.",
  },
  {
    id: "math-label-line-break",
    doc: { type: "doc", content: [mathParagraph("a\nb")] },
    markdown: "$`a\nb`$",
    note: "Inline math sits on one line, so a label with a line break splits its paragraph.",
  },
];
