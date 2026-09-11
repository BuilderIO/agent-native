import { describe, expect, it } from "vitest";

import {
  acceptsMarkdown,
  appendVary,
  buildMarkdownNotFoundResponse,
} from "./agent-web-responses";

describe("agent web response helpers", () => {
  it("recognizes positive Markdown negotiation and rejects q=0", () => {
    expect(acceptsMarkdown("text/html, text/markdown")).toBe(true);
    expect(acceptsMarkdown("text/markdown; q=0")).toBe(false);
  });

  it("returns a recoverable Markdown 404", async () => {
    const response = buildMarkdownNotFoundResponse();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("vary")).toBe("Accept, Accept-Encoding");
    expect(await response.text()).toContain(
      "https://www.agent-native.com/llms.txt",
    );
  });

  it("adds content-negotiation values without duplicating them", () => {
    const headers = new Headers({ vary: "Accept-Encoding" });
    appendVary(headers, ["Accept", "Accept-Encoding"]);

    expect(headers.get("vary")).toBe("Accept-Encoding, Accept");
  });
});
