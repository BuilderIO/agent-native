import type { ActionEntry } from "../../agent/production-agent.js";
import { buildSettingsRoute } from "../../navigation/index.js";
import {
  CORE_SETTINGS_PAGE_ID_LIST,
  isCoreSettingsPageId,
  normalizeSettingsId,
  resolveLegacySettingsId,
} from "../../navigation/settings-redirects.js";
import { getRequestRunContext } from "../request-context.js";

const PAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface OpenSettingsPageTarget {
  page: string;
  sub: string | null;
  anchor: string | null;
  /** False for an app's own page, which only the browser can confirm exists. */
  corePage: boolean;
  /** Router-relative path, for example `/settings/integrations/builder`. */
  pathname: string;
}

/**
 * Where `open-settings-page` sends the user. Page ids open directly; today's
 * tab ids and section ids (`agent`, `keys`, `llm`, `secrets:KEY`) go through
 * the redirect table, the same one the Settings shell uses for links.
 */
export function resolveOpenSettingsPageTarget(input: {
  page: string;
  sub?: string | null;
  anchor?: string | null;
}): OpenSettingsPageTarget {
  // Accept a path too (`/settings/integrations/builder`).
  const [requested = "", pathSub] = input.page
    .trim()
    .replace(/^\/?settings\/?/, "")
    .split("/");
  const id = normalizeSettingsId(requested);
  const redirect = isCoreSettingsPageId(id)
    ? null
    : resolveLegacySettingsId(requested, "section");
  const page = redirect?.page ?? id;
  if (!PAGE_ID_PATTERN.test(page)) {
    throw new Error(
      `"${input.page}" is not a Settings page id. Use one of: ${CORE_SETTINGS_PAGE_ID_LIST.join(", ")}, or an app page id from the Settings nav.`,
    );
  }
  const sub = input.sub?.trim() || pathSub?.trim() || redirect?.sub || null;
  const anchor =
    input.anchor?.trim().replace(/^#/, "") || redirect?.anchor || null;
  return {
    page,
    sub,
    anchor,
    corePage: isCoreSettingsPageId(page),
    pathname: buildSettingsRoute(page, sub),
  };
}

export function createOpenSettingsPageTool(): ActionEntry {
  return {
    // Writes only the one-shot URL command, like `set-url-path`.
    readOnly: true,
    tool: {
      description: `Open a Settings page in the user's current browser tab. Page ids: ${CORE_SETTINGS_PAGE_ID_LIST.join(", ")}; an app's own Settings pages use the id in their URL (/settings/<id>). Today's tab and section ids also work (agent, keys, llm, limits, voice, secrets:OPENAI_API_KEY). The Settings page the user already has open is \`settingsPage\` in <current-url>. A page the user can't see (the owner and admin pages, for a member) opens Profile instead. One-shot; the UI applies it without a reload.`,
      parameters: {
        type: "object",
        properties: {
          page: {
            type: "string",
            description:
              "Settings page id, for example model, api-keys, integrations, members, or app.",
          },
          sub: {
            type: "string",
            description:
              "Optional sub-page: builder under integrations, a platform under channels (slack), or an app area under app.",
          },
          anchor: {
            type: "string",
            description:
              "Optional row or section id on the page to scroll to, for example limits on model.",
          },
        },
        required: ["page"],
      },
    },
    run: async (args) => {
      const page = typeof args?.page === "string" ? args.page : "";
      if (!page.trim()) {
        throw new Error("page is required, for example model or api-keys.");
      }
      const target = resolveOpenSettingsPageTarget({
        page,
        sub: typeof args?.sub === "string" ? args.sub : null,
        anchor: typeof args?.anchor === "string" ? args.anchor : null,
      });
      const { appStateKeyForBrowserTab, writeAppState } =
        await import("../../application-state/script-helpers.js");
      await writeAppState(
        appStateKeyForBrowserTab(
          "__set_url__",
          getRequestRunContext()?.browserTabId,
        ),
        {
          pathname: target.pathname,
          hash: target.anchor ? `#${target.anchor}` : "",
          // The query belongs to the page being left (`?connected=`).
          searchParams: {},
          mergeSearchParams: false,
          _writeId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
      );
      return target.corePage
        ? `Opening ${target.pathname}. The next <current-url> shows the page Settings opened.`
        : `Opening ${target.pathname}. "${target.page}" isn't a core Settings page, so it opens only if this app has it; otherwise Settings shows Profile.`;
    },
  };
}
