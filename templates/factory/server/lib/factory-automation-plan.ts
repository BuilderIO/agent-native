export function resolveEnabledAutomations(input: {
  observeSlack: boolean;
  slackChannelId?: string;
  observeGithub: boolean;
  repository?: string;
  observeSentry: boolean;
  sentryOrgSlug?: string;
  sentryProjectSlug?: string;
}): {
  pollingEnabled: boolean;
  githubPollingEnabled: boolean;
  sentryPollingEnabled: boolean;
  hasConfig: boolean;
} {
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
    pollingEnabled = true;
    hasConfig = true;
  }

  if (input.observeGithub) {
    if (!input.repository?.trim()) {
      throw new Error(
        "Configure a GitHub repository before enabling GitHub observation.",
      );
    }
    githubPollingEnabled = true;
    hasConfig = true;
  }

  if (input.repository?.trim()) {
    hasConfig = true;
  }

  if (input.observeSentry) {
    if (!input.sentryOrgSlug?.trim() || !input.sentryProjectSlug?.trim()) {
      throw new Error(
        "Configure Sentry organization and project slugs before enabling Sentry observation.",
      );
    }
    sentryPollingEnabled = true;
    hasConfig = true;
  }

  return {
    pollingEnabled,
    githubPollingEnabled,
    sentryPollingEnabled,
    hasConfig,
  };
}

export function isFactoryIdConflict(error: unknown): boolean {
  const messageValue = (error as { message?: unknown } | null)?.message ?? "";
  const message = String(
    messageValue as string | number | boolean,
  ).toLowerCase();
  const codeValue = (error as { code?: unknown } | null)?.code ?? "";
  const code = String(codeValue as string | number | boolean);
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
  const messageValue = (error as { message?: unknown } | null)?.message ?? "";
  const message = String(
    messageValue as string | number | boolean,
  ).toLowerCase();
  const codeValue = (error as { code?: unknown } | null)?.code ?? "";
  const code = String(codeValue as string | number | boolean);
  const unique =
    code === "23505" ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    message.includes("unique constraint") ||
    message.includes("duplicate key");
  return unique && message.includes("slack_channel");
}
