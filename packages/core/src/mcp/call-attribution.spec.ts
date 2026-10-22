import { describe, expect, it } from "vitest";

import { mcpCallAttribution } from "./call-attribution.js";

const CLIENT_INFO = "io.modelcontextprotocol/clientInfo";

describe("mcpCallAttribution", () => {
  it("reads clientInfo from the lifted envelope before the request _meta", () => {
    expect(
      mcpCallAttribution({
        request: {
          params: {
            _meta: { [CLIENT_INFO]: { name: "from-meta", version: "0.1" } },
          },
        },
        envelope: { [CLIENT_INFO]: { name: "from-envelope", version: "2.0" } },
        oauthClientId: "client-123",
      }),
    ).toEqual({
      mcpClient: {
        name: "from-envelope",
        version: "2.0",
        oauthClientId: "client-123",
      },
    });
  });

  it("falls back to the request _meta when the envelope has no clientInfo", () => {
    expect(
      mcpCallAttribution({
        request: {
          params: {
            _meta: { [CLIENT_INFO]: { name: "cursor", version: "1" } },
          },
        },
        envelope: undefined,
        oauthClientId: undefined,
      }),
    ).toEqual({ mcpClient: { name: "cursor", version: "1" } });
  });

  it("adds nothing when the call carries no client facts", () => {
    expect(
      mcpCallAttribution({
        request: { params: { name: "list-forms" } },
        envelope: {},
        oauthClientId: undefined,
      }),
    ).toEqual({});
  });
});
