import{r as e}from"./script-helpers-y0qrOv4k.mjs";import{i as t}from"./store-0r6YYqsq.mjs";import{r as n,t as r}from"./utils-Bt3wDA98.mjs";async function i(i){let a=n(i);if(a.help===`true`){console.log(`Usage: pnpm action open-chat --id <thread-id>

Opens a chat thread in the UI as a new tab and focuses it.
Use search-chats to find the thread ID first.

Options:
  --id <thread-id>   The chat thread ID to open (required)
  --help             Show this help message

Examples:
  pnpm action open-chat --id thread-1712100000000-abc123`);return}let o=a.id;o||r(`--id is required. Use "pnpm action search-chats" to find thread IDs.`);let s=await t(o);s||r(`Chat thread "${o}" not found.`),await e(`chat-command`,{command:`open-thread`,threadId:o,timestamp:Date.now()});let c=s.title||s.preview||`(untitled)`;console.log(`Opening chat: ${c}`),console.log(`Thread ID: ${o}`)}export{i as default};