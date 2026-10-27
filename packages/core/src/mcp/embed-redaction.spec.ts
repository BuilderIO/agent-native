import { describe, expect, it } from "vitest";

import {
  describeThrownForLog,
  readString,
  redactEmbedText,
} from "./embed-redaction.js";
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
    "https://docs.example/embed/#start",
    "https://docs.example/embed/?start",
    "https://docs.example/_agent-native/embed/#start",
    "https://docs.example/embed/start",
    "ftp://docs.example/_agent-native/embed/start?ticket=SUP-2026-123",
    "//",
    "Edit packages/server/embed/start.tsx",
    "Use embed/start or embed/stop",
    "embed/start?ticket=",
    "embed/start#ticket=synthetic-ticket",
    "https://docs.example/_agent-native/embed/start.tsx?ticket=SUP-2026-123",
    "https://docs.example/docs/_agent-native/embed/start?ticket=SUP-2026-123",
    "objectives/tasks/Fix chat failing because the embed start URL is redacted.md",
    "Saved the note about the embed start URL.",
  ])(
    "preserves ordinary references and their unrelated ticket data (%s)",
    (content) => {
      const value = {
        content,
        ticket: "SUP-2026-123",
        note: "Follow up on SUP-2026-123",
        links: { [content]: "guide" },
      };
      expect(readString(content).mentionsRoute).toBe(false);
      expect(redactEmbedCredentials(value)).toEqual(value);
    },
  );

  it.each([
    ["absolute", start],
    [
      "browser HTTP scheme without slashes",
      start.replace("https://", "https:"),
    ],
    [
      "browser HTTP scheme with one slash",
      start.replace("https://", "https:/"),
    ],
    ["network reference", start.replace("https:", "")],
    [
      "relative namespaced reference",
      `_agent-native/embed/start?ticket=${ticket}`,
    ],
    ["absolute URL in a schema path", `/properties/${start}`],
    ["relative", `embed/start?ticket=${ticket}`],
    [
      "relative link made absolute",
      `https://mail.agent-native.com/embed/start?ticket=${ticket}`,
    ],
    ["dot segment", start.replace("/start", "/./start")],
    ["relative dot segment", `embed/./start?ticket=${ticket}`],
    ["trailing path", start.replace("/start?", "/start/child?")],
    ["route only", start.split("?")[0]],
    [
      "opaque segment then encoded parent",
      start.replace("/start", "/a%2Fb/%2e%2e/start"),
    ],
    ["raw route canceled by parent", start.replace("/start?", "/start/../?")],
    ["backslash", start.replace("/start", `${String.fromCharCode(92)}start`)],
    [
      "nested encoded",
      `https://redirect.example/?next=${encodeURIComponent(start)}`,
    ],
    [
      "nested fragment",
      `https://redirect.example/#next=${encodeURIComponent(start)}`,
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
    ["unknown entity", start.replace("embed", "em&bogus;bed")],
  ])("hides credential URLs in logged errors (%s)", (_name, url) => {
    expect(readString(url).mentionsRoute).toBe(true);
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
        echo: `Open ${ticket}`,
      }),
    ).toEqual({ content, _meta: {}, echo: "[hidden embed ticket]" });
  });

  it("learns a nested URL's ticket before removing sibling ticket fields and echoes", () => {
    expect(
      redactEmbedCredentials({
        next: `https://redirect.example/#next=${encodeURIComponent(start)}`,
        support: { ticket, note: `Open ${ticket}` },
      }),
    ).toEqual({
      next: "[hidden embed URL]",
      support: { note: "[hidden embed ticket]" },
    });
  });
});
