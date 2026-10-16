import { describe, expect, it } from "vitest";

import { splitMarkdownExportManifest } from "./blocks-fields-manifest";

const comment = (json: string) => `<!-- agent-native-blocks:${json} -->`;

describe("splitMarkdownExportManifest", () => {
  it("leaves Markdown without a manifest as it is", () => {
    expect(splitMarkdownExportManifest("# Plan\n\nBody\n")).toEqual({
      body: "# Plan\n\nBody\n",
      manifest: { kind: "absent" },
    });
  });

  it("keeps the marker as text when it is not the last line", () => {
    const text = `${comment('{"version":1,"fields":[]}')}\n\nMore text\n`;
    expect(splitMarkdownExportManifest(text)).toEqual({
      body: text,
      manifest: { kind: "absent" },
    });
    const inline = `See ${comment('{"version":1,"fields":[]}')}\n`;
    expect(splitMarkdownExportManifest(inline).manifest.kind).toBe("absent");
  });

  it("reads a manifest written before fields named the primary one", () => {
    const fields = [{ name: "Content", markdown: "Body" }];
    expect(
      splitMarkdownExportManifest(
        `Body\n\n${comment(JSON.stringify({ version: 1, fields }))}\n`,
      ),
    ).toEqual({
      body: "Body\n",
      manifest: {
        kind: "read",
        fields: [{ name: "Content", primary: null, markdown: "Body" }],
      },
    });
  });

  it.each([
    ["an unclosed comment", "<!-- agent-native-blocks:{}"],
    ["JSON it cannot parse", comment("{not json")],
    ["another version", comment('{"version":2,"fields":[]}')],
    [
      "a field without Markdown",
      comment('{"version":1,"fields":[{"name":"A"}]}'),
    ],
  ])("reports %s as unreadable, and keeps the body", (_, line) => {
    const { body, manifest } = splitMarkdownExportManifest(`Body\n\n${line}\n`);
    expect(body).toBe("Body\n");
    expect(manifest.kind).toBe("unreadable");
  });
});
