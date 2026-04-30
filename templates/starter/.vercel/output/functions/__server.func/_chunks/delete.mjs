import"./auth.mjs";import{i as e}from"./request-context.mjs";import{i as t,t as n}from"./utils.mjs";import{i as r}from"./store4.mjs";async function i(i){let a=t(i);if(a.help===`true`){console.log(`Usage: pnpm action resource-delete --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared  Scope to delete from (default: personal)
  --help                   Show this help message`);return}let o=a.path;o||n(`--path is required. Example: --path notes/todo.md`),await r((a.scope??`personal`)===`shared`?`__shared__`:e()??`local@localhost`,o)?console.log(`Deleted resource: ${o}`):console.log(`Resource not found: ${o}`)}export{i as default};