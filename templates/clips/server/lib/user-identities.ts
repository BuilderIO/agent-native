import {
  resolveUserProfileName,
  type UserProfile,
} from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";

import { displayViewerName } from "../../shared/view-analytics.js";

export function profileNameFor(
  email: string,
  storedName: string | null | undefined,
  profiles: ReadonlyMap<string, UserProfile>,
): string | null {
  return resolveUserProfileName(
    email,
    storedName,
    profiles.get(email.trim().toLowerCase())?.name,
  );
}

export async function hydrateCommentAuthorNames<
  T extends { authorEmail: string; authorName: string | null },
>(rows: readonly T[]): Promise<T[]> {
  const profiles = await getUserProfiles(rows.map((row) => row.authorEmail));
  return rows.map((row) => {
    const authorName = profileNameFor(
      row.authorEmail,
      row.authorName,
      profiles,
    );
    return authorName === row.authorName ? row : { ...row, authorName };
  });
}

export async function hydrateViewerNames<
  T extends { viewerEmail: string | null; viewerName: string | null },
>(rows: readonly T[]): Promise<T[]> {
  const profiles = await getUserProfiles(
    rows.flatMap((row) => (row.viewerEmail ? [row.viewerEmail] : [])),
  );
  return rows.map((row) => {
    const viewerName = row.viewerEmail
      ? profileNameFor(
          row.viewerEmail,
          displayViewerName(row.viewerName),
          profiles,
        )
      : displayViewerName(row.viewerName);
    return viewerName === row.viewerName ? row : { ...row, viewerName };
  });
}
