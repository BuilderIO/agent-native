import { describe, expect, it } from "vitest";

import {
  formatLlmCredentialErrorMessage,
  GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
  gatewayVisitorFacingError,
  isLlmCredentialError,
  LLM_MISSING_CREDENTIALS_MESSAGE,
  userFacingLlmCredentialError,
} from "./credential-errors.js";

describe("LLM credential error helpers", () => {
  it("detects raw LLM provider env var failures", () => {
    expect(isLlmCredentialError("ANTHROPIC_API_KEY is not set")).toBe(true);
    expect(
      userFacingLlmCredentialError(new Error("OPENAI_API_KEY is required")),
    ).toBe(LLM_MISSING_CREDENTIALS_MESSAGE);
  });

  it("detects structured missing-credential errors", () => {
    expect(
      isLlmCredentialError(new Error("anything"), "missing_credentials"),
    ).toBe(true);
  });

  it("does not treat an unreadable credential store as a setup failure", () => {
    expect(
      isLlmCredentialError(
        new Error("Could not read your saved connections"),
        "credential_store_unavailable",
      ),
    ).toBe(false);
  });

  it("does not treat generic authentication failures as LLM setup failures", () => {
    expect(isLlmCredentialError("Authentication required")).toBe(false);
    expect(
      isLlmCredentialError("Slack outbound messaging is not configured"),
    ).toBe(false);
    expect(isLlmCredentialError("Credentials are not configured")).toBe(false);
  });

  // The per-rejection-code table lives in builder-engine.spec.ts, where the
  // codes are produced by real gateway responses rather than listed by hand.
  it("keeps the real reason on the error code while rewriting the message", () => {
    expect(gatewayVisitorFacingError("credits-limit-reached")).toStrictEqual({
      error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
      errorCode: "credits-limit-reached",
    });
    // A codeless rejection must not invent an `errorCode: undefined` key: the
    // stop event's absent-vs-unknown distinction is what run-store persists.
    // `toStrictEqual`, because `toEqual` ignores undefined-valued keys and
    // would stay green if the helper started emitting one.
    expect(gatewayVisitorFacingError()).toStrictEqual({
      error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    });
  });

  it("gives a visitor the one line instead of owner setup instructions", () => {
    expect(formatLlmCredentialErrorMessage({ visitorFacing: true })).toBe(
      GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    );
    // An agent name must not reintroduce the owner copy on a visitor surface.
    expect(
      formatLlmCredentialErrorMessage({
        agentName: "Slides",
        visitorFacing: true,
      }),
    ).toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);
    expect(
      userFacingLlmCredentialError(new Error("ANTHROPIC_API_KEY is not set"), {
        visitorFacing: true,
      }),
    ).toBe(GATEWAY_UNAVAILABLE_VISITOR_MESSAGE);
    // Owner surfaces keep the diagnosable copy — that is the whole distinction.
    expect(formatLlmCredentialErrorMessage({ visitorFacing: false })).toBe(
      LLM_MISSING_CREDENTIALS_MESSAGE,
    );
  });

  it("formats agent-specific copy without provider env vars", () => {
    const message = formatLlmCredentialErrorMessage({ agentName: "Slides" });
    expect(message).toContain("Slides agent");
    expect(message).toContain("Manage agent > LLM");
    expect(message).not.toContain("ANTHROPIC_API_KEY");
  });
});
