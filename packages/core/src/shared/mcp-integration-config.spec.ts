import { describe, expect, it } from "vitest";

import { normalizeMcpIntegrationsConfig } from "./mcp-integration-config.js";

describe("normalizeMcpIntegrationsConfig", () => {
  it("enables default presets and custom servers by default", () => {
    expect(normalizeMcpIntegrationsConfig()).toEqual({
      enabled: true,
      custom: true,
      defaults: { enabled: true, exclude: [] },
    });
  });

  it("can hide the entire MCP integration entry", () => {
    expect(normalizeMcpIntegrationsConfig(false)).toEqual({
      enabled: false,
      custom: false,
      defaults: { enabled: false, exclude: [] },
    });
  });

  it("can hide all default presets while keeping custom servers", () => {
    expect(normalizeMcpIntegrationsConfig({ defaults: false })).toEqual({
      enabled: true,
      custom: true,
      defaults: { enabled: false, exclude: [] },
    });
  });

  it("normalizes include and exclude ids", () => {
    expect(
      normalizeMcpIntegrationsConfig({
        defaults: {
          include: [" Context7 ", "context7", "SENTRY"],
          exclude: [" Stripe ", ""],
        },
      }),
    ).toEqual({
      enabled: true,
      custom: true,
      defaults: {
        enabled: true,
        include: ["context7", "sentry"],
        exclude: ["stripe"],
      },
    });
  });

  it("preserves already-normalized disabled flags", () => {
    expect(
      normalizeMcpIntegrationsConfig({
        enabled: true,
        custom: true,
        defaults: { enabled: false, exclude: [] },
      }),
    ).toEqual({
      enabled: true,
      custom: true,
      defaults: { enabled: false, exclude: [] },
    });
  });
});
