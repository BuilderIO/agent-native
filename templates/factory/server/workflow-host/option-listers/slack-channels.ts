import { z } from "zod";

import { expectJson, rateLimited, unreadableList } from "./provider-http.js";
import {
  OPTION_PAGE_SIZE,
  OptionListError,
  type OptionLister,
  type ProviderOption,
  type ProviderOptionTag,
} from "./types.js";

const channelListSchema = z.object({
  ok: z.literal(true),
  channels: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      is_private: z.boolean().optional(),
      is_member: z.boolean().optional(),
    }),
  ),
  response_metadata: z
    .object({ next_cursor: z.string().optional() })
    .optional(),
});

// Slack's own short error words; anything else is not echoed.
const ERROR_WORD = /^[a-z][a-z0-9_]{0,47}$/;
const SCOPE_WORDS = /^[a-z][a-z0-9:,._-]{0,127}$/;
const REFUSED_WORDS = new Set([
  "invalid_auth",
  "not_authed",
  "account_inactive",
  "token_revoked",
  "token_expired",
  "no_permission",
]);

/** A 200 whose body says Slack did not list: its `ok: false` with an error word. */
function slackFailure(json: unknown): OptionListError | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const body = json as { ok?: unknown; error?: unknown; needed?: unknown };
  if (body.ok !== false) return undefined;
  const word =
    typeof body.error === "string" && ERROR_WORD.test(body.error)
      ? body.error
      : "provider_error";
  if (word === "ratelimited") return rateLimited("slack");
  if (word === "missing_scope") {
    const scope =
      typeof body.needed === "string" && SCOPE_WORDS.test(body.needed)
        ? body.needed
        : undefined;
    return new OptionListError(
      "credential_missing",
      "slack",
      `The Slack connection lacks a permission the channel list needs${scope ? ` (${scope})` : ""}.`,
      { reason: "missing_scope", ...(scope ? { scope } : {}) },
    );
  }
  if (REFUSED_WORDS.has(word)) {
    return new OptionListError(
      "credential_missing",
      "slack",
      `Slack refused the connected credential (${word}).`,
      { reason: "refused" },
    );
  }
  return new OptionListError(
    "provider_unreadable",
    "slack",
    `Slack rejected the channel list (${word}).`,
  );
}

/**
 * Public and private channels the bot can see. `is_member` is Slack's word
 * for whether the bot is in a channel; only an explicit `false` is marked,
 * since a missing field says nothing.
 */
export const slackChannels: OptionLister = {
  provider: "slack",
  resource: "channels",
  async list(http, { cursor }) {
    const response = await http({
      path: "/conversations.list",
      query: {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: String(OPTION_PAGE_SIZE),
        ...(cursor ? { cursor } : {}),
      },
    });
    const parsed = channelListSchema.safeParse(
      expectJson("slack", response, slackFailure),
    );
    if (!parsed.success) throw unreadableList("slack", "a channel list");
    const options: ProviderOption[] = parsed.data.channels.map((channel) => {
      const tags: ProviderOptionTag[] = [];
      if (channel.is_private) tags.push("private");
      if (channel.is_member === false) tags.push("bot_not_member");
      return {
        value: channel.id,
        label: `#${channel.name}`,
        hint: channel.id,
        ...(tags.length > 0 ? { tags } : {}),
      };
    });
    options.sort((a, b) => a.label.localeCompare(b.label));
    const next = parsed.data.response_metadata?.next_cursor;
    return { options, ...(next ? { nextCursor: next } : {}) };
  },
};
