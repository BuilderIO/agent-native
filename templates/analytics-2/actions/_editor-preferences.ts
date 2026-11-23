import { fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  getUserSettingEntry,
  mutateUserSetting,
} from "@agent-native/core/settings";

import {
  defaultEditorPreferences,
  editorPreferences,
  type EditorPreferencesPatch,
} from "../shared/editor-preferences.js";

const key = "analytics-2:editor-preferences";
function owner() {
  const email = getRequestUserEmail()?.trim().toLowerCase();
  if (!email)
    fail("Not authenticated.", {
      statusCode: 401,
      errorCode: "unauthenticated",
    });
  return email;
}
function parse(value: unknown) {
  return value === null
    ? defaultEditorPreferences
    : editorPreferences.parse(value);
}
export async function readEditorPreferences() {
  const entry = await getUserSettingEntry(owner(), key, { bypassCache: true });
  return entry.found
    ? editorPreferences.parse(entry.value)
    : defaultEditorPreferences;
}
export async function updateEditorPreferences(patch: EditorPreferencesPatch) {
  return editorPreferences.parse(
    await mutateUserSetting(
      owner(),
      key,
      (value) => ({
        ...parse(value),
        ...patch,
      }),
      {
        validateStoredValue: (value) => {
          editorPreferences.parse(value);
        },
      },
    ),
  );
}
