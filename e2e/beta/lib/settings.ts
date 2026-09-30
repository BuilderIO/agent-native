import type { Locator, Page } from "@playwright/test";

/**
 * Settings routes and the Settings shell, as the beta suite sees them.
 */

/** The page ⌘, and the account menu open. */
export const SETTINGS_DEFAULT_PAGE = "profile";

/** A nested new route: the continuation must carry both segments. */
export const SETTINGS_NESTED_ROUTE = "/settings/integrations/builder";

export interface LegacySettingsLink {
  /** Today's link, as templates, OAuth callbacks, and emails send it. */
  from: string;
  /** The new page id it lands on. */
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
