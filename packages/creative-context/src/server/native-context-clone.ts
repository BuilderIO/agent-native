import { resolveNativeContextCloneReference as resolveFromStore } from "../store/contexts.js";
import { assertCreativeContextLabEnabled } from "./labs.js";

export async function resolveNativeContextCloneReference(
  input: Parameters<typeof resolveFromStore>[0],
) {
  await assertCreativeContextLabEnabled();
  return resolveFromStore(input);
}
