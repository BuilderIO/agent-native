import { describe, expect, it } from "vitest";

import { describeThrownForLog, redactEmbedText } from "./embed-redaction.js";
import { redactEmbedCredentials } from "./execute-action-call.js";

const ticket = "synthetic-ticket";
const start = `https://mail.agent-native.com/_agent-native/embed/start?ticket=${ticket}`;

describe("embed redaction at diagnostic and proxy boundaries", () => {
  it("preserves ordinary diagnostic prose and non-route URLs", () => {
    for (const message of [
      "Check the embed start behavior.",
      "Read the Agent-Native embed start guide.",
      start.replace("embed", "em1bed"),
    ]) {
      expect(redactEmbedText(message)).toBe(message);
    }
  });

  it.each([
    ["absolute", start],
    ["relative", `embed/start?ticket=${ticket}`],
    ["dot segment", start.replace("/start", "/./start")],
    ["backslash", start.replace("/start", `${String.fromCharCode(92)}start`)],
    [
      "nested encoded",
      `https://redirect.example/?next=${encodeURIComponent(start)}`,
    ],
    ["HTML escaped", start.replaceAll("/", "&#x2f;")],
    [
      "format character",
      start.replace("embed", `em${String.fromCodePoint(0x200b)}bed`),
    ],
    [
      "compatibility form",
      start.replace("embed/start", "ｅｍｂｅｄ／ｓｔａｒｔ"),
    ],
  ])("hides credential URLs in logged errors (%s)", (_name, url) => {
    expect(describeThrownForLog(new Error(`Request failed: ${url}`))).toBe(
      "[hidden embed URL]",
    );
  });

  it("checks an error's name as well as its message before logging", () => {
    const error = new Error("Request failed");
    error.name = start;
    expect(describeThrownForLog(error)).toBe("[hidden embed URL]");
  });

  it("removes reserved proxy metadata even when its URL was already masked", () => {
    const content = "Synthetic note about the embed start behavior.";
    expect(
      redactEmbedCredentials({
        content,
        embedStartUrl: "[hidden embed URL]",
        ticket,
        _meta: {
          "agent-native/embedStart": { startUrl: start, expiresAt: 123 },
        },
      }),
    ).toEqual({ content, _meta: {} });
  });
});
