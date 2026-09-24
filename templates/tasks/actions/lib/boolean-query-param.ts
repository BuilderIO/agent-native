/**
 * HTTP GET actions and CLI flags pass booleans as strings ("true"/"false"),
 * not JSON booleans. Plain z.boolean() rejects those values before run().
 */
import { z } from "zod";

import { coerceBooleanParam } from "../../shared/boolean-param.js";

const booleanQueryValue = z.union([
  z.boolean(),
  z.enum(["true", "false", "1", "0"]),
]);

/** Required boolean query param with a default when omitted. */
export function booleanQueryParam(defaultValue = false) {
  return booleanQueryValue
    .optional()
    .transform((value) => coerceBooleanParam(value) ?? defaultValue)
    .default(defaultValue);
}

/**
 * Optional boolean query param that stays undefined when omitted.
 * Used by navigate when includeDone should not be patched unless provided.
 */
export function optionalBooleanQueryParam() {
  return booleanQueryValue
    .optional()
    .transform((value) => coerceBooleanParam(value));
}
