import { fail } from "@agent-native/core/action";

import { SourceInputError } from "../../shared/source-workspace.js";

export function failOnSourceInputError<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SourceInputError) {
      fail(error.message, { errorCode: error.code, statusCode: 400 });
    }
    throw error;
  }
}
