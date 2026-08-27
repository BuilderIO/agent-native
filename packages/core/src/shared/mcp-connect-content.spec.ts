import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "../localization/shared.js";
import {
  MCP_CONNECT_GUIDES,
  MCP_STATIC_TOKEN_FALLBACK,
  getMcpConnectGuides,
  getMcpStaticTokenFallback,
} from "./mcp-connect-content.js";

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{[^}]+\}/g)].map(([match]) => match).sort();
}

describe("MCP connection copy", () => {
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
