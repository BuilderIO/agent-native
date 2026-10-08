import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "../localization/shared.js";
import {
  MCP_CONNECT_GUIDES,
  buildMcpInstallLink,
  derivedMcpServerBaseName,
  matchesMcpConnectHost,
  mcpConnectServerName,
  MCP_STATIC_TOKEN_FALLBACK,
  getMcpConnectGuides,
  getMcpStaticTokenFallback,
  resolveMcpConnectGuideId,
} from "./mcp-connect-content.js";

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[^}]+\}/g)].map(([match]) => match).sort();
}

describe("MCP connection copy", () => {
  it.each([
    ["Claude", "claude"],
    ["Claude Cowork", "codex"],
    ["Anthropic", "claude"],
    ["Claude Code", "claude-code"],
    ["ChatGPT", "chatgpt"],
    ["OpenAI", "chatgpt"],
    ["Codex", "codex"],
    ["OpenAI Codex", "codex"],
    ["Cursor", "cursor"],
    ["VS Code", "vscode"],
    ["Visual Studio Code", "vscode"],
    ["GitHub Copilot", "vscode"],
    ["Grok", "grok"],
    ["xAI", "grok"],
    ["Claude Code MCP", "claude-code"],
    ["unknown host", "other"],
  ])("routes the %s alias to %s", (query, guideId) => {
    expect(resolveMcpConnectGuideId(query)).toBe(guideId);
  });

  it.each([
    "Claude",
    "Cowork",
    "Anthropic",
    "ChatGPT",
    "OpenAI",
    "Codex",
    "Cursor",
    "VS Code",
    "Copilot",
    "Grok",
    "xAI",
    "MCP",
  ])("matches the %s external-host search", (query) => {
    expect(matchesMcpConnectHost(query)).toBe(true);
  });

  it.each(["a", "ai", "con", "m", "unknown host"])(
    "does not match the unrelated %s search",
    (query) => {
      expect(matchesMcpConnectHost(query)).toBe(false);
    },
  );

  it("localizes every shared guide and keeps template placeholders", () => {
    for (const locale of SUPPORTED_LOCALES.filter(
      (candidate) => candidate !== "en-US",
    )) {
      const guides = getMcpConnectGuides(locale);
      expect(guides, locale).toHaveLength(MCP_CONNECT_GUIDES.length);

      for (const [index, sourceGuide] of MCP_CONNECT_GUIDES.entries()) {
        const guide = guides[index];
        expect(guide?.id, locale).toBe(sourceGuide.id);

        sourceGuide.steps?.forEach((step, stepIndex) => {
          const translatedStep = guide?.steps?.[stepIndex];
          expect(
            translatedStep,
            `${locale}/${sourceGuide.id}/${stepIndex}`,
          ).not.toBe(step);
          expect(placeholders(translatedStep ?? "")).toEqual(
            placeholders(step),
          );
        });

        for (const field of ["intro", "note"] as const) {
          const source = sourceGuide[field];
          if (!source) continue;
          const translated = guide?.[field];
          expect(translated, `${locale}/${sourceGuide.id}/${field}`).not.toBe(
            source,
          );
          expect(placeholders(translated ?? "")).toEqual(placeholders(source));
        }

        if (sourceGuide.action) {
          expect(
            guide?.action?.label,
            `${locale}/${sourceGuide.id}/action`,
          ).not.toBe(sourceGuide.action.label);
        }

        sourceGuide.install?.forEach((option, optionIndex) => {
          const translated = guide?.install?.[optionIndex];
          expect(translated?.client).toBe(option.client);
          expect(
            translated?.label,
            `${locale}/${sourceGuide.id}/install/${option.client}`,
          ).not.toBe(option.label);
        });
      }

      const staticToken = getMcpStaticTokenFallback(locale);
      for (const field of [
        "title",
        "state",
        "resultTitle",
        "resultCopy",
      ] as const) {
        expect(staticToken[field], `${locale}/static/${field}`).not.toBe(
          MCP_STATIC_TOKEN_FALLBACK[field],
        );
      }
    }
  });
});

