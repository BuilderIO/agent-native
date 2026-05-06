import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import { getSession } from "@agent-native/core/server";
import {
  searchPeopleForUser,
  type PeopleSearchScope,
} from "../lib/people-search.js";

async function uEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

function parseScope(value: unknown): PeopleSearchScope | undefined {
  return value === "all" || value === "directory" ? value : undefined;
}

export const searchPeople = defineEventHandler(async (event: H3Event) => {
  try {
    const email = await uEmail(event);
    const query = getQuery(event);

    return searchPeopleForUser(email, {
      q: typeof query.q === "string" ? query.q : undefined,
      scope: parseScope(query.scope),
    });
  } catch (error: any) {
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
