import { describe, expect, it } from "vitest";
import {
  formatLlmCredentialErrorMessage,
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

  it("does not treat generic authentication failures as LLM setup failures", () => {
    expect(isLlmCredentialError("Authentication required")).toBe(false);
    expect(
      isLlmCredentialError("Slack outbound messaging is not configured"),
    ).toBe(false);
    expect(isLlmCredentialError("Credentials are not configured")).toBe(false);
  });

  it("formats agent-specific copy without provider env vars", () => {
    const message = formatLlmCredentialErrorMessage({ agentName: "Slides" });
    expect(message).toContain("Slides agent");
    expect(message).toContain("Connect an LLM provider or Builder");
    expect(message).not.toContain("ANTHROPIC_API_KEY");
  });
});
