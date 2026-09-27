import { getSession } from "@agent-native/core/server";
import { defineEventHandler, getQuery } from "h3";

import { peopleSearchDirectoryPeople } from "../../../lib/google-api.js";
import { getClient } from "../../../lib/google-calendar.js";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const userEmail = session.email;

  const query = getQuery(event);
  const emailsParam = String(query.emails || "");
  if (!emailsParam) return {};

  const emails = emailsParam
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

  const client = await getClient(userEmail);
  if (!client) return {};

  const accessToken = client.accessToken;
  const results: Record<string, string> = {};

  await Promise.all(
    emails.map(async (email) => {
      try {
        const data = await peopleSearchDirectoryPeople(accessToken, email, {
          pageSize: 1,
          readMask: "emailAddresses,photos",
        });
        const person = data?.people?.[0];
        if (!person) return;
        const matchesEmail = person.emailAddresses?.some(
          (e: any) => e.value?.toLowerCase() === email,
        );
        if (!matchesEmail) return;
        const photo = person.photos?.find((p: any) => !p.default);
        if (photo?.url) {
          results[email] = photo.url;
        }
      } catch {
        // Skip — user may not have directory access
      }
    }),
  );

  return results;
});
