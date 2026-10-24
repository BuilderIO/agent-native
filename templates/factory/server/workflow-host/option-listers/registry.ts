import { githubRepositories } from "./github-repositories.js";
import { sentryOrganizations } from "./sentry-organizations.js";
import { sentryProjects } from "./sentry-projects.js";
import { slackChannels } from "./slack-channels.js";
import type {
  OptionLister,
  OptionPage,
  ProviderHttp,
  ProviderOption,
} from "./types.js";

/** One module per resource; a provider joins the pickers by adding its lister here. */
export const OPTION_LISTERS: readonly OptionLister[] = [
  slackChannels,
  sentryOrganizations,
  sentryProjects,
  githubRepositories,
];

export function findOptionLister(
  provider: string,
  resource: string,
): OptionLister | undefined {
  return OPTION_LISTERS.find(
    (lister) => lister.provider === provider && lister.resource === resource,
  );
}

export function describeOptionListers(): string[] {
  return OPTION_LISTERS.map(
    (lister) => `${lister.provider}/${lister.resource}`,
  );
}

/** A search reads at most this many provider pages in one call. */
const MAX_SEARCH_PAGES = 5;
/** A search stops at the end of the page where it has found this many. */
const ENOUGH_MATCHES = 25;

function matches(option: ProviderOption, search: string): boolean {
  return [option.label, option.value, option.hint].some((text) =>
    text?.toLowerCase().includes(search),
  );
}

/**
 * One page, or with `search` the matches from the next few pages. The
 * providers listed here have no search of their own, so the scan is ours; a
 * scan that stops before the end hands back the cursor to continue from.
 */
export async function listProviderOptions(
  lister: OptionLister,
  http: ProviderHttp,
  request: { parent?: string; search?: string; cursor?: string },
): Promise<OptionPage> {
  const search = request.search?.trim().toLowerCase();
  if (!search) {
    return lister.list(http, {
      ...(request.parent ? { parent: request.parent } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
    });
  }
  const found: ProviderOption[] = [];
  let cursor = request.cursor;
  for (let pages = 0; pages < MAX_SEARCH_PAGES; pages += 1) {
    const page = await lister.list(http, {
      ...(request.parent ? { parent: request.parent } : {}),
      ...(cursor ? { cursor } : {}),
    });
    found.push(...page.options.filter((option) => matches(option, search)));
    cursor = page.nextCursor;
    if (!cursor || found.length >= ENOUGH_MATCHES) break;
  }
  return { options: found, ...(cursor ? { nextCursor: cursor } : {}) };
}
