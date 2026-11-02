import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  isFusionPreviewRuntime,
  isHostedWorkspaceRuntime,
} from "./deployment-protection.js";

const MARKERS = [
  "FUSION_ENVIRONMENT",
  "FUSION_ENV_ORIGIN",
  "VITE_FUSION_ENV_ORIGIN",
] as const;

function clearRuntimeMarkers() {
  for (const marker of MARKERS) vi.stubEnv(marker, undefined);
  vi.stubEnv("AGENT_NATIVE_WORKSPACE", undefined);
  vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", undefined);
  vi.stubEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", undefined);
  vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON", undefined);
  resetAppConfigForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

describe("isFusionPreviewRuntime", () => {
  it("is false without any Fusion marker", () => {
    clearRuntimeMarkers();

    expect(isFusionPreviewRuntime()).toBe(false);
    expect(isHostedWorkspaceRuntime()).toBe(false);
  });

  it.each(MARKERS)("is true when Fusion sets %s", (marker) => {
    clearRuntimeMarkers();
    vi.stubEnv(
      marker,
      marker === "FUSION_ENVIRONMENT"
        ? "cloud-v2"
        : "https://preview.example.test",
    );

    expect(isFusionPreviewRuntime()).toBe(true);
    expect(isHostedWorkspaceRuntime()).toBe(true);
  });
});

describe("isHostedWorkspaceRuntime", () => {
  it("treats a mounted workspace as hosted without making it a Fusion preview", () => {
    clearRuntimeMarkers();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    resetAppConfigForTests();

    expect(isHostedWorkspaceRuntime()).toBe(true);
    expect(isFusionPreviewRuntime()).toBe(false);
  });

  it("treats a workspace app manifest as hosted", () => {
    clearRuntimeMarkers();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", '[{"id":"mail"}]');
    resetAppConfigForTests();

    expect(isHostedWorkspaceRuntime()).toBe(true);
    expect(isFusionPreviewRuntime()).toBe(false);
  });
});
