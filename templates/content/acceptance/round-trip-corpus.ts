/**
 * SF-04's round-trip corpus: Markdown an agent writes that the editor stores
 * in another form. L1 owns this fixture and adds every difference it fixes and
 * every shape the census finds; the e2e round trip and L1's property tests
 * both read it, so a sample added here is checked on both paths.
 */
export interface RoundTripSample {
  /** Stable id, used in test titles. */
  id: string;
  /** The Markdown exactly as an agent sends it. */
  markdown: string;
  /**
   * What a reader sees in the editor when the page opens, after a save and
   * after export and import: an element inside the editor and its exact text.
   * A sample stored with loss fails here even when its bytes look canonical.
   */
  renders: ReadonlyArray<{ selector: string; text: string }>;
  /**
   * Why the stored form cannot hold this sample. A sample with a reason must be
   * refused at write time with a typed fidelity error; one without must be
   * stored, so refusing it fails SF-04 like losing it would.
   */
  unrepresentable?: string;
}

export const ROUND_TRIP_CORPUS: readonly RoundTripSample[] = [
  {
    id: "blank-line-paragraphs",
    markdown: "First paragraph.\n\nSecond paragraph.",
    renders: [
      { selector: "p", text: "First paragraph." },
      { selector: "p", text: "Second paragraph." },
    ],
  },
  {
    id: "escaped-underscore",
    markdown: "Call snake\\_case once.",
    renders: [{ selector: "p", text: "Call snake_case once." }],
  },
  {
    id: "underscore-bold",
    markdown: "Some __bold__ text.",
    renders: [{ selector: "strong", text: "bold" }],
  },
  {
    id: "dollar-amount",
    markdown: "It costs $60.",
    renders: [{ selector: "p", text: "It costs $60." }],
  },
  {
    id: "four-space-nested-list",
    markdown: "- Parent item\n    - Nested item",
    renders: [{ selector: "li li", text: "Nested item" }],
  },
  {
    id: "two-space-nested-list",
    markdown: "- Parent item\n  - Nested item",
    renders: [{ selector: "li li", text: "Nested item" }],
  },
  {
    // The editor's own nested-list form, so a regression in the control shows.
    id: "tab-nested-list",
    markdown: "- Parent item\n\t- Nested item",
    renders: [{ selector: "li li", text: "Nested item" }],
  },
  {
    id: "table-cell-edge-spaces",
    markdown: "| Name | Price |\n| --- | --- |\n|  padded  | $5 |",
    renders: [
      { selector: "td, th", text: "padded" },
      { selector: "td, th", text: "$5" },
    ],
  },
];
