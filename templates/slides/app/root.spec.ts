// @vitest-environment happy-dom

import { getEmbedAuthToken } from "@agent-native/core/client/host";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  getEmbedAuthToken: vi.fn(() => null),
}));

import {
  computeSessionBypass,
  isBareContentPath,
  isDeckEditorPath,
} from "./root";

describe("session and content route policy", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.mocked(getEmbedAuthToken).mockReturnValue(null);
  });

  it("requires a session for the editor while skipping startup onboarding", () => {
    expect(isBareContentPath("/deck/abc123")).toBe(false);
    expect(isDeckEditorPath("/deck/abc123")).toBe(true);
    expect(computeSessionBypass("/deck/abc123")).toBe(false);
  });

  it("bypasses the session gate for a deck opened with a real embed token", () => {
    vi.mocked(getEmbedAuthToken).mockReturnValue("scoped-embed-token");

    expect(computeSessionBypass("/deck/abc123")).toBe(true);
    expect(computeSessionBypass("/settings/agent")).toBe(false);
  });

  it("does not bypass the session gate for embedded=1 without an embed token", () => {
    window.history.replaceState(null, "", "/deck/abc123?embedded=1");

    expect(computeSessionBypass("/deck/abc123")).toBe(false);
  });

  it("classifies the full-screen presentation route as shareable content", () => {
    expect(isBareContentPath("/deck/abc123/present/")).toBe(true);
    expect(isDeckEditorPath("/deck/abc123/present")).toBe(false);
    expect(isDeckEditorPath("/deck/abc123/present/")).toBe(false);
  });

  it("classifies the agent-embed slide preview as shareable content", () => {
    expect(isBareContentPath("/slide/")).toBe(true);
  });

  it("still classifies the existing bare prefixes as shareable content", () => {
    expect(isBareContentPath("/share/tok123")).toBe(true);
    expect(isBareContentPath("/p/abc123")).toBe(true);
  });

  it("does not classify app-management surfaces as shareable content", () => {
    expect(isBareContentPath("/")).toBe(false);
    expect(isBareContentPath("/settings/agent")).toBe(false);
    expect(isBareContentPath("/team")).toBe(false);
  });
});
