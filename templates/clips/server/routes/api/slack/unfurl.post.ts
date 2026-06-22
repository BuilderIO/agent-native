import {
  defineEventHandler,
  getRequestHeader,
  readRawBody,
  setResponseStatus,
} from "h3";
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

  const allowlist = validateSlackEventAllowlist(
    payload as SlackLinkSharedPayload,
  );
  if (!allowlist.ok) {
    setResponseStatus(event, allowlist.status);
    return { ok: false, error: allowlist.error };
  }

  const token = process.env.SLACK_BOT_TOKEN; // guard:allow-env-credential - deploy-level Slack Events API app token for signed unfurl webhooks
  if (!token) {
    console.warn("[clips-slack] SLACK_BOT_TOKEN is not configured");
    return { ok: true };
  }

  try {
    await handleSlackLinkSharedPayload(
      payload as SlackLinkSharedPayload,
      token,
    );
  } catch (err) {
    console.error("[clips-slack] Failed to unfurl Clips link:", err);
  }

  return { ok: true };
});
