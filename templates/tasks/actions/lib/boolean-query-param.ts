import { z } from "zod";

import { coerceBooleanParam } from "../../shared/boolean-param.js";

const booleanQueryValue = z.union([
  z.boolean(),
  z.enum(["true", "false", "1", "0"]),
]);

export function booleanQueryParam(defaultValue = false) {
  return booleanQueryValue
    .optional()
    .transform((value) => coerceBooleanParam(value) ?? defaultValue)
    .default(defaultValue);
}

export function optionalBooleanQueryParam() {
  return booleanQueryValue
    .optional()
    .transform((value) => coerceBooleanParam(value));
}
