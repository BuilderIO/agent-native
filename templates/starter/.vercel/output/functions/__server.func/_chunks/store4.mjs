import{n as e}from"../_runtime.mjs";import{d as t,i as n,l as r,o as i}from"./client.mjs";import{n as a,t as o}from"./emitter.mjs";import s from"crypto";var c=e({SHARED_OWNER:()=>`__shared__`,ensurePersonalDefaults:()=>b,resourceDelete:()=>E,resourceDeleteByPath:()=>D,resourceGet:()=>C,resourceGetByPath:()=>w,resourceList:()=>O,resourceListAccessible:()=>k,resourceListAllOwners:()=>A,resourceMove:()=>j,resourcePut:()=>T});const l=`__shared__`;let u;const d=`# Learnings

User preferences, corrections, and patterns. The agent reads this at the start of every conversation.

Keep this file tidy — revise, consolidate, and remove outdated entries. Don't just append forever.

## Preferences

## Corrections

## Patterns
`,f=`# My Learnings

Personal preferences, corrections, and patterns — only visible to you.

## Preferences

## Corrections

## Patterns
`,p=`---
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
`,m=`---
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
`,h=`# Agent Instructions

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
`,g=`# My Agent Instructions

Personal agent instructions — only visible to you. Use this for your own contacts, preferences, and context.

## Contacts

Add people you frequently interact with so the agent can resolve names like "email my wife" or "message John":

| Name | Email | Notes |
|------|-------|-------|
| *(add your contacts here)* | | |

## Preferences

## Context
`;async function _(){return u||=v().catch(e=>{throw u=void 0,e}),u}async function v(){let e=n();await t(()=>e.execute(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        owner TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT 'text/markdown',
        size ${i()} NOT NULL DEFAULT 0,
        created_at ${i()} NOT NULL,
        updated_at ${i()} NOT NULL,
        UNIQUE(path, owner)
      )
    `));let a=Date.now(),o=r()?`INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`:`INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,c=Buffer.byteLength(h,`utf8`);await e.execute({sql:o,args:[s.randomUUID(),`AGENTS.md`,`__shared__`,h,`text/markdown`,c,a,a]});let l=Buffer.byteLength(d,`utf8`);await e.execute({sql:o,args:[s.randomUUID(),`LEARNINGS.md`,`__shared__`,d,`text/markdown`,l,a,a]});let u=Buffer.byteLength(m,`utf8`);await e.execute({sql:o,args:[s.randomUUID(),`skills/learn-shared.md`,`__shared__`,m,`text/markdown`,u,a,a]});try{let{getBuiltinAgents:t,BUILTIN_AGENTS_FOR_SEEDING:n}=await import(`./agent-discovery.mjs`).then(e=>e.t),r=n;for(let t of r){let n=JSON.stringify({id:t.id,name:t.name,description:t.description,url:t.url,color:t.color},null,2),r=Buffer.byteLength(n,`utf8`);await e.execute({sql:o,args:[s.randomUUID(),`remote-agents/${t.id}.json`,`__shared__`,n,`application/json`,r,a,a]})}}catch{}try{let t=(await e.execute({sql:`SELECT id, path FROM resources WHERE path LIKE ? AND path LIKE ?`,args:[`agents/%`,`%.json`]})).rows??[];for(let n of t){let t=n.path.replace(/^agents\//,`remote-agents/`);try{await e.execute({sql:`UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,args:[t,Date.now(),n.id]})}catch{}}}catch{}}const y=new Set;async function b(e){if(e===`__shared__`||y.has(e))return;y.add(e),await _();let t=n(),i=Date.now(),a=r()?`INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`:`INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,o=Buffer.byteLength(g,`utf8`);await t.execute({sql:a,args:[s.randomUUID(),`AGENTS.md`,e,g,`text/markdown`,o,i,i]});let c=Buffer.byteLength(f,`utf8`);await t.execute({sql:a,args:[s.randomUUID(),`LEARNINGS.md`,e,f,`text/markdown`,c,i,i]});let l=`# Memory Index
`,u=Buffer.byteLength(l,`utf8`);await t.execute({sql:a,args:[s.randomUUID(),`memory/MEMORY.md`,e,l,`text/markdown`,u,i,i]});let d=Buffer.byteLength(p,`utf8`);await t.execute({sql:a,args:[s.randomUUID(),`skills/learn.md`,e,p,`text/markdown`,d,i,i]})}function x(e){return{id:e.id,path:e.path,owner:e.owner,content:e.content,mimeType:e.mime_type,size:e.size,createdAt:e.created_at,updatedAt:e.updated_at}}function S(e){return{id:e.id,path:e.path,owner:e.owner,mimeType:e.mime_type,size:e.size,createdAt:e.created_at,updatedAt:e.updated_at}}async function C(e){await _();let{rows:t}=await n().execute({sql:`SELECT * FROM resources WHERE id = ?`,args:[e]});return t.length===0?null:x(t[0])}async function w(e,t){await _();let{rows:r}=await n().execute({sql:`SELECT * FROM resources WHERE owner = ? AND path = ?`,args:[e,t]});return r.length===0?null:x(r[0])}async function T(e,t,i,a,c){await _();let l=n(),u=Date.now(),d=Buffer.byteLength(i,`utf8`),f=a||`text/markdown`,{rows:p}=await l.execute({sql:`SELECT id, created_at FROM resources WHERE owner = ? AND path = ?`,args:[e,t]}),m=p.length>0?p[0].id:s.randomUUID(),h=p.length>0?p[0].created_at:u;return await l.execute({sql:r()?`INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO UPDATE SET id=EXCLUDED.id, content=EXCLUDED.content, mime_type=EXCLUDED.mime_type, size=EXCLUDED.size, updated_at=EXCLUDED.updated_at`:`INSERT OR REPLACE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,args:[m,t,e,i,f,d,h,u]}),o(m,t,e,c?.requestSource),{id:m,path:t,owner:e,content:i,mimeType:f,size:d,createdAt:h,updatedAt:u}}async function E(e){await _();let t=n(),{rows:r}=await t.execute({sql:`SELECT path, owner FROM resources WHERE id = ?`,args:[e]});if(r.length===0)return!1;let i=(await t.execute({sql:`DELETE FROM resources WHERE id = ?`,args:[e]})).rowsAffected>0;return i&&a(e,r[0].path,r[0].owner),i}async function D(e,t){await _();let r=n(),{rows:i}=await r.execute({sql:`SELECT id FROM resources WHERE owner = ? AND path = ?`,args:[e,t]});if(i.length===0)return!1;let o=(await r.execute({sql:`DELETE FROM resources WHERE owner = ? AND path = ?`,args:[e,t]})).rowsAffected>0;return o&&a(i[0].id,t,e),o}async function O(e,t){await _();let r=n();if(t){let{rows:n}=await r.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?`,args:[e,t+`%`]});return n.map(S)}let{rows:i}=await r.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?`,args:[e]});return i.map(S)}async function k(e,t){await _();let r=n();if(t){let{rows:n}=await r.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?
            UNION
            SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ? AND path LIKE ?`,args:[e,t+`%`,`__shared__`,t+`%`]});return n.map(S)}let{rows:i}=await r.execute({sql:`SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?
          UNION
          SELECT id, path, owner, mime_type, size, created_at, updated_at FROM resources WHERE owner = ?`,args:[e,`__shared__`]});return i.map(S)}async function A(e){await _();let{rows:t}=await n().execute({sql:`SELECT * FROM resources WHERE path LIKE ?`,args:[e+`%`]});return t.map(x)}async function j(e,t){await _();let r=n(),i=Date.now(),{rows:a}=await r.execute({sql:`SELECT path, owner FROM resources WHERE id = ?`,args:[e]});if(a.length===0)return!1;let s=(await r.execute({sql:`UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,args:[t,i,e]})).rowsAffected>0;return s&&o(e,t,a[0].owner),s}export{C as a,k as c,T as d,c as f,D as i,A as l,b as n,w as o,E as r,O as s,l as t,j as u};