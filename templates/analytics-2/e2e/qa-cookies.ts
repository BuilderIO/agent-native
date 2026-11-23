import type { BrowserContext } from "@playwright/test";
import { z } from "zod";

const partitionKeySchema = z
  .object({
    topLevelSite: z.string().url(),
    hasCrossSiteAncestor: z.boolean(),
  })
  .strict();

const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string().min(1),
  expires: z.number().finite(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  partitionKey: partitionKeySchema.optional(),
  partitionKeyOpaque: z.literal(false).optional(),
});

type PlaywrightCookie = Parameters<BrowserContext["addCookies"]>[0][number] & {
  _crHasCrossSiteAncestor?: boolean;
};

export function playwrightCookiesFromCdp(
  value: unknown,
  sourceUrl: string,
): PlaywrightCookie[] {
  const source = new URL(sourceUrl);
  return z
    .array(z.object({ domain: z.string(), path: z.string() }).passthrough())
    .parse(value)
    .filter((cookie) => {
      const domain = cookie.domain.replace(/^\./, "");
      const domainMatches =
        source.hostname === domain || source.hostname.endsWith(`.${domain}`);
      const pathMatches =
        source.pathname === cookie.path ||
        source.pathname.startsWith(
          cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`,
        );
      return domainMatches && pathMatches;
    })
    .map((cookie) => cookieSchema.parse(cookie))
    .map(
      ({ partitionKey, partitionKeyOpaque: _opaque, sameSite, ...cookie }) => ({
        ...cookie,
        ...(sameSite === undefined ? {} : { sameSite }),
        ...(partitionKey === undefined
          ? {}
          : {
              partitionKey: partitionKey.topLevelSite,
              // Chromium otherwise defaults a missing ancestor bit to true.
              _crHasCrossSiteAncestor: partitionKey.hasCrossSiteAncestor,
            }),
      }),
    );
}
