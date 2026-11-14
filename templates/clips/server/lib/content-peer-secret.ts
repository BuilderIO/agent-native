import { createHmac } from "node:crypto";

import { getGlobalA2ASecret } from "@agent-native/core/a2a";
import { AppConfigurationError } from "@agent-native/core/app-config";
import {
  getAppConfig,
  resolveContentClipsPeerSecret,
} from "@agent-native/core/server";

import { CONTENT_CLIP_NOT_CONFIGURED } from "../../shared/content-clip-contract.js";

/** What a Content route or Content media URL answers without a usable secret. */
export const CONTENT_CLIPS_NOT_CONFIGURED = {
  status: 503,
  body: {
    error: "Clips is not set up to accept requests from Content",
    code: CONTENT_CLIP_NOT_CONFIGURED,
  },
};

export type ContentPeerSecret =
  | { secret: string; refused?: never }
  | { secret?: never; refused: typeof CONTENT_CLIPS_NOT_CONFIGURED };

/**
 * The secret only Content and Clips hold. Content's requests, and the media
 * grants Clips hands back for them, are checked against it alone: a
 * deployment or workspace A2A secret is held by other apps too, so anything
 * signed with one could claim to come from Content.
 */
export function readContentPeerSecret(): ContentPeerSecret {
  try {
    const secret = resolveContentClipsPeerSecret(
      getAppConfig().clips,
      getGlobalA2ASecret(),
    );
    return secret ? { secret } : { refused: CONTENT_CLIPS_NOT_CONFIGURED };
  } catch (error) {
    if (!(error instanceof AppConfigurationError)) throw error;
    console.error(
      "[content-clips] peer secret configuration is invalid",
      error,
    );
    return { refused: CONTENT_CLIPS_NOT_CONFIGURED };
  }
}

/**
 * The key media grants are signed with. It is derived from the peer secret
 * rather than being it, so the two kinds of token never share a key.
 */
export function contentPlaybackGrantKey(secret: string): string {
  return createHmac("sha256", secret)
    .update("agent-native:content-clips:playback-grant:v1")
    .digest("hex");
}
