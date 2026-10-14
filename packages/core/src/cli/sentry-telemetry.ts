import {
  loadOptionalPeer,
  OptionalPeerDependencyError,
} from "../shared/optional-peer.js";

type SentryModule = typeof import("@sentry/node");
export type SentryCaptureContext = Parameters<
  SentryModule["captureException"]
>[1];

let sentryPromise: Promise<SentryModule | undefined> | undefined;
let reporting = Promise.resolve();
let diagnosticPrinted = false;
let cliVersion = "unknown";

export function setCliSentryVersion(version: string): void {
  cliVersion = version;
}

function buildRedactedCommandTag(argv: string[]): string {
  const secretFlag = /^--?(token|key|secret|password|api[_-]?key)$/i;
  const secretFlagWithValue =
    /^(--?(token|key|secret|password|api[_-]?key))=(.*)$/i;
  const output: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (secretFlag.test(argument)) {
      output.push(argument);
      if (index + 1 < argv.length) {
        output.push("<redacted>");
        index++;
      }
      continue;
    }
    const match = argument.match(secretFlagWithValue);
    output.push(match ? `${match[1]}=<redacted>` : argument);
  }
  return output.join(" ");
}

type ErrorOutput = Pick<NodeJS.WriteStream, "write">;

function reportUnavailable(error: unknown, stderr: ErrorOutput): void {
  if (diagnosticPrinted) return;
  diagnosticPrinted = true;
  const message =
    error instanceof OptionalPeerDependencyError
      ? error.message
      : `CLI error reporting is unavailable: ${error instanceof Error ? error.message : String(error)}`;
  stderr.write(`${message}\n`);
}

function loadSentry(stderr: ErrorOutput): Promise<SentryModule | undefined> {
  if (!sentryPromise) {
    sentryPromise = loadOptionalPeer(
      "@sentry/node",
      () => import("@sentry/node"),
    )
      .then((sentry) => {
        sentry.init({
          dsn: "https://0d384e9eff2f6542af468b92769f2f5b@o117565.ingest.us.sentry.io/4511270386466816",
          release: `agent-native-cli@${cliVersion}`,
          integrations: (integrations) =>
            integrations.filter((integration) => integration.name !== "Http"),
          sendDefaultPii: false,
          beforeSend(event) {
            const exceptionType = event.exception?.values?.[0]?.type;
            if (
              exceptionType === "ValidationError" ||
              event.tags?.handled === "validation"
            ) {
              return null;
            }

            if (event.request) {
              if (event.request.headers) {
                const headers = event.request.headers as Record<string, string>;
                for (const key of Object.keys(headers)) {
                  const lowerKey = key.toLowerCase();
                  if (
                    lowerKey === "cookie" ||
                    lowerKey === "authorization" ||
                    lowerKey === "set-cookie" ||
                    lowerKey === "proxy-authorization"
                  ) {
                    delete headers[key];
                  }
                }
              }
              delete (event.request as Record<string, unknown>).cookies;
            }
            if (event.user) {
              const user = event.user as Record<string, unknown>;
              delete user.ip_address;
              const hasIdentity =
                typeof user.id === "string" ||
                typeof user.email === "string" ||
                typeof user.username === "string";
              if (!hasIdentity) delete event.user;
            }
            if (event.contexts && typeof event.contexts === "object") {
              delete (event.contexts as Record<string, unknown>).runtime_env;
            }

            event.tags = {
              ...event.tags,
              command: buildRedactedCommandTag(process.argv.slice(2)),
              subcommand: process.argv[2] ?? "none",
              nodeVersion: process.version,
              platform: process.platform,
            };
            return event;
          },
        });

        const builderUserId = process.env.BUILDER_USER_ID;
        const builderPublicKey = process.env.BUILDER_PUBLIC_KEY;
        if (builderUserId) {
          sentry.setUser({ id: builderUserId });
          sentry.setTag("builderUserId", builderUserId);
        }
        if (builderPublicKey) sentry.setTag("spaceId", builderPublicKey);
        return sentry;
      })
      .catch((error: unknown) => {
        reportUnavailable(error, stderr);
        return undefined;
      });
  }
  return sentryPromise;
}

export function captureSentryException(
  error: unknown,
  context?: SentryCaptureContext,
  stderr: ErrorOutput = process.stderr,
): Promise<void> {
  reporting = reporting
    .then(async () => {
      const sentry = await loadSentry(stderr);
      sentry?.captureException(error, context);
    })
    .catch((reportingError: unknown) =>
      reportUnavailable(reportingError, stderr),
    );
  return reporting;
}

export async function flushSentryTelemetry(
  timeout = 2000,
  stderr: ErrorOutput = process.stderr,
): Promise<void> {
  await reporting;
  if (!sentryPromise) return;
  const sentry = await sentryPromise;
  if (!sentry) return;
  try {
    await sentry.flush(timeout);
  } catch (error) {
    reportUnavailable(error, stderr);
  }
}
