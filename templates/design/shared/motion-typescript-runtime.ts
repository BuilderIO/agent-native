export type TypeScriptRuntime = typeof import("typescript");

let cachedTypeScript: TypeScriptRuntime | undefined;

export const ts = new Proxy({} as TypeScriptRuntime, {
  get(_target, property) {
    if (!cachedTypeScript) {
      const runtimeProcess = (
        globalThis as typeof globalThis & {
          process?: {
            getBuiltinModule?: (specifier: string) => unknown;
          };
        }
      ).process;
      const moduleApi = runtimeProcess?.getBuiltinModule?.("node:module") as
        | {
            createRequire: (filename: string) => (specifier: string) => unknown;
          }
        | undefined;
      if (!moduleApi) {
        throw new Error("Motion source parsing requires Node.js.");
      }
      cachedTypeScript = moduleApi.createRequire(import.meta.url)(
        "typescript",
      ) as TypeScriptRuntime;
    }
    return cachedTypeScript[property as keyof TypeScriptRuntime];
  },
});
