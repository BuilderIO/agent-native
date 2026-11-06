/*__cf_process_require_shim__*/
import __cf_process from "node:process";
const __cf_require_cache = new globalThis.WeakMap();
const __cf_wrap_require = (factory) => {
  let wrapped = __cf_require_cache.get(factory);
  if (!wrapped) {
    wrapped = new globalThis.Proxy(factory, {
      apply(target, thisArg, args) {
        return new globalThis.Proxy(globalThis.Reflect.apply(target, thisArg, args), {
          apply(require, thisArg, args) {
            return args[0] === "process" || args[0] === "node:process"
              ? __cf_process : globalThis.Reflect.apply(require, thisArg, args);
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
const t=__cf_wrap_module(__cf_module_import);
import __cf_module_import from"node:module";import r from"node:process";const c="collision",e=t.createRequire("file:///worker.mjs");e.extra=42;const a=o=>o("process");var l={fetch(){let o;try{e("not-a-real-module")}catch(s){o=s.message}return Response.json({bare:e("process")===r,node:e("node:process")===r,dynamic:e(["pro","cess"].join(""))===r,direct:t.createRequire("file:///worker.mjs")("node:process")===r,buffer:typeof e("node:buffer").Buffer,extra:e.extra,shadow:a(s=>"local:"+s),collision:c,missing:o.includes("not-a-real-module")})}};export{l as default};
