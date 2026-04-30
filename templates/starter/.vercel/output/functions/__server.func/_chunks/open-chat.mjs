import{i as e}from"./script-helpers.mjs";import{i as t,t as n}from"./utils.mjs";import{i as r}from"./store3.mjs";async function i(i){let a=t(i);if(a.help===`true`){console.log(`Usage: pnpm action open-chat --id <thread-id>

Opens a chat thread in the UI as a new tab and focuses it.
Use search-chats to find the thread ID first.

Options:
  --id <thread-id>   The chat thread ID to open (required)
  --help             Show this help message

Examples:
  pnpm action open-chat --id thread-1712100000000-abc123`);return}let o=a.id;o||n(`--id is required. Use "pnpm action search-chats" to find thread IDs.`);let s=await r(o);s||n(`Chat thread "${o}" not found.`),await e(`chat-command`,{command:`open-thread`,threadId:o,timestamp:Date.now()});let c=s.title||s.preview||`(untitled)`;console.log(`Opening chat: ${c}`),console.log(`Thread ID: ${o}`)}export{i as default};