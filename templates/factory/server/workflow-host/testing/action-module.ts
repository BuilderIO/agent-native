/**
 * `@agent-native/core/action` for the action specs. It imports nothing: the
 * mock factory that returns it runs while the module graph is still loading,
 * and a factory that reached for the PGlite kit would wait on itself.
 */
export const actionModule = {
  defineAction: (definition: unknown) => definition,
  fail: (
    message: string,
    options: {
      errorCode?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
    } = {},
  ): never => {
    throw Object.assign(new Error(message), {
      actionContractError: true,
      errorCode: options.errorCode ?? "action_failed",
      statusCode: options.statusCode ?? 400,
      ...(options.details === undefined ? {} : { details: options.details }),
    });
  },
};
