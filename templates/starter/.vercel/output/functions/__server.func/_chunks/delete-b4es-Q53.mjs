import{i as e}from"./request-context-60tSGHqu.mjs";import"./auth-Dww4On4H.mjs";import{r as t}from"./store-D6lpoHgL.mjs";import{r as n,t as r}from"./utils-Bt3wDA98.mjs";async function i(i){let a=n(i);if(a.help===`true`){console.log(`Usage: pnpm action resource-delete --path <path> [options]

Options:
  --path <path>            Resource path (required)
  --scope personal|shared  Scope to delete from (default: personal)
  --help                   Show this help message`);return}let o=a.path;o||r(`--path is required. Example: --path notes/todo.md`),await t((a.scope??`personal`)===`shared`?`__shared__`:e()??`local@localhost`,o)?console.log(`Deleted resource: ${o}`):console.log(`Resource not found: ${o}`)}export{i as default};