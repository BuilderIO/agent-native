import"./auth.mjs";import{i as e}from"./request-context.mjs";import{i as t,t as n}from"./utils.mjs";import{a as r,o as i}from"./store3.mjs";function a(){let t=e();return!t||t===`local@localhost`?`local@localhost`:t}function o(e){let t=new Date(e),n=new Date().getTime()-t.getTime(),r=Math.floor(n/864e5);return r===0?t.toLocaleTimeString([],{hour:`numeric`,minute:`2-digit`}):r===1?`Yesterday`:r<7?t.toLocaleDateString([],{weekday:`short`}):t.toLocaleDateString([],{month:`short`,day:`numeric`})}async function s(e){let s=t(e);if(s.help===`true`){console.log(`Usage: pnpm action search-chats [options]

Options:
  --query <text>  Search chats by title, preview, or content
  --limit N       Max results (default: 20)
  --format json   Output as JSON
  --help          Show this help message

Examples:
  pnpm action search-chats --query "email setup"
  pnpm action search-chats --limit 5
  pnpm action search-chats --format json`);return}let c=a(),l=s.limit?parseInt(s.limit,10):20;(isNaN(l)||l<1)&&n(`--limit must be a positive integer`);let u=s.query,d=u?await i(c,u,l):await r(c,l,0);if(s.format===`json`){console.log(JSON.stringify({query:u??null,threads:d.map(e=>({id:e.id,title:e.title,preview:e.preview,messageCount:e.messageCount,updatedAt:e.updatedAt})),count:d.length},null,2));return}if(d.length===0){console.log(u?`No chats matching "${u}"`:`No chat history`);return}console.log(u?`Chats matching "${u}" (${d.length}):`:`Recent chats (${d.length}):`),console.log();for(let e of d){let t=e.title||e.preview||`(untitled)`,n=e.messageCount===1?`1 msg`:`${e.messageCount} msgs`,r=o(e.updatedAt);console.log(`  ${t}`),console.log(`    ID: ${e.id}  |  ${n}  |  ${r}`),e.preview&&e.title&&e.preview!==e.title&&console.log(`    ${e.preview.slice(0,80)}${e.preview.length>80?`...`:``}`),console.log()}}export{s as default};