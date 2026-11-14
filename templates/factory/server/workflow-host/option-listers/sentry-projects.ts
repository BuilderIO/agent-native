import { z } from "zod";

import { expectJson, nextLinkCursor, unreadableList } from "./provider-http.js";
import {
  OPTION_PAGE_SIZE,
  type OptionLister,
  type ProviderOption,
} from "./types.js";

const projectsSchema = z.array(
  z.object({ slug: z.string().min(1), name: z.string().min(1).optional() }),
);

/** Projects inside one organization, valued as `organization/project`, the scope a Sentry source stores. */
export const sentryProjects: OptionLister = {
  provider: "sentry",
  resource: "projects",
  parentResource: "organizations",
  async list(http, { parent, cursor }) {
    if (!parent) {
      throw new TypeError("Sentry projects are listed per organization.");
    }
    const response = await http({
      path: `/organizations/${encodeURIComponent(parent)}/projects/`,
      query: {
        per_page: String(OPTION_PAGE_SIZE),
        ...(cursor ? { cursor } : {}),
      },
    });
    const parsed = projectsSchema.safeParse(expectJson("sentry", response));
    if (!parsed.success) throw unreadableList("sentry", "a project list");
    const options: ProviderOption[] = parsed.data.map((project) => {
      const value = `${parent}/${project.slug}`;
      const label = project.name ?? project.slug;
      return { value, label, ...(label === value ? {} : { hint: value }) };
    });
    const next = nextLinkCursor(response.headers);
    return { options, ...(next ? { nextCursor: next } : {}) };
  },
};
