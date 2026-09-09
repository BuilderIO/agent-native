import {
  defineEventHandler,
  getRequestHeader,
  readRawBody,
  setResponseStatus,
} from "h3";

import { readSlackBotTokenForPayload } from "../../../lib/slack-oauth.js";
import {
  handleSlackLinkSharedPayload,
  parseSlackJsonPayload,
  slackUrlVerificationChallenge,
  validateSlackEventAllowlist,
  verifySlackSignature,
  type SlackLinkSharedPayload,
} from "../../../lib/slack-unfurls.js";

export default defineEventHandler(async (event) => {
  const rawBody = (await readRawBody(event)) ?? "";
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const signature = getRequestHeader(event, "x-slack-signature");
  const timestamp = getRequestHeader(event, "x-slack-request-timestamp");

  if (
    !verifySlackSignature({
      rawBody,
      timestamp,
      signature,
      signingSecret,
    })
  ) {
    setResponseStatus(event, signingSecret ? 401 : 503);
    return {
      ok: false,
      error: signingSecret
        ? "invalid Slack signature"
        : "Slack signing secret is not configured",
    };
  }

  const payload = parseSlackJsonPayload(rawBody);
  const challenge = slackUrlVerificationChallenge(payload);
  if (challenge) return challenge;

  const slackPayload = payload as SlackLinkSharedPayload;
  let token = await readSlackBotTokenForPayload(slackPayload);

  if (!token) {
    const allowlist = validateSlackEventAllowlist(slackPayload);
    if (!allowlist.ok) {
      setResponseStatus(event, allowlist.status);
      return { ok: false, error: allowlist.error };
    }

    token = process.env.SLACK_BOT_TOKEN ?? null; // guard:allow-env-credential - legacy single-workspace Slack app token; OAuth-installed teams resolve encrypted app_secrets first
    if (!token) {
      console.warn("[clips-slack] No Slack bot token found for event");
      return { ok: true };
    }
  }

  try {
    await handleSlackLinkSharedPayload(slackPayload, token);
  } catch (err) {
    console.error("[clips-slack] Failed to unfurl Clips link:", err);
  }

  return { ok: true };
});
