/*__cf_process_require_shim__*/
import __cf_process_1 from "node:process";
const __cf_require_cache = new globalThis.WeakMap();
const __cf_wrap_require = (factory) => {
  let wrapped = __cf_require_cache.get(factory);
  if (!wrapped) {
    wrapped = new globalThis.Proxy(factory, {
      apply(target, thisArg, args) {
        return new globalThis.Proxy(globalThis.Reflect.apply(target, thisArg, args), {
          apply(require, thisArg, args) {
            return args[0] === "process" || args[0] === "node:process"
              ? __cf_process_1 : globalThis.Reflect.apply(require, thisArg, args);
          }
        });
      }
    });
    __cf_require_cache.set(factory, wrapped);
  }
  return wrapped;
};
const __cf_wrap_module = (module) => new globalThis.Proxy(module, {
  get(target, key, receiver) {
    const value = globalThis.Reflect.get(target, key, receiver);
    return key === "createRequire" && typeof value === "function" ? __cf_wrap_require(value) : value;
  }
});
const create=__cf_wrap_require(__cf_module_import);
import { createRequire as __cf_module_import } from "node:module";
       import process from "node:process";
       const __cf_\u0070rocess = "original";
       const Proxy = 1, Reflect = 2, WeakMap = 3;
       const require = create("file:///worker.mjs");
       export const result = {
         process: require("process") === process,
         resolve: require.resolve("node:buffer"),
         cache: typeof require.cache,
         extensions: typeof require.extensions,
         collision: __cf_\u0070rocess,
       };