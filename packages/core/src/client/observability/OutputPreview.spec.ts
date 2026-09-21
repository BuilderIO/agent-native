import { describe, expect, it } from "vitest";

import { parseOutputPreview } from "./OutputPreview.js";

describe("parseOutputPreview", () => {
  it("recognizes bounded chart payloads", () => {
    expect(
      parseOutputPreview(
        JSON.stringify({
          type: "chart",
          title: "Latency",
          data: [
            { label: "p50", value: 120 },
            { label: "p95", value: 480 },
          ],
        }),
      ),
    ).toEqual({
      kind: "chart",
      title: "Latency",
      unit: undefined,
      data: [
        { label: "p50", value: 120 },
        { label: "p95", value: 480 },
      ],
    });
  });

  it("renders Markdown tables as table previews", () => {
    expect(
      parseOutputPreview("| Name | Score |\n| --- | ---: |\n| Ada | 0.9 |"),
    ).toEqual({
      kind: "table",
      headers: ["Name", "Score"],
      rows: [["Ada", "0.9"]],
    });
  });

  it("does not turn untrusted image protocols into image previews", () => {
    expect(parseOutputPreview("![preview](javascript:alert(1))")).toEqual({
      kind: "text",
      text: "![preview](javascript:alert(1))",
    });
  });
});
