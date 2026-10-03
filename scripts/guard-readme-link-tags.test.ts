import { describe, expect, it } from "vitest";

import {
  findReadmeLinks,
  findUntaggedLinks,
  selectReadmePaths,
} from "./guard-readme-link-tags.js";

const TAG = "utm_source=github&utm_medium=referral&utm_content=readme";

function untaggedUrls(text: string): string[] {
  return findUntaggedLinks([{ path: "README.md", text }]).map(
    (violation) => violation.url,
  );
}

describe("readme link tag guard", () => {
  it("passes a link that carries utm_source", () => {
    expect(
      untaggedUrls(`[docs](https://agent-native.com/docs?${TAG})`),
    ).toEqual([]);
  });

  it("fails an untagged link and reports its line", () => {
    expect(
      findUntaggedLinks([
        {
          path: "README.md",
          text: "intro\n\n[docs](https://agent-native.com/docs)\n",
        },
      ]),
    ).toEqual([
      { path: "README.md", line: 3, url: "https://agent-native.com/docs" },
    ]);
  });

  it("fails a link whose utm_source is empty or only another utm parameter", () => {
    expect(
      untaggedUrls(
        [
          "[a](https://agent-native.com/?utm_source=)",
          "[b](https://agent-native.com/?utm_medium=referral)",
        ].join("\n"),
      ),
    ).toEqual([
      "https://agent-native.com/?utm_source=",
      "https://agent-native.com/?utm_medium=referral",
    ]);
  });

  it("catches www and app subdomains", () => {
    expect(
      untaggedUrls(
        [
          "[a](https://www.agent-native.com/docs)",
          "[b](https://design.agent-native.com)",
          "[c](http://AGENT-NATIVE.com/apps)",
        ].join("\n"),
      ),
    ).toEqual([
      "https://www.agent-native.com/docs",
      "https://design.agent-native.com",
      "http://AGENT-NATIVE.com/apps",
    ]);
  });

  it("ignores other hosts, lookalikes, and relative links", () => {
    expect(
      untaggedUrls(
        [
          "[a](https://github.com/BuilderIO/agent-native)",
          "[b](https://notagent-native.com/docs)",
          "[c](https://agent-native.com.example.org/docs)",
          "[d](./docs/README.md)",
          "[e](mailto:hi@agent-native.com)",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("skips images, including an image nested in a tagged link", () => {
    expect(
      untaggedUrls(
        [
          "![logo](https://agent-native.com/logo.png)",
          `[![logo](https://agent-native.com/logo.png)](https://agent-native.com/?${TAG})`,
          '<img src="https://agent-native.com/logo.png" alt="logo">',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("still checks the link around an image", () => {
    expect(
      untaggedUrls(
        "[![logo](https://agent-native.com/logo.png)](https://agent-native.com/apps)",
      ),
    ).toEqual(["https://agent-native.com/apps"]);
  });

  it("skips fenced code blocks, including indented and tilde fences", () => {
    expect(
      untaggedUrls(
        [
          "```bash",
          "open https://agent-native.com/docs",
          "[x](https://agent-native.com/docs)",
          "```",
          "   ~~~md",
          "[y](https://design.agent-native.com)",
          "   ~~~",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("resumes checking after a fenced block closes", () => {
    expect(
      untaggedUrls(
        [
          "```",
          "[x](https://agent-native.com/a)",
          "```",
          "[y](https://agent-native.com/b)",
        ].join("\n"),
      ),
    ).toEqual(["https://agent-native.com/b"]);
  });

  it("skips inline code but not the text around it", () => {
    expect(
      untaggedUrls(
        [
          "Open `https://design.agent-native.com` or ``[x](https://agent-native.com/a)``.",
          "Then [docs](https://agent-native.com/docs).",
        ].join("\n"),
      ),
    ).toEqual(["https://agent-native.com/docs"]);
  });

  it("requires the tag before the fragment", () => {
    expect(
      untaggedUrls(
        `[a](https://agent-native.com/docs/deployment?${TAG}#email-provider)`,
      ),
    ).toEqual([]);
    expect(
      untaggedUrls(
        `[b](https://agent-native.com/docs/deployment#email-provider?${TAG})`,
      ),
    ).toEqual([
      `https://agent-native.com/docs/deployment#email-provider?${TAG}`,
    ]);
    expect(
      untaggedUrls(
        "[c](https://agent-native.com/docs/deployment#email-provider)",
      ),
    ).toEqual(["https://agent-native.com/docs/deployment#email-provider"]);
  });

  it("catches HTML anchors with any quoting and checks the tag in them", () => {
    expect(
      untaggedUrls(
        [
          '<a href="https://agent-native.com/apps/clips/">',
          "<a\n  target='_blank'\n  href='https://clips.agent-native.com'>",
          "<A HREF=https://agent-native.com/docs>",
          `<a href="https://agent-native.com/apps/mail/?utm_source=github&amp;utm_medium=referral">`,
        ].join("\n"),
      ),
    ).toEqual([
      "https://agent-native.com/apps/clips/",
      "https://clips.agent-native.com",
      "https://agent-native.com/docs",
    ]);
  });

  it("does not treat the visible text of an anchor as a second link", () => {
    expect(
      untaggedUrls(
        `<a href="https://agent-native.com/?${TAG}">https://agent-native.com</a>`,
      ),
    ).toEqual([]);
  });

  it("catches autolinks, bare URLs, and reference definitions", () => {
    expect(
      untaggedUrls(
        [
          "<https://agent-native.com/docs>",
          "Visit https://www.agent-native.com/apps, or www.agent-native.com/docs.",
          "[ref]: https://agent-native.com/ref",
          "[wrapped]: <https://agent-native.com/wrapped> 'Title'",
        ].join("\n"),
      ),
    ).toEqual([
      "https://agent-native.com/docs",
      "https://www.agent-native.com/apps",
      "www.agent-native.com/docs",
      "https://agent-native.com/ref",
      "https://agent-native.com/wrapped",
    ]);
  });

  it("does not flag URLs shown as link text of a tagged link", () => {
    expect(
      untaggedUrls(
        `[agent-native.com/docs](https://agent-native.com/docs?${TAG}) and [https://agent-native.com](https://agent-native.com/?${TAG})`,
      ),
    ).toEqual([]);
  });

  it("skips HTML comments and handles link titles", () => {
    expect(
      untaggedUrls(
        [
          "<!-- [x](https://agent-native.com/a) -->",
          '[y](https://agent-native.com/b "Title (b)")',
        ].join("\n"),
      ),
    ).toEqual(["https://agent-native.com/b"]);
  });

  it("keeps line numbers across CRLF files", () => {
    expect(
      findUntaggedLinks([
        {
          path: "README.md",
          text: "a\r\n```\r\nx\r\n```\r\n[y](https://agent-native.com)\r\n",
        },
      ]),
    ).toEqual([
      { path: "README.md", line: 5, url: "https://agent-native.com" },
    ]);
  });

  it("reports every link position so a tagger can rewrite it", () => {
    const text = "[a](https://agent-native.com/docs#x)";
    const [link] = findReadmeLinks(text);
    expect(text.slice(link.start, link.end)).toBe(
      "https://agent-native.com/docs#x",
    );
  });

  it("selects README.md files outside fixtures and vendored trees", () => {
    expect(
      selectReadmePaths([
        "README.md",
        "templates/mail/README.md",
        "templates/mail/README-tokens.md",
        "packages/creative-context/src/eval/fixtures/README.md",
        "packages/mobile-app/plugins/fixtures/expo/README.md",
        "node_modules/pkg/README.md",
        "CHANGELOG.md",
      ]),
    ).toEqual(["README.md", "templates/mail/README.md"]);
  });
});
