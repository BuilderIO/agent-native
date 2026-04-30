import{i as e}from"./request-context-60tSGHqu.mjs";import"./auth-Dww4On4H.mjs";import{o as t,s as n,t as r}from"./store-D6lpoHgL.mjs";import{r as i}from"./utils-Bt3wDA98.mjs";async function a(a){let o=i(a);if(o.help===`true`){console.log(`Usage: pnpm action resource-list [options]

Options:
  --prefix <path>              Filter by path prefix
  --scope personal|shared|all  Scope to list (default: all)
  --format json|text           Output format (default: text)
  --help                       Show this help message`);return}let s=o.prefix,c=o.scope??`all`,l=o.format??`text`,u=e()??`local@localhost`;c!==`shared`&&await r(u);let d;if(d=c===`personal`?await t(u,s):c===`shared`?await t(`__shared__`,s):await n(u,s),l===`json`){console.log(JSON.stringify(d,null,2));return}if(d.length===0){console.log(`No resources found.`);return}console.log(`Resources: ${d.length}\n`);for(let e of d){let t=e.owner===`__shared__`?`[shared]`:`[${e.owner}]`,n=e.size==null?``:` (${e.size} bytes)`;console.log(`  ${e.path}  ${t}${n}  ${e.mimeType}`)}}export{a as default};