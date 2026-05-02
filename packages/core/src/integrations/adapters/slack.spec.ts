import { describe, expect, it } from "vitest";
import { slackAdapter } from "./slack.js";

describe("slackAdapter", () => {
  it("answers Slack URL verification with the raw challenge string", async () => {
    const adapter = slackAdapter();
    const event = {
      context: {
        __rawBody: JSON.stringify({
          type: "url_verification",
          challenge: "qa-challenge",
        }),
      },
    } as any;

    await expect(adapter.handleVerification(event)).resolves.toEqual({
      handled: true,
      response: "qa-challenge",
    });
  });

  it("does not bold-wrap bare URLs", () => {
    const formatted = slackAdapter().formatAgentResponse(
      "**https://slides.agent-native.com/deck/deck-qa**",
    );

    expect(formatted.text).toBe(
      "<https://slides.agent-native.com/deck/deck-qa>",
    );
  });
});
