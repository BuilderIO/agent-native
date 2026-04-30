import{n as e}from"../_runtime.mjs";import{r as t}from"./chunk-D3zDcpJC.mjs";import{d as n,i as r,l as i,o as a}from"./client-DU--QVjD.mjs";import{n as o,t as s}from"./emitter-B7DgkGkz.mjs";import c from"crypto";var l=e({a:()=>w,c:()=>A,d:()=>E,f:()=>u,i:()=>O,l:()=>j,n:()=>x,o:()=>T,r:()=>D,s:()=>k,t:()=>`__shared__`,u:()=>M}),u=t({SHARED_OWNER:()=>`__shared__`,ensurePersonalDefaults:()=>x,resourceDelete:()=>D,resourceDeleteByPath:()=>O,resourceGet:()=>w,resourceGetByPath:()=>T,resourceList:()=>k,resourceListAccessible:()=>A,resourceListAllOwners:()=>j,resourceMove:()=>M,resourcePut:()=>E}),d,f=`# Learnings

User preferences, corrections, and patterns. The agent reads this at the start of every conversation.

Keep this file tidy — revise, consolidate, and remove outdated entries. Don't just append forever.

## Preferences

## Corrections

## Patterns
`,p=`# My Learnings

Personal preferences, corrections, and patterns — only visible to you.

## Preferences

## Corrections

## Patterns
`,m=`---
name: learn
description: >-
  Review the conversation and save structured memories for future sessions.
user-invocable: true
---

# Learn

Review the current conversation and save anything worth remembering using the structured memory system.

## Memory types

- **user** — Preferences, role, personal context, contacts
- **feedback** — Corrections ("don't do X, do Y instead"), confirmed approaches
- **project** — Ongoing work context, decisions, status
- **reference** — Pointers to external systems, URLs, API details

## Steps

1. Review the conversation for new insights
2. Check your memory index: \`resource-read --path memory/MEMORY.md\`
3. For each new insight, use \`save-memory\` with a descriptive name, type, and content
4. If updating an existing memory, read it first with \`resource-read --path memory/<name>.md\`, then save with merged content

## What NOT to capture

- Things obvious from reading the code
- Standard language/framework behavior
- Temporary debugging notes
- Anything already in AGENTS.md or other skills

Keep one memory per logical topic. Descriptions should be concise — the index is loaded every conversation.
`,h=`---
name: learn-shared
description: >-
  Update the shared LEARNINGS.md with team-wide preferences, corrections, and
  patterns from this session.
user-invocable: true
---

# Learn (Shared)

Review the current conversation and update the shared \`LEARNINGS.md\` resource with anything the whole team should know.

## What to capture

- **Team conventions** — agreed-upon approaches, code style decisions
- **Technical learnings** — API quirks, library gotchas, surprising behavior
- **Architectural decisions** — why something is done a certain way
- **Corrections** — mistakes that any team member's agent should avoid

## What NOT to capture

- Personal preferences (use \`/learn\` for those)
- Things obvious from reading the code
- Standard language/framework behavior

## Steps

1. Read shared learnings: \`pnpm action resource-read --path LEARNINGS.md --scope shared\`
2. Review the conversation for team-relevant insights
3. Merge new learnings with existing ones — don't duplicate, refine existing entries
4. Write back: \`pnpm action resource-write --path LEARNINGS.md --scope shared --content "..."\`

Keep entries concise — one line per learning, grouped by category (Conventions, Technical, Patterns).
`,g=`# Agent Instructions

This file customizes how the AI agent behaves in this app. Edit it to add your own instructions, preferences, and context.

## What to put here

- **Preferences** — Tone, style, verbosity, response format
- **Context** — Domain knowledge, terminology, team conventions
- **Rules** — Things the agent should always/never do
- **Skills** — Reference skill files for specialized tasks (create them in the \`skills/\` folder)

## Skills

You can create skill files to give the agent specialized knowledge for specific tasks. Create resources under \`skills/\` (e.g., \`skills/data-analysis.md\`, \`skills/code-review.md\`) and reference them here:

| Skill | Path | Description |
|-------|------|-------------|
| *(add your skills here)* | \`skills/example.md\` | What this skill teaches the agent |

The agent will read the relevant skill file when performing that type of task.

## Example

\`\`\`markdown
## Tone
Be concise. Lead with the answer. Skip filler.

## Code style
- Use TypeScript, never JavaScript
- Prefer named exports
- Use early returns

## Domain context
We sell B2B SaaS. Our customers are enterprise engineering teams.
\`\`\`
`,_=`# My Agent Instructions

Personal agent instructions — only visible to you. Use this for your own contacts, preferences, and context.

## Contacts

Add people you frequently interact with so the agent can resolve names like "email my wife" or "message John":

| Name | Email | Notes |
|------|-------|-------|
| *(add your contacts here)* | | |

## Preferences

## Context
`;async function v(){return d||=y().catch(e=>{throw d=void 0,e}),d}async function y(){let e=r();await n(()=>e.execute(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        owner TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT 'text/markdown',
        size ${a()} NOT NULL DEFAULT 0,
        created_at ${a()} NOT NULL,
        updated_at ${a()} NOT NULL,
        UNIQUE(path, owner)
      )
    `));let t=Date.now(),o=i()?`INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`:`INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,s=Buffer.byteLength(g,`utf8`);await e.execute({sql:o,args:[c.randomUUID(),`AGENTS.md`,`__shared__`,g,`text/markdown`,s,t,t]});let l=Buffer.byteLength(f,`utf8`);await e.execute({sql:o,args:[c.randomUUID(),`LEARNINGS.md`,`__shared__`,f,`text/markdown`,l,t,t]});let u=Buffer.byteLength(h,`utf8`);await e.execute({sql:o,args:[c.randomUUID(),`skills/learn-shared.md`,`__shared__`,h,`text/markdown`,u,t,t]});try{let{getBuiltinAgents:n,BUILTIN_AGENTS_FOR_SEEDING:r}=await import(`./agent-discovery-CFWdo4V6.mjs`).then(e=>e.t).then(e=>e.t),i=r;for(let n of i){let r=JSON.stringify({id:n.id,name:n.name,description:n.description,url:n.url,color:n.color},null,2),i=Buffer.byteLength(r,`utf8`);await e.execute({sql:o,args:[c.randomUUID(),`remote-agents/${n.id}.json`,`__shared__`,r,`application/json`,i,t,t]})}}catch{}try{let t=(await e.execute({sql:`SELECT id, path FROM resources WHERE path LIKE ? AND path LIKE ?`,args:[`agents/%`,`%.json`]})).rows??[];for(let n of t){let t=n.path.replace(/^agents\//,`remote-agents/`);try{await e.execute({sql:`UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,args:[t,Date.now(),n.id]})}catch{}}}catch{}}var b=new Set;async function x(e){if(e===`__shared__`||b.has(e))return;b.add(e),await v();let t=r(),n=Date.now(),a=i()?`INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`:`INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,o=Buffer.byteLength(_,`utf8`);await t.execute({sql:a,args:[c.randomUUID(),`AGENTS.md`,e,_,`text/markdown`,o,n,n]});let s=Buffer.byteLength(p,`utf8`);await t.execute({sql:a,args:[c.randomUUID(),`LEARNINGS.md`,e,p,`text/markdown`,s,n,n]});let l=`# Memory Index
`,u=Buffer.byteLength(l,`utf8`);await t.execute({sql:a,args:[c.randomUUID(),`memory/MEMORY.md`,e,l,`text/markdown`,u,n,n]});let d=Buffer.byteLength(m,`utf8`);await t.execute({sql:a,args:[c.randomUUID(),`skills/learn.md`,e,m,`text/markdown`,d,n,n]})}function S(e){return{id:e.id,path:e.path,owner:e.owner,content:e.content,mimeType:e.mime_type,size:e.size,createdAt:e.created_at,updatedAt:e.updated_at}}function C(e){return{id:e.id,path:e.path,owner:e.owner,mimeType:e.mime_type,size:e.size,createdAt:e.created_at,updatedAt:e.updated_at}}async function w(e){await v();let{rows:t}=await r().execute({sql:`SELECT * FROM resources WHERE id = ?`,args:[e]});return t.length===0?null:S(t[0])}async function T(e,t){await v();let{rows:n}=await r().execute({sql:`SELECT * FROM resources WHERE owner = ? AND path = ?`,args:[e,t]});return n.length===0?null:S(n[0])}async function E(e,t,n,a,o){await v();let l=r(),u=Date.now(),d=Buffer.byteLength(n,`utf8`),f=a||`text/markdown`,{rows:p}=await l.execute({sql:`SELECT id, created_at FROM resources WHERE owner = ? AND path = ?`,args:[e,t]}),m=p.length>0?p[0].id:c.randomUUID(),h=p.length>0?p[0].created_at:u;return await l.execute({sql:i()?`INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO UPDATE SET id=EXCLUDED.id, content=EXCLUDED.content, mime_type=EXCLUDED.mime_type, size=EXCLUDED.size, updated_at=EXCLUDED.updated_at`:`INSERT OR REPLACE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,args:[m,t,e,n,f,d,h,u]}),s(m,t,e,o?.requestSource),{id:m,path:t,owner:e,content:n,mimeType:f,size:d,createdAt:h,updatedAt:u}}async function D(e){await v();let t=r(),{rows:n}=await t.execute({sql:`SELECT path, owner FROM resources WHERE id = ?`,args:[e]});if(n.length===0)return!1;let i=(await t.execute({sql:`DELETE FROM resources WHERE id = ?`,args:[e]})).rowsAffected>0;return i&&o(e,n[0].path,n[0].owner),i}async function O(e,t){await v();let n=r(),{rows:i}=await n.execute({sql:`SELECT id FROM resources WHERE owner = ? AND path = ?`,args:[e,t]});if(i.length===0)return!1;let a=(await n.execute({sql:`DELETE FROM resources WHERE owner = ? AND path = ?`,args:[e,t]})).rowsAffected>0;return a&&o(i[0].id,t,e),a}async function k(e,t){await v();let n=r();if(t){let{rows:r}=await n.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?`,args:[e,t+`%`]});return r.map(C)}let{rows:i}=await n.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?`,args:[e]});return i.map(C)}async function A(e,t){await v();let n=r();if(t){let{rows:r}=await n.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?
            UNION
            SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?`,args:[e,t+`%`,`__shared__`,t+`%`]});return r.map(C)}let{rows:i}=await n.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?
          UNION
          SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?`,args:[e,`__shared__`]});return i.map(C)}async function j(e){await v();let{rows:t}=await r().execute({sql:`SELECT * FROM resources WHERE path LIKE ?`,args:[e+`%`]});return t.map(S)}async function M(e,t){await v();let n=r(),i=Date.now(),{rows:a}=await n.execute({sql:`SELECT path, owner FROM resources WHERE id = ?`,args:[e]});if(a.length===0)return!1;let o=(await n.execute({sql:`UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,args:[t,i,e]})).rowsAffected>0;return o&&s(e,t,a[0].owner),o}export{T as a,j as c,l as d,w as i,M as l,D as n,k as o,O as r,A as s,x as t,E as u};