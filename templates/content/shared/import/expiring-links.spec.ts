import { describe, expect, it } from "vitest";

import { expiringFileLabel, isExpiringFileUrl } from "./expiring-links";
import { finalizeMarkdownImport } from "./finalize";
import { newTablePaddingBudget, parseMarkdownImport } from "./markdown";
import { splitReferenceSuffix } from "./paths";

const SIGNED =
  "https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/def/Spec%20sheet.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=deadbeef";
const SIGNED_IMAGE =
  "https://file.notion.so/f/f/abc/def/chart.png?id=1&table=block&expirationTimestamp=1700000000000&signature=abc";

describe("Expiring file links", () => {
  it("tells Notion's signed file links from links that last", () => {
    expect(isExpiringFileUrl(SIGNED)).toBe(true);
    expect(isExpiringFileUrl(SIGNED_IMAGE)).toBe(true);
    expect(
      isExpiringFileUrl(
        "https://s3.us-west-2.amazonaws.com/secure.notion-static.com/a/b.png?X-Amz-Signature=1",
      ),
    ).toBe(true);
    expect(
      isExpiringFileUrl(
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b.png",
      ),
    ).toBe(false);
    expect(
      isExpiringFileUrl(
        "https://s3.us-west-2.amazonaws.com/other-bucket/b.png?X-Amz-Signature=1",
      ),
    ).toBe(false);
    expect(isExpiringFileUrl(SIGNED.replace("https:", "http:"))).toBe(false);
    expect(
      isExpiringFileUrl("https://www.notion.so/images/page-cover/x.png"),
    ).toBe(false);
    expect(expiringFileLabel(SIGNED)).toBe("Spec sheet.pdf");
  });

  it("asks for an upload of each signed file and names what happened", () => {
    const draft = parseMarkdownImport({
      sourcePath: "page.md",
      text: `# Page\n\n![Chart](${SIGNED_IMAGE})\n\n[Spec sheet](${SIGNED})`,
      tablePadding: newTablePaddingBudget(),
    });
    const requested: string[] = [];

    const preview = finalizeMarkdownImport(
      draft,
      {
        asset: (request) => {
          if (request.kind === "remote") requested.push(request.url);
          return { status: "available" };
        },
      },
      "preview",
    );
    expect(requested).toEqual([SIGNED_IMAGE, SIGNED]);
    expect(preview.report.notes).toEqual([
      expect.objectContaining({
        kind: "expiring-link-rehosted",
        samples: ["chart.png", "Spec sheet.pdf"],
      }),
    ]);

    const uploaded = finalizeMarkdownImport(
      draft,
      {
        asset: (request) =>
          request.kind === "remote" && request.url === SIGNED_IMAGE
            ? { status: "resolved", url: "https://files.example/chart.png" }
            : { status: "missing" },
      },
      "apply",
    );
    expect(uploaded.content).toContain("https://files.example/chart.png");
    expect(uploaded.content).toContain(SIGNED.split("?")[0]);
    expect(uploaded.report.status).toBe("lost");
    expect(
      uploaded.report.notes.map((note) => [note.kind, note.samples]),
    ).toEqual([
      ["expiring-link-not-rehosted", ["Spec sheet.pdf"]],
      ["expiring-link-rehosted", ["chart.png"]],
    ]);
  });

  it("asks for an upload of a signed image in Content's own Markdown too", () => {
    const draft = parseMarkdownImport({
      sourcePath: "page.md",
      text: [
        '<callout icon="💡" color="blue_bg">',
        "\tNote",
        "</callout>",
        `![Chart](${SIGNED_IMAGE})`,
      ].join("\n"),
      tablePadding: newTablePaddingBudget(),
    });
    const requested: string[] = [];

    const page = finalizeMarkdownImport(
      draft,
      {
        asset: (request) => {
          if (request.kind === "remote") requested.push(request.url);
          return { status: "missing" };
        },
        unhostedUrl: (url) => url.split("?")[0] ?? url,
      },
      "apply",
    );
    expect(page.dialect).toBe("nfm");
    expect(requested).toEqual([SIGNED_IMAGE]);
    expect(page.content).not.toContain("signature=abc");
  });
});

describe("Relative references with a # in the file name", () => {
  it("finds the file name before a fragment", () => {
    expect(splitReferenceSuffix("guide.md#setup")).toEqual({
      path: "guide.md",
      suffix: "#setup",
    });
    expect(splitReferenceSuffix("guide.md?raw=1")).toEqual({
      path: "guide.md",
      suffix: "?raw=1",
    });
    expect(splitReferenceSuffix("Q%20#1%20abc.md")).toEqual({
      path: "Q%20#1%20abc.md",
      suffix: "",
    });
    expect(splitReferenceSuffix("Q%20#1%20abc.md#notes")).toEqual({
      path: "Q%20#1%20abc.md",
      suffix: "#notes",
    });
    expect(splitReferenceSuffix("folder#anchor")).toEqual({
      path: "folder",
      suffix: "#anchor",
    });
  });
});
