import { describe, expect, it } from "vitest";

import {
  agentWebConfigFromPackageJson,
  deriveAgentWebPublicRoutes,
  normalizeAgentWebConfig,
  pathPatternMatches,
  resolveAgentWebCrawlerPolicy,
} from "./config.js";

describe("agent web config", () => {
  it("defaults discoverable public surfaces to no-training crawler policy", () => {
    const config = normalizeAgentWebConfig(undefined, {
      hasPublicRoutes: true,
    });

    expect(config).toMatchObject({
      discoverable: true,
      markdownTwins: true,
      llmsTxt: true,
      jsonLd: true,
      publicAgentCard: true,
      publicMcp: false,
      crawlerPolicy: "discoverable-no-training",
    });
    expect(resolveAgentWebCrawlerPolicy(config)).toEqual({
      training: "disallow",
      search: "allow",
      userTriggered: "allow",
      codingAgents: "allow",
      autonomousAgents: "allow",
    });
  });

  it("reads agentWeb from workspaceApp package config", () => {
    expect(
      agentWebConfigFromPackageJson({
        "agent-native": {
          workspaceApp: {
            agentWeb: {
              publicMcp: true,
              crawlers: { training: "allow" },
            },
          },
        },
      }),
    ).toEqual({
      publicMcp: true,
      crawlers: { training: "allow" },
    });
  });

  it("applies crawler preset overrides per category", () => {
    const config = normalizeAgentWebConfig({
      crawlerPolicy: "disallow-all",
      crawlers: { userTriggered: "allow" },
    });

    expect(resolveAgentWebCrawlerPolicy(config)).toMatchObject({
      training: "disallow",
      search: "disallow",
      userTriggered: "allow",
      codingAgents: "disallow",
      autonomousAgents: "disallow",
    });
  });

  it("derives public routes for internal apps from publicPaths only", () => {
    expect(
      deriveAgentWebPublicRoutes({
        audience: "internal",
        publicPaths: ["/", "/share/*"],
        routes: ["/", "/dashboard", "/share/abc", "/share/abc/edit"],
      }),
    ).toEqual(["/", "/share/abc", "/share/abc/edit"]);
  });

  it("derives public routes for public apps by excluding protected paths", () => {
    expect(
      deriveAgentWebPublicRoutes({
        audience: "public",
        protectedPaths: ["/admin/*", "/settings"],
        routes: ["/", "/docs", "/admin/users", "/settings"],
      }),
    ).toEqual(["/", "/docs"]);
  });

  it("falls back to root for public apps when no route tree is available", () => {
    expect(deriveAgentWebPublicRoutes({ audience: "public" })).toEqual(["/"]);
  });

  it("matches exact and wildcard path patterns", () => {
    expect(pathPatternMatches("/share/*", "/share/abc")).toBe(true);
    expect(pathPatternMatches("/share/*", "/share/abc/edit")).toBe(true);
    expect(pathPatternMatches("/share", "/share/abc")).toBe(false);
    expect(pathPatternMatches("/*", "/anything")).toBe(true);
  });
});
