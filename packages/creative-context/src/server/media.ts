import {
  getH3App,
  getSession,
  runWithRequestContext,
  type NitroPluginDef,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";

import {
  parsePrivateBlobHandle,
  readPrivateArtifact,
} from "../connectors/private-artifacts.js";
import { CREATIVE_CONTEXT_MEDIA_ROUTE } from "../media-url.js";
import {
  getCreativeContextItem,
  readPendingCreativeContextMedia,
} from "../store/index.js";
import { getCreativeContext } from "./context.js";

const SAFE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
]);

export function createCreativeContextMediaPlugin(): NitroPluginDef {
  return async (nitroApp: object) => {
    getH3App(nitroApp).use(CREATIVE_CONTEXT_MEDIA_ROUTE, async (event: any) => {
      if (event?.req?.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      const session = await getSession(event).catch(() => null);
      const userEmail = session?.email?.trim().toLowerCase();
      if (!userEmail) {
        return new Response("Authentication required", { status: 401 });
      }
      const orgId = session?.orgId;
      const url = new URL(
        event.req.url,
        event.req.headers?.get?.("origin") ?? "http://localhost",
      );
      const mediaId = url.searchParams.get("mediaId");
      let loaded: Awaited<ReturnType<typeof readCreativeContextMedia>> | null;
      try {
        loaded = await runWithRequestContext({ userEmail, orgId }, () =>
          readCreativeContextMedia({
            mediaId: mediaId ?? undefined,
            itemId: url.searchParams.get("itemId") ?? undefined,
            itemVersionId: url.searchParams.get("itemVersionId") ?? undefined,
          }),
        );
      } catch {
        loaded = null;
      }
      if (!loaded) return new Response("Not found", { status: 404 });
      const { data, mimeType } = loaded;
      if (!SAFE_MIME_TYPES.has(mimeType)) {
        return new Response("Unsupported media type", { status: 415 });
      }
      const body = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      return new Response(body, {
        headers: {
          "Cache-Control": "private, max-age=300",
          "Content-Type": mimeType,
          "Content-Security-Policy":
            "sandbox; default-src 'none'; style-src 'unsafe-inline'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
  };
}

export async function readCreativeContextMedia(input: {
  mediaId?: string;
  itemId?: string;
  itemVersionId?: string;
}) {
  let itemId = input.itemId;
  let itemVersionId = input.itemVersionId;
  if (input.mediaId) {
    const { getDb, schema } = getCreativeContext();
    const rows = await getDb()
      .select({
        itemId: schema.contextMedia.itemId,
        itemVersionId: schema.contextMedia.itemVersionId,
      })
      .from(schema.contextMedia)
      .where(eq(schema.contextMedia.id, input.mediaId))
      .limit(1);
    itemId = rows[0]?.itemId;
    itemVersionId = rows[0]?.itemVersionId;
  }
  if (!itemId) throw new Error("Creative context media was not found");
  const detail = await getCreativeContextItem(itemId, itemVersionId);
  const pending = detail
    ? null
    : await readPendingCreativeContextMedia({
        mediaId: input.mediaId,
        itemId,
        itemVersionId,
      });
  if (!detail && !pending)
    throw new Error("Creative context media is not accessible");
  const media =
    detail && input.mediaId
      ? (detail.media.find((entry) => entry.id === input.mediaId) ?? null)
      : null;
  const storageKey = detail
    ? (media?.storageKey ?? detail.item.thumbnailBlobRef)
    : pending?.storageKey;
  const handle = parsePrivateBlobHandle(storageKey);
  if (!handle) throw new Error("Creative context media has no private blob");
  return {
    data: await readPrivateArtifact(
      handle,
      getCreativeContext().connectorContext,
    ),
    mimeType:
      media?.mimeType ??
      (detail ? detail.version.mimeType : pending?.mimeType) ??
      handle.mimeType ??
      "application/octet-stream",
    itemId: detail?.item.id ?? pending!.itemId,
    itemVersionId: detail?.version.id ?? pending!.itemVersionId,
    mediaId: media?.id ?? pending?.mediaId ?? null,
    media,
  };
}
