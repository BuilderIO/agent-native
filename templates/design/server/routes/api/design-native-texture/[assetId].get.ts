import { getSession, runWithRequestContext } from "@agent-native/core/server";
import {
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import {
  DesignNativeTextureAssetError,
  readDesignNativeTextureAsset,
} from "../../../lib/design-native-texture-assets.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }
  const assetId = getRouterParam(event, "assetId") ?? "";
  try {
    const result = await runWithRequestContext(
      { userEmail: session.email, orgId: session.orgId },
      () =>
        readDesignNativeTextureAsset(
          `/api/design-native-texture/${assetId}`,
          1_000_000,
        ),
    );
    setResponseHeader(event, "Content-Type", result.mimeType);
    setResponseHeader(event, "Cache-Control", "private, no-store");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    return result.bytes;
  } catch (error) {
    if (!(error instanceof DesignNativeTextureAssetError)) throw error;
    setResponseStatus(
      event,
      error.code === "limit"
        ? 413
        : error.code === "invalid-reference"
          ? 400
          : error.code === "unavailable"
            ? 503
            : error.code === "unreadable"
              ? 503
              : 404,
    );
    return error.code === "unreadable"
      ? { error: error.message, errorCode: "native_texture_unreadable" }
      : { error: error.message };
  }
});
