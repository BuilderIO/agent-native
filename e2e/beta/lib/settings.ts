import type { Locator, Page } from "@playwright/test";

/**
 * Settings routes and the redesigned Settings shell, as the beta suite sees
 * them.
 *
 * The redesign ships behind the `settings-redesign` feature flag until it is
 * cut over, so an authenticated check reads the flag for its own account and
 * holds the page to that state's contract: with the flag on, a legacy link is
 * rewritten to its new page; with it off, the legacy route still renders.
 * Reading the flag is never allowed to fall back to "off": an unreadable flag
 * would let every redesign assertion pass as "flag off, nothing to check".
 */

export const SETTINGS_REDESIGN_FLAG_KEY = "settings-redesign";

/** The page ⌘, and the account menu open. */
export const SETTINGS_DEFAULT_PAGE = "profile";

/** A nested new route: the continuation must carry both segments. */
export const SETTINGS_NESTED_ROUTE = "/settings/integrations/builder";

export interface LegacySettingsLink {
  /** Today's link, as templates, OAuth callbacks, and emails send it. */
  from: string;
  /** The new page id it lands on with the flag on. */
  page: string;
  sub?: string;
  /** Why this link is in the sample. */
  reason: string;
}

/**
 * Three legacy links from the redirect table
 * (packages/core/src/navigation/settings-redirects.ts), one per kind of
 * caller: the general tab every template links to, the resource path a
 * reported crash came through, and the team redirect route 14 templates keep.
 */
export const LEGACY_SETTINGS_REDIRECTS: readonly LegacySettingsLink[] = [
  {
    from: "/settings/general",
    page: "app",
    reason: "the General tab link every template and email uses",
  },
  {
    from: "/settings/agent/resources/instructions",
    page: "instructions",
    reason: "the nested resource path behind the reported Instructions crash",
  },
  {
    from: "/settings/team",
    page: "members",
    reason: "the /team redirect route 14 templates keep",
  },
];

export function newSettingsPath(
  link: Pick<LegacySettingsLink, "page" | "sub">,
) {
  return `/settings/${link.page}${link.sub ? `/${link.sub}` : ""}`;
}

/**
 * True when `pathname` is the new page's route. Workspace mounts prefix the
 * path (`/dispatch/settings/...`), so only the suffix is compared.
 */
export function landsOnSettingsPage(
  pathname: string,
  link: Pick<LegacySettingsLink, "page" | "sub">,
): boolean {
  const wanted = newSettingsPath(link);
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === wanted || trimmed.endsWith(wanted);
}

/** The nav item the shell marks current for `page`. */
export function activeSettingsNavItem(page: Page, id: string): Locator {
  return page.locator(
    `aside [data-settings-page="${id}"][aria-current="page"]`,
  );
}

/**
 * Whether `settings-redesign` is on for the signed-in account, read from the
 * app's own flag action on the page's origin.
 *
 * Throws when the flag cannot be read or is not registered: an unregistered
 * flag means the host predates the redesign, which is a fact to report, not a
 * reason to assert the flag-off contract.
 */
export async function readSettingsRedesignFlag(page: Page): Promise<boolean> {
  const result = await page.evaluate(async (key) => {
    const response = await fetch("/_agent-native/actions/get-feature-flags", {
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    return { status: response.status, text, key };
  }, SETTINGS_REDESIGN_FLAG_KEY);
  if (result.status !== 200) {
    throw new Error(
      `${page.url()} could not read feature flags (HTTP ${result.status}): ${result.text.slice(0, 200)}`,
    );
  }
  let flags: Record<string, unknown>;
  try {
    flags = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${page.url()} answered get-feature-flags with a non-JSON body: ${result.text.slice(0, 200)}`,
    );
  }
  const value = flags[SETTINGS_REDESIGN_FLAG_KEY];
  if (typeof value !== "boolean") {
    throw new Error(
      `${page.url()} does not register the ${SETTINGS_REDESIGN_FLAG_KEY} flag (got ${JSON.stringify(value)}), so this build predates the Settings redesign.`,
    );
  }
  return value;
}

/**
 * The organization label the account menu shows under the name: the active
 * organization's name, or null for a personal (no-org) account.
 */
export async function readActiveOrganizationName(
  page: Page,
): Promise<string | null> {
  const result = await page.evaluate(async () => {
    const response = await fetch("/_agent-native/org/me", {
      headers: { accept: "application/json" },
    });
    return { status: response.status, text: await response.text() };
  });
  if (result.status !== 200) {
    throw new Error(
      `${page.url()} could not read the active organization (HTTP ${result.status}): ${result.text.slice(0, 200)}`,
    );
  }
  const body = JSON.parse(result.text) as {
    orgId?: string | null;
    orgName?: string | null;
  };
  return body.orgId ? (body.orgName ?? null) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The account menu button. Its accessible name is "{name}, {organization}"
 * (plus ", Demo mode" while demo mode is on), so it is found by the
 * organization it must show rather than by a name this suite cannot know.
 */
export function accountMenuTrigger(
  page: Page,
  organizationLabel: string,
): Locator {
  return page
    .getByRole("button", {
      name: new RegExp(`, ${escapeRegExp(organizationLabel)}(?:, .+)?$`),
    })
    .first();
}
