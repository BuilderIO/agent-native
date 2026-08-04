/**
 * Reads each mounted app's transactional email catalog from the browser.
 *
 * Workspace apps are path-mounted on a single origin, so the browser can call
 * another app's action endpoint directly and its own session cookie carries the
 * caller's identity. Fanning out here rather than server-side keeps every app's
 * existing access checks in force — Dispatch never sees a catalog the signed-in
 * user could not have loaded themselves.
 */

export interface AppTransactionalEmail {
  id: string;
  app: string;
  name: string;
  trigger: string;
  recipient: string;
  sender: string;
  /** null when the send log could not be read — not the same as zero sends. */
  sent: number | null;
  failed: number | null;
  lastSentAt: number | null;
}

export interface AppEmailCatalog {
  appId: string;
  appName: string;
  appPath: string;
  emails: AppTransactionalEmail[];
  /** Set when this app's catalog could not be read at all. */
  error: string | null;
  /** Set when the catalog loaded but its send counts did not. */
  statsError: string | null;
}

function actionUrl(appPath: string, action: string, query = ""): string {
  const base = appPath.replace(/\/$/, "");
  return `${base}/_agent-native/actions/${action}${query}`;
}

/**
 * Load one app's catalog. Never throws — a single unreachable app must not
 * blank the whole screen, but its failure is returned rather than swallowed so
 * the UI can say "couldn't read" instead of showing it as having no emails.
 */
export async function fetchAppEmailCatalog(
  app: { id: string; name: string; path: string },
  windowDays: number,
): Promise<AppEmailCatalog> {
  const base: AppEmailCatalog = {
    appId: app.id,
    appName: app.name,
    appPath: app.path,
    emails: [],
    error: null,
    statsError: null,
  };
  try {
    const res = await fetch(
      actionUrl(
        app.path,
        "list-transactional-emails",
        `?windowDays=${windowDays}`,
      ),
      { credentials: "include", headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return { ...base, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      emails?: AppTransactionalEmail[];
      statsAvailable?: boolean;
      statsError?: string | null;
    };
    return {
      ...base,
      emails: body.emails ?? [],
      statsError: body.statsAvailable === false ? (body.statsError ?? "unknown") : null,
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface EmailPreview {
  subject: string;
  html: string;
  text: string;
}

/** Render one email's preview with dummy data, from the owning app. */
export async function fetchEmailPreview(
  appPath: string,
  id: string,
): Promise<EmailPreview> {
  const res = await fetch(
    actionUrl(
      appPath,
      "render-transactional-email-preview",
      `?id=${encodeURIComponent(id)}`,
    ),
    { credentials: "include", headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`Preview failed: HTTP ${res.status}`);
  }
  return (await res.json()) as EmailPreview;
}
