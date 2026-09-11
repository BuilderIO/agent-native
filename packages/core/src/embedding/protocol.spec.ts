import { describe, expect, it } from "vitest";

import {
  AGENT_NATIVE_EMBED_MESSAGE_TYPES,
  AGENT_NATIVE_EMBED_PROTOCOL,
  AGENT_NATIVE_EMBED_VERSION,
  createAgentNativeEmbedEnvelope,
  isAgentNativeEmbedEnvelope,
  isAllowedEmbeddedAppOrigin,
} from "./protocol.js";

describe("embedding protocol", () => {
  it("fails closed when no allowed origins are configured", () => {
    expect(isAllowedEmbeddedAppOrigin("https://assets.example", [])).toBe(
      false,
    );
    expect(
      isAllowedEmbeddedAppOrigin("https://assets.example", undefined),
    ).toBe(false);
    expect(
      isAllowedEmbeddedAppOrigin("https://assets.example", [
        "https://assets.example",
      ]),
    ).toBe(true);
    expect(isAllowedEmbeddedAppOrigin("https://assets.example", ["*"])).toBe(
      true,
    );
  });

  it("rejects malformed envelopes at the trust boundary", () => {
    expect(
      isAgentNativeEmbedEnvelope(
        createAgentNativeEmbedEnvelope(
          AGENT_NATIVE_EMBED_MESSAGE_TYPES.MESSAGE,
          {
            name: "chooseAsset",
            requestId: "request-1",
          },
        ),
      ),
    ).toBe(true);

    expect(
      isAgentNativeEmbedEnvelope({
        protocol: AGENT_NATIVE_EMBED_PROTOCOL,
        version: AGENT_NATIVE_EMBED_VERSION,
        type: AGENT_NATIVE_EMBED_MESSAGE_TYPES.MESSAGE,
        name: { bad: true },
      }),
    ).toBe(false);
    expect(
      isAgentNativeEmbedEnvelope({
        protocol: AGENT_NATIVE_EMBED_PROTOCOL,
        version: AGENT_NATIVE_EMBED_VERSION,
        type: AGENT_NATIVE_EMBED_MESSAGE_TYPES.RESPONSE,
        requestId: { bad: true },
      }),
    ).toBe(false);
    expect(
      isAgentNativeEmbedEnvelope({
        protocol: AGENT_NATIVE_EMBED_PROTOCOL,
        version: AGENT_NATIVE_EMBED_VERSION,
        type: AGENT_NATIVE_EMBED_MESSAGE_TYPES.ERROR,
        error: { code: "bad" },
      }),
    ).toBe(false);
  });
});
