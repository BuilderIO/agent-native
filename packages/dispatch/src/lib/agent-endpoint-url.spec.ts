import { describe, expect, it } from "vitest";

import {
  agentEndpointUrlError,
  parseAgentEndpointUrl,
} from "./agent-endpoint-url.js";

describe("agentEndpointUrlError", () => {
  it("flags a markdown-link-artifact paste as invalid", () => {
    expect(
      agentEndpointUrlError("https://api.github.com](https://api.github.com"),
    ).toMatch(/valid url/i);
  });

  it("flags an empty value", () => {
    expect(agentEndpointUrlError("")).toMatch(/enter an endpoint url/i);
    expect(agentEndpointUrlError("   ")).toMatch(/enter an endpoint url/i);
  });

  it("flags a non-http(s) protocol", () => {
    expect(agentEndpointUrlError("ftp://agent.example.com")).toMatch(
      /http:\/\/ or https:\/\//i,
    );
  });

  it("flags credentials embedded in the URL", () => {
    expect(
      agentEndpointUrlError("https://user:pass@agent.example.com"),
    ).toMatch(/credentials/i);
  });

  it("accepts a well-formed https URL", () => {
    expect(agentEndpointUrlError("https://agent.example.com")).toBeNull();
  });

  it("accepts a well-formed http URL", () => {
    expect(agentEndpointUrlError("http://localhost:4000")).toBeNull();
  });
});

describe("parseAgentEndpointUrl", () => {
  it("throws the same message agentEndpointUrlError reports", () => {
    expect(() =>
      parseAgentEndpointUrl("https://api.github.com](https://api.github.com"),
    ).toThrow(/valid url/i);
  });

  it("returns a parsed URL for valid input", () => {
    const url = parseAgentEndpointUrl("https://agent.example.com/path");
    expect(url.hostname).toBe("agent.example.com");
  });
});
