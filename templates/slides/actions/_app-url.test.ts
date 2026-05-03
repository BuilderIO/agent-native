import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDeckUrl, getExportUrl, getSlidesAppUrl } from "./_app-url.js";

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("slides app URLs", () => {
  it("preserves workspace gateway URLs and APP_BASE_PATH", () => {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", "https://workspace.example.test");
    vi.stubEnv("APP_BASE_PATH", "/slides");

    expect(getSlidesAppUrl()).toBe("https://workspace.example.test/slides");
    expect(getDeckUrl("deck-1")).toBe(
      "https://workspace.example.test/slides/deck/deck-1",
    );
  });

  it("does not duplicate APP_BASE_PATH when APP_URL is already scoped", () => {
    vi.stubEnv("APP_URL", "https://workspace.example.test/slides/");
    vi.stubEnv("APP_BASE_PATH", "/slides");

    expect(getDeckUrl("deck-2")).toBe(
      "https://workspace.example.test/slides/deck/deck-2",
    );
  });

  it("uses hosting URL env vars for generated workspace deploys", () => {
    vi.stubEnv("URL", "https://generated-workspace.netlify.app");
    vi.stubEnv("APP_BASE_PATH", "/slides");

    expect(getExportUrl("deck.pptx")).toBe(
      "https://generated-workspace.netlify.app/slides/api/exports/deck.pptx",
    );
  });

  it("falls back to the first-party Slides host when no app URL is configured", () => {
    expect(getDeckUrl("deck-3")).toBe(
      "https://slides.agent-native.com/deck/deck-3",
    );
  });
});
