import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  isTrustedSessionReplayIframeParentOrigin,
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
  SESSION_REPLAY_IFRAME_PROBE,
  SESSION_REPLAY_IFRAME_START,
  SESSION_REPLAY_IFRAME_STOP,
} from "../session-replay-iframe-protocol.js";
import {
  buildSessionReplayIframeBootstrap,
  injectSessionReplayIframeBootstrap,
  RRWEB_RECORD_IFRAME_CDN_URL,
  RRWEB_RECORD_IFRAME_SRI,
} from "./session-replay-iframe.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION_CLIENT_DIR = join(HERE, "..", "client", "extensions");

describe("cooperative iframe session replay", () => {
  it("pins the installed rrweb recorder and waits for a trusted start message", () => {
    const bootstrap = buildSessionReplayIframeBootstrap();

    expect(RRWEB_RECORD_IFRAME_CDN_URL).toBe(
      "https://cdn.jsdelivr.net/npm/@rrweb/record@2.1.0/umd/record.min.js",
    );
    expect(RRWEB_RECORD_IFRAME_SRI).toBe(
      "sha384-MrD66HBNSykaP2N95+6hQCFlF5oH2tvL3TD/zyvHNkP/sAFWZx98DX9MEDy8MdVT",
    );
    expect(bootstrap).toContain(
      `script.src = "${RRWEB_RECORD_IFRAME_CDN_URL}"`,
    );
    expect(bootstrap).toContain(
      `script.integrity = "${RRWEB_RECORD_IFRAME_SRI}"`,
    );
    expect(bootstrap).toContain(
      "event.source !== window.parent || !isTrustedParentOrigin(event.origin, window.location.href)",
    );
    expect(bootstrap).toContain(
      `message.type === "${SESSION_REPLAY_IFRAME_START}"`,
    );
    expect(bootstrap).toContain(
      `message.type === "${SESSION_REPLAY_IFRAME_STOP}"`,
    );
    expect(bootstrap).toContain(`type: "${SESSION_REPLAY_IFRAME_PROBE}"`);
    expect(bootstrap).toContain("recordCrossOriginIframes: true");
    expect(bootstrap).not.toContain("<script src=");
  });

  it("trusts srcDoc parents and same-origin render parents, but rejects external embeds", () => {
    expect(
      isTrustedSessionReplayIframeParentOrigin(
        "https://custom.example.test",
        "about:srcdoc",
      ),
    ).toBe(true);
    expect(
      isTrustedSessionReplayIframeParentOrigin(
        "https://custom.example.test",
        "https://custom.example.test/_agent-native/extensions/ext-1/render",
      ),
    ).toBe(true);
    expect(
      isTrustedSessionReplayIframeParentOrigin(
        "https://external.example.test",
        "https://custom.example.test/_agent-native/extensions/ext-1/render",
      ),
    ).toBe(false);
    expect(
      isTrustedSessionReplayIframeParentOrigin("null", "about:srcdoc"),
    ).toBe(false);
  });

  it("prepends only the recorder bootstrap to raw editor previews", () => {
    const content = "<!doctype html><p>preview</p>";
    const html = injectSessionReplayIframeBootstrap(content);
    expect(html.endsWith(content)).toBe(true);
    expect(html).toContain(SESSION_REPLAY_IFRAME_PROBE);
    expect(html).not.toContain("window.appAction =");

    const document = injectSessionReplayIframeBootstrap(
      "<!doctype html><html><head><title>Preview</title></head><body /></html>",
    );
    expect(document.indexOf("<!doctype html>")).toBe(0);
    expect(document.indexOf(SESSION_REPLAY_IFRAME_PROBE)).toBeLessThan(
      document.indexOf("</head>"),
    );
  });

  it("marks every first-party extension iframe host", () => {
    const hostFiles = [
      "AgentNativeExtensionFrame.tsx",
      "EmbeddedExtension.tsx",
      "ExtensionEditor.tsx",
      "ExtensionViewer.tsx",
      "InlineExtensionFrame.tsx",
    ];

    for (const file of hostFiles) {
      const source = readFileSync(join(EXTENSION_CLIENT_DIR, file), "utf8");
      expect(source, file).toContain("SESSION_REPLAY_IFRAME_ATTRIBUTE");
    }
    expect(SESSION_REPLAY_IFRAME_ATTRIBUTE).toBe(
      "data-agent-native-session-replay",
    );
  });
});
