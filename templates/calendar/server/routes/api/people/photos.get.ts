import { defineEventHandler, getQuery } from "h3";
import { getClient } from "../../../lib/google-calendar.js";
import { peopleSearchDirectoryPeople } from "../../../lib/google-api.js";

/**
 * GET /api/people/photos?emails=a@foo.com,b@foo.com
 *
 * Batch-resolves profile photos from Google Workspace directory.
 * Returns { [email]: photoUrl } for any found.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const emailsParam = String(query.emails || "");
  if (!emailsParam) return {};

  const emails = emailsParam
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);

  const client = await getClient();
  if (!client) return {};

  const accessToken = client.accessToken;
  const results: Record<string, string> = {};

  // Search for each email in the workspace directory
  await Promise.all(
    emails.map(async (email) => {
      try {
        const data = await peopleSearchDirectoryPeople(accessToken, email, {
          pageSize: 1,
          readMask: "emailAddresses,photos",
        });
        const person = data?.people?.[0];
        if (!person) return;
        // Verify email matches
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