describe("MCP server names", () => {
  it.each([
    ["production", "agent-native-content"],
    ["beta", "agent-native-content-beta"],
    ["preview", "agent-native-content-preview"],
    ["local", "agent-native-content-local"],
  ] as const)("names the %s entry %s", (environment, expected) => {
    expect(mcpConnectServerName("agent-native-content", environment)).toBe(
      expected,
    );
  });

  it.each([
    "my server",
    "plan;curl example.com|sh",
    "$(id)",
    "-plan",
    "a".repeat(65),
  ])("refuses to publish %j, which the copyable commands would run", (name) => {
    expect(() => mcpConnectServerName(name, "production")).toThrow(
      /not a plain name/,
    );
  });

  it("refuses a name the environment suffix pushes past 64 characters", () => {
    expect(() => mcpConnectServerName("a".repeat(60), "beta")).toThrow(
      /not a plain name/,
    );
  });

  it.each([
    ["mail", "production", "agent-native-mail"],
    ["[::1]", "local", "agent-native-1"],
    ["@acme/notes", "production", "agent-native-acme-notes"],
    ["", "production", "agent-native-app"],
  ] as const)(
    "derives a publishable base name from %j",
    (label, environment, expected) => {
      expect(derivedMcpServerBaseName(label, environment)).toBe(expected);
      expect(() =>
        mcpConnectServerName(
          derivedMcpServerBaseName(label, environment),
          environment,
        ),
      ).not.toThrow();
    },
  );

  it("shortens a derived name so the environment suffix still fits", () => {
    const base = derivedMcpServerBaseName("a".repeat(63), "preview");
    const name = mcpConnectServerName(base, "preview");
    expect(name).toHaveLength(64);
    expect(name.endsWith("-preview")).toBe(true);
  });
});

describe("MCP install links", () => {
  const target = {
    serverName: "agent-native-content-beta",
    mcpUrl: "https://beta.content.agent-native.com/content/mcp",
  };

  function decodePayload(href: string): Record<string, unknown> {
    if (href.startsWith("https://cursor.com/")) {
      const url = new URL(href);
      expect([...url.searchParams.keys()].sort()).toEqual(["config", "name"]);
      return {
        name: url.searchParams.get("name"),
        ...JSON.parse(atob(url.searchParams.get("config") ?? "")),
      };
    }
    return JSON.parse(decodeURIComponent(href.slice(href.indexOf("?") + 1)));
  }

  it("sends Cursor to its install page with the entry as base64 JSON", () => {
    const link = buildMcpInstallLink("cursor", target);
    const url = new URL(link.href);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://cursor.com/install-mcp",
    );
    expect(JSON.parse(atob(url.searchParams.get("config") ?? ""))).toEqual({
      url: target.mcpUrl,
    });
    expect(link.opensWebPage).toBe(true);
  });

  it.each(["vscode", "vscode-insiders"] as const)(
    "opens %s through its documented scheme",
    (client) => {
      const link = buildMcpInstallLink(client, target);
      expect(link.href.startsWith(`${client}:mcp/install?`)).toBe(true);
      expect(decodePayload(link.href)).toEqual({
        name: target.serverName,
        type: "http",
        url: target.mcpUrl,
      });
      expect(link.opensWebPage).toBe(false);
    },
  );

  it("carries only the server name, transport and URL for every guide", () => {
    const widened = {
      ...target,
      headers: { Authorization: "Bearer secret-token" },
      token: "secret-token",
      ownerEmail: "person@example.com",
      documentId: "doc_secret",
    };
    const options = MCP_CONNECT_GUIDES.flatMap((guide) => guide.install ?? []);
    expect(options.map((option) => option.client).sort()).toEqual([
      "cursor",
      "vscode",
      "vscode-insiders",
    ]);
    for (const option of options) {
      const { href } = buildMcpInstallLink(option.client, widened);
      const { type, ...payload } = decodePayload(href);
      expect(payload).toEqual({ name: target.serverName, url: target.mcpUrl });
      expect(type === undefined || type === "http").toBe(true);
      expect(decodeURIComponent(href)).not.toMatch(
        /secret|person@example.com|doc_/,
      );
    }
  });
});
