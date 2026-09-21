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

  it("caps structured table columns and avoids deep cell serialization", () => {
    const headers = Array.from({ length: 10 }, (_, index) => `Column ${index}`);
    const preview = parseOutputPreview(
      JSON.stringify({
        type: "table",
        headers,
        rows: [[{ nested: { value: "safe" } }, ...Array(9).fill("extra")]],
      }),
    );

    expect(preview).toEqual({
      kind: "table",
      headers: headers.slice(0, 8),
      rows: [["[…]", ...Array(7).fill("extra")]],
    });
  });

  it("does not turn untrusted image protocols into image previews", () => {
    expect(parseOutputPreview("![preview](javascript:alert(1))")).toEqual({
      kind: "text",
      text: "![preview](javascript:alert(1))",
    });
    expect(
      parseOutputPreview(
        JSON.stringify({ type: "image", src: "http://localhost:3000/image" }),
      ),
    ).toEqual({
      kind: "text",
      text: '{"type":"image","src":"http://localhost:3000/image"}',
    });
  });
});
