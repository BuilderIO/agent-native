export const SLACK_CHANNEL_CONFIG_KEYS = [
  "channelIds",
  "channels",
  "allowedChannels",
  "allowlistedChannels",
  "allowList",
] as const;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function hasSlackChannelPatch(config: Record<string, unknown>) {
  const nested = objectValue(config.slack);
  return SLACK_CHANNEL_CONFIG_KEYS.some(
    (key) =>
      Object.prototype.hasOwnProperty.call(config, key) ||
      Object.prototype.hasOwnProperty.call(nested, key),
  );
}

export function slackChannelRefsFromConfig(config: Record<string, unknown>) {
  const nested = objectValue(config.slack);
  const values: string[] = [];
  for (const itemConfig of [config, nested]) {
    for (const key of SLACK_CHANNEL_CONFIG_KEYS) {
      const value = itemConfig[key];
      if (typeof value === "string") values.push(...value.split(","));
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") values.push(item);
        }
      }
    }
  }
  return Array.from(
    new Set(
      values.map((value) => value.trim().replace(/^#/, "")).filter(Boolean),
    ),
  );
}

export function normalizeSlackChannelConfig(
  merged: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  if (!hasSlackChannelPatch(patch)) return merged;
  const normalized = { ...merged };
  const nested = objectValue(normalized.slack);
  for (const key of SLACK_CHANNEL_CONFIG_KEYS) {
    delete normalized[key];
    delete nested[key];
  }
  normalized.channelIds = slackChannelRefsFromConfig(patch);
  if (Object.keys(nested).length) normalized.slack = nested;
  else delete normalized.slack;
  return normalized;
}
