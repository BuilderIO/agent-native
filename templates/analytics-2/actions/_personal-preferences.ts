import { fail } from "@agent-native/core/action";
import {
  resourceGetByPath,
  resourcePutIfAbsent,
  resourcePutIfCurrent,
} from "@agent-native/core/resources/store";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

import type { PersonalPreferencesUpdate } from "../shared/personal-preferences.js";

function ownerEmail() {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email) fail("Not authenticated.", { statusCode: 401 });
  return email;
}
export async function readPersonalPreferences() {
  const owner = ownerEmail();
  const saved = await resourceGetByPath(owner, "AGENTS.md");
  return {
    owner,
    content: saved?.content ?? "",
    revision: saved ? { id: saved.id, updatedAt: saved.updatedAt } : null,
  };
}
export async function savePersonalPreferences(
  input: PersonalPreferencesUpdate,
) {
  const owner = ownerEmail();
  if (input.expectedOwner !== owner)
    fail("The active account changed. Reopen preferences before saving.", {
      statusCode: 409,
    });
  const previous = await resourceGetByPath(owner, "AGENTS.md");
  const expected = input.expectedRevision;
  if (
    (previous === null) !== (expected === null) ||
    (previous &&
      expected &&
      (previous.id !== expected.id ||
        previous.updatedAt !== expected.updatedAt))
  ) {
    fail("Preferences changed. Reload before saving.", { statusCode: 409 });
  }
  const saved = previous
    ? await resourcePutIfCurrent({
        owner,
        path: "AGENTS.md",
        content: input.content,
        expectedId: previous.id,
        expectedUpdatedAt: previous.updatedAt,
        expectedContent: previous.content,
        mimeType: "text/markdown",
      })
    : await resourcePutIfAbsent(
        owner,
        "AGENTS.md",
        input.content,
        "text/markdown",
      );
  if (!saved)
    fail("Preferences changed. Reload before saving.", { statusCode: 409 });
  return {
    owner,
    content: saved.content,
    revision: { id: saved.id, updatedAt: saved.updatedAt },
  };
}
