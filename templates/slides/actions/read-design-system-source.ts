import { defineAction, fail } from "@agent-native/core/action";
import {
  readDesignSystemSource,
  readFigmaDesignSystemEvidence,
} from "@agent-native/core/server/design-system-authoring";
import { z } from "zod";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";
import { executeProviderApiRequest } from "../server/lib/provider-api.js";
import importFromUrl from "./import-from-url.js";

export default defineAction({
  description:
    "Read one staged website, Figma, or native uploaded file as untrusted reference evidence and persist its actual source status. Requires editor access. Upload acceptance is not interpretation; failures retain the source with needs-attention. Website extraction is SSRF-safe, Figma uses the connected account, files require an owner/org-bound upload.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID"),
    sourceId: z.string().min(1).describe("Persisted staged source ID"),
  }),
  run: (args) =>
    readDesignSystemSource(args, designSystemAuthoring, {
      async website(url) {
        const result = await importFromUrl.run({ url });
        if (result.status === "failed")
          fail(result.error ?? "The website could not be read.", {
            errorCode: "design_system_website_failed",
            statusCode: 422,
          });
        const tokens = result.designTokens;
        if (
          !tokens ||
          (!tokens.colors.length &&
            !tokens.typography.length &&
            !Object.keys(tokens.cssVariables).length)
        )
          fail("The website returned no usable visual evidence.", {
            errorCode: "design_system_source_empty",
            statusCode: 422,
          });
        const evidence = JSON.stringify({
          url: result.finalUrl ?? url,
          designTokens: tokens,
          designMd: result.designMd,
          rendered: result.rendered,
          method: result.method,
          warnings: result.warnings,
        });
        return {
          evidence: evidence.slice(0, 24000),
          warnings: [
            ...result.warnings,
            ...(evidence.length > 24000
              ? ["Website evidence truncated to 24,000 characters."]
              : []),
          ],
        };
      },
      figma: (url) =>
        readFigmaDesignSystemEvidence(url, executeProviderApiRequest),
    }),
});
