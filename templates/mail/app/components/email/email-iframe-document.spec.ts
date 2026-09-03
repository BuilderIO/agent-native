import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildEmailIframeDocument } from "./email-iframe-document";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("Mail email iframe document", () => {
  it("builds a complete srcDoc document around sanitized email fragments", () => {
    expect(
      buildEmailIframeDocument(
        "<style>.message{color:red}</style>",
        '<p class="message">Hello</p>',
      ),
    ).toContain(
      '<head>\n  <meta charset="utf-8">\n  <style>.message{color:red}</style>\n</head>\n<body><p class="message">Hello</p></body>',
    );
  });

  it("includes host theme CSS before the iframe can paint email content", () => {
    const document = buildEmailIframeDocument(
      "",
      "<p>Hello</p>",
      "body { color: red; }",
    );

    expect(document).toContain(
      "<style data-mail-theme>\nbody { color: red; }\n  </style>\n</head>",
    );
  });

  it("uses srcDoc/load instead of replacing the mounted iframe document", () => {
    const source = readFileSync(join(HERE, "EmailThread.tsx"), "utf8");
    expect(source).toContain('data-agent-native-session-replay=""');
    expect(source).toContain("srcDoc={iframeDocument}");
    expect(source).toContain("setIframeReady(true)");
    expect(source).toContain("setIframeLoadVersion((version) => version + 1)");
    expect(source).toContain(
      'sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"',
    );
    expect(source).not.toContain('sandbox="allow-same-origin allow-scripts');
    expect(source).not.toContain("doc.open()");
    expect(source).not.toContain("doc.write(");
  });
});
