import type { ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { clipsLinkOrigins } from "../server/lib/clips-peer.js";
import { isClipRecordingId } from "../shared/clip-embed-block.js";
import type { ContentClipStorage } from "../shared/clips-peer-contract.js";

const count = z.number().int().nonnegative();

export const clipStorageSchema: z.ZodType<ContentClipStorage> =
  z.discriminatedUnion("state", [
    z.object({
      state: z.literal("ready"),
      provider: z.enum(["builder", "custom", "local"]),
    }),
    z.object({
      state: z.literal("free"),
      remaining: count,
      limit: count,
      maxClipBytes: z.number().int().positive(),
    }),
    z.object({ state: z.literal("used_up"), limit: count }),
    z.object({ state: z.literal("none"), reason: z.string().max(100) }),
    z.object({ state: z.literal("account_required") }),
  ]);

/**
 * The uploader's address as Content's edge saw it. Clips caps free clips per
 * network, and from Clips every upload would otherwise come from Content.
 */
export function uploaderIp(ctx: ActionRunContext | undefined): string | null {
  const ip = ctx?.requestHeaders?.get("x-nf-client-connection-ip")?.trim();
  return ip && ip.length <= 64 && !/[\s\p{Cc}]/u.test(ip) ? ip : null;
}

/**
 * Whether a chunk URL Clips sent names this recording's upload on one of
 * Clips' own lanes. The browser posts the file there, so it may never point
 * anywhere else.
 */
export function isClipChunkUrl(value: string, recordingId: string): boolean {
  if (!URL.canParse(value) || !isClipRecordingId(recordingId)) return false;
  const url = new URL(value);
  return (
    clipsLinkOrigins().some(
      (origin) => new URL(origin).origin === url.origin,
    ) &&
    url.pathname.endsWith(
      `/api/uploads/${encodeURIComponent(recordingId)}/content-chunk`,
    ) &&
    url.searchParams.has("ticket") &&
    !url.username &&
    !url.password
  );
}
