type ReadOnlyTarget = {
  app: string;
  steps?: readonly object[];
  verify?: readonly object[];
  cleanup?: readonly object[];
};

const authPaths = new Set([
  "/_agent-native/auth/magic-link",
  "/_agent-native/auth/ba/sign-in/magic-link",
  "/_agent-native/auth/email-link/landing",
]);

export function allowsReadOnlyQaRequest(
  method: string,
  url: string,
  navigation: boolean,
  origin: string,
  app: string,
  signingIn: boolean,
): boolean {
  const request = new URL(url);
  if (navigation && request.origin !== origin) return false;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return true;
  if (method !== "POST" || !signingIn || request.origin !== origin)
    return false;
  const prefix = "/" + app + "/";
  const path = request.pathname.startsWith(prefix)
    ? request.pathname.slice(prefix.length - 1)
    : request.pathname;
  return authPaths.has(path);
}

export function assertReadOnlyQaTarget(
  target: ReadOnlyTarget,
  emailLinkMode: boolean,
): void {
  if (!emailLinkMode || target.cleanup?.length) {
    throw new Error(
      "Read-only QA requires email-link authentication and no cleanup actions",
    );
  }

  for (const step of [...(target.steps ?? []), ...(target.verify ?? [])]) {
    if ("freshSignIn" in step || "ifVisible" in step) {
      throw new Error(
        "Read-only QA uses one verified sign-in and explicit steps",
      );
    }
    if (
      "action" in step &&
      (!("method" in step) ||
        step.method !== "GET" ||
        typeof step.action !== "string" ||
        !/^[a-z0-9-]+$/.test(step.action))
    ) {
      throw new Error("Read-only QA actions must be explicit GET actions");
    }
  }
}
