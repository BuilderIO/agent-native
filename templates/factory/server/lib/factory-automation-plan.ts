export const PR_AUTOMATIONS = [
  "factory-pr-governance",
  "factory-pr-babysit",
] as const;

export function resolveEnabledAutomations(input: {
  observeSlack: boolean;
  slackChannelId?: string;
  observeGithub: boolean;
  repository?: string;
  observeSentry: boolean;
  sentryOrgSlug?: string;
  sentryProjectSlug?: string;
}): {
  enabledNames: Set<string>;
  pollingEnabled: boolean;
  githubPollingEnabled: boolean;
  sentryPollingEnabled: boolean;
  hasConfig: boolean;
} {
  const enabledNames = new Set<string>();
  let pollingEnabled = false;
  let githubPollingEnabled = false;
  let sentryPollingEnabled = false;
  let hasConfig = false;

  if (input.observeSlack) {
    if (!input.slackChannelId?.trim()) {
      throw new Error(
        "Configure a Slack channel before enabling Slack observation.",
      );
    }
    enabledNames.add("factory-slack-feedback");
    pollingEnabled = true;
    hasConfig = true;
  }

  if (input.observeGithub) {
    if (!input.repository?.trim()) {
      throw new Error(
        "Configure a GitHub repository before enabling GitHub observation.",
      );
    }
    enabledNames.add("factory-github-issues");
    githubPollingEnabled = true;
    hasConfig = true;
  }

  if (input.repository?.trim()) {
    for (const name of PR_AUTOMATIONS) enabledNames.add(name);
    hasConfig = true;
  }

  if (input.observeSentry) {
    if (!input.sentryOrgSlug?.trim() || !input.sentryProjectSlug?.trim()) {
      throw new Error(
        "Configure Sentry organization and project slugs before enabling Sentry observation.",
      );
    }
    enabledNames.add("factory-sentry-errors");
    sentryPollingEnabled = true;
    hasConfig = true;
  }

  return {
    enabledNames,
    pollingEnabled,
    githubPollingEnabled,
    sentryPollingEnabled,
    hasConfig,
  };
}

export function resolveEnabledAutomationsFromSavedConfig(config: {
  pollingEnabled: boolean | number;
  githubPollingEnabled: boolean | number;
  sentryPollingEnabled: boolean | number;
  slackChannelId?: string | null;
  repository?: string | null;
  sentryOrgSlug?: string | null;
  sentryProjectSlug?: string | null;
}): Set<string> {
  const enabledNames = new Set<string>();
  const pollingEnabled =
    config.pollingEnabled === true || config.pollingEnabled === 1;
  const githubPollingEnabled =
    config.githubPollingEnabled === true || config.githubPollingEnabled === 1;
  const sentryPollingEnabled =
    config.sentryPollingEnabled === true || config.sentryPollingEnabled === 1;

  if (pollingEnabled && config.slackChannelId?.trim()) {
    enabledNames.add("factory-slack-feedback");
  }
  if (githubPollingEnabled && config.repository?.trim()) {
    enabledNames.add("factory-github-issues");
  }
  if (config.repository?.trim()) {
    for (const name of PR_AUTOMATIONS) enabledNames.add(name);
  }
  if (
    sentryPollingEnabled &&
    config.sentryOrgSlug?.trim() &&
    config.sentryProjectSlug?.trim()
  ) {
    enabledNames.add("factory-sentry-errors");
  }
  return enabledNames;
}

export function isFactoryIdConflict(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown } | null)?.message ?? "",
  ).toLowerCase();
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return (
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    message.includes("unique constraint") ||
    message.includes("duplicate key") ||
    message.includes("primary key")
  );
}

export function isFactorySlackChannelConflict(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown } | null)?.message ?? "",
  ).toLowerCase();
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const unique =
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    message.includes("unique constraint") ||
    message.includes("duplicate key");
  return unique && message.includes("slack_channel");
}
