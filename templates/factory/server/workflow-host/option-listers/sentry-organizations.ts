import { z } from "zod";

import { expectJson, nextLinkCursor, unreadableList } from "./provider-http.js";
import {
  OPTION_PAGE_SIZE,
  type OptionLister,
  type ProviderOption,
} from "./types.js";

const organizationsSchema = z.array(
  z.object({ slug: z.string().min(1), name: z.string().min(1) }),
);

export const sentryOrganizations: OptionLister = {
  provider: "sentry",
  resource: "organizations",
  async list(http, { cursor }) {
    const response = await http({
      path: "/organizations/",
      query: {
        per_page: String(OPTION_PAGE_SIZE),
        ...(cursor ? { cursor } : {}),
      },
    });
    const parsed = organizationsSchema.safeParse(
      expectJson("sentry", response),
    );
    if (!parsed.success) throw unreadableList("sentry", "an organization list");
    const options: ProviderOption[] = parsed.data.map((organization) => ({
      value: organization.slug,
      label: organization.name,
      ...(organization.name === organization.slug
        ? {}
        : { hint: organization.slug }),
    }));
    const next = nextLinkCursor(response.headers);
    return { options, ...(next ? { nextCursor: next } : {}) };
  },
};
