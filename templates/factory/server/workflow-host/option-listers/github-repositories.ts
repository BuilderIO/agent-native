import { z } from "zod";

import { expectJson, unreadableList } from "./provider-http.js";
import {
  InvalidCursorError,
  OPTION_PAGE_SIZE,
  type OptionLister,
  type ProviderOption,
  type ProviderOptionTag,
} from "./types.js";

const repositoriesSchema = z.array(
  z.object({
    full_name: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
    private: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
);

function pageOf(cursor: string | undefined): number {
  if (cursor === undefined) return 1;
  const page = Number(cursor);
  if (!Number.isInteger(page) || page < 1) {
    throw new InvalidCursorError("A GitHub cursor is a page number from 1.");
  }
  return page;
}

/** Repositories the connected account can read, most recently pushed first, valued as `owner/name`. */
export const githubRepositories: OptionLister = {
  provider: "github",
  resource: "repositories",
  async list(http, { cursor }) {
    const page = pageOf(cursor);
    const response = await http({
      path: "/user/repos",
      query: {
        per_page: String(OPTION_PAGE_SIZE),
        page: String(page),
        sort: "pushed",
        direction: "desc",
      },
    });
    const parsed = repositoriesSchema.safeParse(expectJson("github", response));
    if (!parsed.success) throw unreadableList("github", "a repository list");
    const options: ProviderOption[] = parsed.data.map((repository) => {
      const tags: ProviderOptionTag[] = [];
      if (repository.private) tags.push("private");
      if (repository.archived) tags.push("archived");
      return {
        value: repository.full_name,
        label: repository.full_name,
        ...(tags.length > 0 ? { tags } : {}),
      };
    });
    const more = /rel="next"/.test(response.headers.link ?? "");
    return { options, ...(more ? { nextCursor: String(page + 1) } : {}) };
  },
};
