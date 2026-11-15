import { platformWaitUntil } from "@agent-native/core/server";
import {
  defineEventHandler,
  getRequestHeader,
  readRawBody,
  setResponseStatus,
} from "h3";

import { slackHuddleDeps } from "../../../lib/slack-huddle-oauth.js";
import { isSlackMessageEventPayload } from "../../../lib/slack-huddles.js";
import {
  fillMeetingsForHuddle,
  storeSlackHuddleEvent,
} from "../../../lib/slack-huddles-store.js";
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

  // User message events from "Connect Slack for
  // huddles" arrive here too. Huddle messages fill meeting participants;
  // every other message is acknowledged and dropped, never unfurled.
  // Only storing the huddle happens before the answer (one transaction, no
  // Slack calls), so Slack gets its acknowledgment well within 3 seconds; a
  // store failure answers 500 so Slack retries. The participant fill runs
  // after the response, and the slack-huddle-sweeper job retries it from the
  // stored huddle if it fails or is cut off.
  if (isSlackMessageEventPayload(payload)) {
    const deps = slackHuddleDeps();
    let huddle: Awaited<ReturnType<typeof storeSlackHuddleEvent>>;
    try {
      huddle = await storeSlackHuddleEvent(deps, payload);
    } catch (err) {
      console.error("[clips-slack] Failed to store Slack huddle:", err);
      setResponseStatus(event, 500);
      return { ok: false, error: "huddle event processing failed" };
    }
    if (huddle) {
      const fill = fillMeetingsForHuddle(deps, huddle).catch((err) => {
        console.error(
          "[clips-slack] Huddle participant fill failed; the sweep retries it:",
          err,
        );
      });
      platformWaitUntil(event.req)?.(fill);
    }
    return { ok: true };
  }

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
