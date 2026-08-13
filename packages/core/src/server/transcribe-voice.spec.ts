import { beforeEach, describe, expect, it, vi } from "vitest";

import { GATEWAY_UNAVAILABLE_VISITOR_MESSAGE } from "../agent/engine/credential-errors.js";

const state = vi.hoisted(() => ({
  hasGatewayCredential: false,
  status: 0,
  provider: "builder" as string,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: () => "POST",
  readMultipartFormData: vi.fn(async () => [
    { name: "provider", data: Buffer.from(state.provider) },
    { name: "audio", data: Buffer.from([1, 2, 3]), type: "audio/webm" },
  ]),
  setResponseStatus: (_event: unknown, status: number) => {
    state.status = status;
  },
}));

vi.mock("./request-origin.js", () => ({ isSameOriginRequest: () => true }));
vi.mock("./auth.js", () => ({ getSession: async () => null }));
vi.mock("../org/context.js", () => ({ getOrgContext: async () => null }));
vi.mock("../application-state/store.js", () => ({
  appStateGet: async () => null,
}));
vi.mock("../agent/engine/builder-engine.js", () => ({
  createBuilderEngine: () => ({ stream: () => [] }),
}));
vi.mock("./request-context.js", () => ({
  runWithRequestContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
    fn(),
}));
// Real `gatewayLaneUnavailableMessage`: which audience each rejection is
// written for is the behavior under test, so that decision is not stubbed. It
// reads `BUILDER_GATEWAY_TOKEN` from the environment.
vi.mock("./credential-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credential-provider.js")>()),
  resolveSecret: async () => null,
  resolveHasBuilderGatewayCredential: async () => state.hasGatewayCredential,
}));

const transcribeWithBuilder = vi.hoisted(() => vi.fn());
vi.mock("../transcription/builder-transcription.js", () => ({
  transcribeWithBuilder,
}));

const { createTranscribeVoiceHandler } = await import("./transcribe-voice.js");

async function post() {
  const handler = createTranscribeVoiceHandler() as unknown as (
    event: unknown,
  ) => Promise<{ text?: string; error?: string }>;
  return handler({ node: {} });
}

describe("transcribe-voice Builder provider gate", () => {
  beforeEach(() => {
    state.status = 0;
    state.provider = "builder";
    delete process.env.BUILDER_GATEWAY_TOKEN;
    transcribeWithBuilder.mockReset();
    transcribeWithBuilder.mockResolvedValue({
      text: "hello",
      language: "en",
      durationSeconds: 1,
      segments: [],
    });
  });

  // The gate used to ask the identity-only question, which is false on a
  // Builder-credits site: the gateway transcription path was unreachable and the
  // visitor was told to connect an account they do not have.
  it("transcribes through the gateway lane on a credits-only deployment", async () => {
    state.hasGatewayCredential = true;
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";

    await expect(post()).resolves.toEqual({ text: "hello" });
    expect(transcribeWithBuilder).toHaveBeenCalledTimes(1);
  });

  it("gives a visitor the one line when no lane resolves on a credits site", async () => {
    state.hasGatewayCredential = false;
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";

    await expect(post()).resolves.toEqual({
      error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    });
    expect(state.status).toBe(400);
    expect(transcribeWithBuilder).not.toHaveBeenCalled();
  });

  it("keeps the diagnosable copy for an owner with no credits lane", async () => {
    state.hasGatewayCredential = false;

    const result = await post();
    expect(result.error).toContain("Builder.io is not connected");
    expect(result.error).toContain("Settings");
  });

  it("hides an upstream gateway failure behind the one visitor line", async () => {
    state.hasGatewayCredential = true;
    process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    transcribeWithBuilder.mockRejectedValue(
      new Error("Builder transcription failed (403 Forbidden): revoked token"),
    );

    await expect(post()).resolves.toEqual({
      error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    });
    expect(state.status).toBe(502);
  });

  // "auto" is what the sidebar composer and every web client send, so this is
  // the route a visitor actually takes — the explicit "builder" preference above
  // is the desktop client's per-press choice.
  describe("auto provider chain", () => {
    beforeEach(() => {
      state.provider = "auto";
      state.hasGatewayCredential = true;
      process.env.BUILDER_GATEWAY_TOKEN = "btk-site-token";
    });

    it("hides the gateway's credits sentence behind the one visitor line", async () => {
      transcribeWithBuilder.mockRejectedValue(
        new Error("Builder transcription failed (402): credits exhausted"),
      );

      await expect(post()).resolves.toEqual({
        error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
      });
      expect(state.status).toBe(402);
    });

    it("hides the upstream error and the owner's env-var setup behind it too", async () => {
      transcribeWithBuilder.mockRejectedValue(
        new Error(
          "Builder transcription failed (403 Forbidden): revoked token",
        ),
      );

      await expect(post()).resolves.toEqual({
        error: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
      });
      expect(state.status).toBe(502);
    });

    it("keeps the owner's diagnosable copy off a credits deployment", async () => {
      delete process.env.BUILDER_GATEWAY_TOKEN;
      transcribeWithBuilder.mockRejectedValue(
        new Error(
          "Builder transcription failed (403 Forbidden): revoked token",
        ),
      );

      const result = await post();
      expect(result.error).toContain("revoked token");
      expect(result.error).toContain("GEMINI_API_KEY");
      expect(state.status).toBe(502);
    });
  });
});
