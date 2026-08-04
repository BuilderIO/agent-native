const FIRST_PARTY_DISPATCH_ORIGIN = "https://dispatch.agent-native.com";

type PublicOriginEnv = Partial<
  Pick<NodeJS.ProcessEnv, "APP_URL" | "BETTER_AUTH_URL" | "CONTEXT" | "URL">
>;

export function isFirstPartyHostedDispatch(
  env: PublicOriginEnv = process.env,
): boolean {
  if (env.CONTEXT?.trim() !== "production") return false;

  const configuredOrigin = [env.APP_URL, env.BETTER_AUTH_URL, env.URL].find(
    (value) => value?.trim(),
  );

  if (!configuredOrigin) return false;

  try {
    return new URL(configuredOrigin).origin === FIRST_PARTY_DISPATCH_ORIGIN;
  } catch {
    return false;
  }
}
