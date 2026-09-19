import { describe, expect, it } from "vitest";

import exportDesignAsFigmaSvg from "./export-design-as-figma-svg.js";
import exportPdf from "./export-pdf.js";
import exportPng from "./export-png.js";
import exportSvg from "./export-svg.js";
import importDesignSource from "./import-design-source.js";
import importFigmaClipboard from "./import-figma-clipboard.js";
import importFigmaFrame from "./import-figma-frame.js";

const ACTION_CONTRACTS = [
  {
    name: "import-figma-frame",
    action: importFigmaFrame,
    input: { fileKey: "abcDEF12345", nodeId: "1:2" },
    readOnly: false,
  },
  {
    name: "import-figma-clipboard",
    action: importFigmaClipboard,
    input: {
      figmetaFileKey: "abcDEF12345",
      clipboardHtml: "<div>Hero</div>",
    },
    readOnly: false,
  },
  {
    name: "import-design-source",
    action: importDesignSource,
    input: { sourceType: "html-string", content: "<div>Hero</div>" },
    readOnly: false,
  },
  {
    name: "export-design-as-figma-svg",
    action: exportDesignAsFigmaSvg,
    input: { designId: "design-1" },
    readOnly: true,
  },
  {
    name: "export-png",
    action: exportPng,
    input: { designId: "design-1" },
    readOnly: false,
  },
  {
    name: "export-svg",
    action: exportSvg,
    input: { id: "design-1" },
    readOnly: true,
  },
  {
    name: "export-pdf",
    action: exportPdf,
    input: { id: "design-1" },
    readOnly: true,
  },
] as const;

describe("Design import/export action contracts", () => {
  it.each(ACTION_CONTRACTS)(
    "$name remains exposed with a valid representative input",
    ({ action, input, readOnly }) => {
      expect(action.schema.safeParse(input).success).toBe(true);
      expect(action.readOnly ?? false).toBe(readOnly);
      expect(action.run).toEqual(expect.any(Function));
    },
  );
});
