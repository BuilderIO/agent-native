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

  it("rejects negative chart values instead of rendering them inaccurately", () => {
    expect(
      parseOutputPreview(
        JSON.stringify({
          type: "chart",
          data: [
            { label: "loss", value: -10 },
            { label: "gain", value: 10 },
          ],
        }),
      ),
    ).toEqual({
      kind: "chart",
      title: undefined,
      unit: undefined,
      data: [{ label: "gain", value: 10 }],
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

  it("bounds inferred table headers", () => {
    const longHeader = "h".repeat(800);

    expect(
      parseOutputPreview(
        JSON.stringify({ type: "table", rows: [{ [longHeader]: "value" }] }),
      ),
    ).toEqual({
      kind: "table",
      headers: [longHeader.slice(0, 600)],
      rows: [["value"]],
    });
  });

  it("keeps display labels separate from object row keys and array indexes", () => {
    expect(
      parseOutputPreview(
        JSON.stringify({
          type: "table",
          headers: ["Name", "", "Score"],
          rows: [{ name: "Ada", hidden: "ignore", score: 0.9 }],
        }),
      ),
    ).toEqual({
      kind: "table",
      headers: ["Name", "Score"],
      rows: [["Ada", "0.9"]],
    });

    expect(
      parseOutputPreview(
        JSON.stringify({
          type: "table",
          headers: ["Name", "", "Score"],
          rows: [["Ada", "ignore", "0.9"]],
        }),
      ),
    ).toEqual({
      kind: "table",
      headers: ["Name", "Score"],
      rows: [["Ada", "0.9"]],
    });
  });

  it("limits Markdown scanning to a bounded line prefix", () => {
    const answer = [
      ...Array.from({ length: 50 }, () => "noise"),
      "| Name | Score |",
      "| --- | ---: |",
      "| Ada | 0.9 |",
    ].join("\n");

    expect(parseOutputPreview(answer)).toEqual({ kind: "text", text: answer });
  });

  it("bounds oversized answers before parsing or scanning", () => {
    const answer = Array.from({ length: 4_000 }, () => "noise").join("\n");
    const preview = parseOutputPreview(answer);

    expect(preview).toEqual({
      kind: "text",
      text: `${answer.slice(0, 20_000)}…`,
    });
  });

  it("does not return an unbounded whitespace suffix", () => {
    const preview = parseOutputPreview(`safe${" ".repeat(20_001)}`);

    expect(preview).toEqual({ kind: "text", text: "safe" });
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
    expect(
      parseOutputPreview(
        JSON.stringify({ type: "image", src: "https://192.168.0.2/image" }),
      ),
    ).toEqual({
      kind: "text",
      text: '{"type":"image","src":"https://192.168.0.2/image"}',
    });
    expect(
      parseOutputPreview(
        JSON.stringify({
          type: "image",
          src: "https://127.0.0.1.nip.io/image",
        }),
      ),
    ).toEqual({
      kind: "text",
      text: '{"type":"image","src":"https://127.0.0.1.nip.io/image"}',
    });
  });
});
