import{i as e,n as t}from"./request-context-60tSGHqu.mjs";import{i as n,l as r}from"./client-DU--QVjD.mjs";import{w as i}from"./sql-CUJcAdo0.mjs";import{c as a,r as o,t as s}from"./conditions-Bwwcbq-Z.mjs";import{t as c}from"./create-get-db-Bv94_7uE.mjs";import{i as l,o as u,r as d,s as f}from"./schema-BX63SDAB.mjs";import{n as p,r as m}from"./access-CAuQympt.mjs";import{h,m as g}from"./schema-I0TbBH60.mjs";import{randomUUID as _}from"node:crypto";var v=u(`tool_slots`,{id:f(`id`).primaryKey(),toolId:f(`tool_id`).notNull(),slotId:f(`slot_id`).notNull(),config:f(`config`),createdAt:f(`created_at`).notNull().default(l())}),y=u(`tool_slot_installs`,{id:f(`id`).primaryKey(),toolId:f(`tool_id`).notNull(),slotId:f(`slot_id`).notNull(),ownerEmail:f(`owner_email`).notNull(),orgId:f(`org_id`),position:d(`position`).notNull().default(0),config:f(`config`),createdAt:f(`created_at`).notNull().default(l()),updatedAt:f(`updated_at`).notNull().default(l())}),b=`CREATE TABLE IF NOT EXISTS tool_slots (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,x=`CREATE TABLE IF NOT EXISTS tool_slots (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT now()
)`,S=`CREATE INDEX IF NOT EXISTS tool_slots_by_slot_idx ON tool_slots (slot_id)`,C=`CREATE INDEX IF NOT EXISTS tool_slots_by_tool_idx ON tool_slots (tool_id)`,w=`CREATE UNIQUE INDEX IF NOT EXISTS tool_slots_unique_idx ON tool_slots (tool_id, slot_id)`,T=`CREATE TABLE IF NOT EXISTS tool_slot_installs (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,E=`CREATE TABLE IF NOT EXISTS tool_slot_installs (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
)`,D=`CREATE INDEX IF NOT EXISTS tool_slot_installs_by_user_slot_idx ON tool_slot_installs (owner_email, slot_id)`,O=`CREATE UNIQUE INDEX IF NOT EXISTS tool_slot_installs_unique_idx ON tool_slot_installs (owner_email, tool_id, slot_id)`,k=c({tools:h,toolShares:g,toolSlots:v,toolSlotInstalls:y}),A;async function j(){return A||=(async()=>{let e=n(),t=r();await e.execute(t?x:b),await e.execute(S),await e.execute(C),await e.execute(w),await e.execute(t?E:T),await e.execute(D),await e.execute(O)})(),A}async function M(e,t,n){await j(),await m(`tool`,e,`editor`);let r=k(),i=_(),a=new Date().toISOString(),c={id:i,toolId:e,slotId:t,config:n??null,createdAt:a};try{await r.insert(v).values(c)}catch(n){if(String(n?.message??n).toLowerCase().includes(`unique`)){let n=await r.select().from(v).where(s(o(v.toolId,e),o(v.slotId,t)));if(n[0])return n[0]}throw n}return c}async function N(e,t){return await j(),await m(`tool`,e,`editor`),await k().delete(v).where(s(o(v.toolId,e),o(v.slotId,t))),!0}async function P(e){return await j(),await m(`tool`,e,`viewer`),await k().select().from(v).where(o(v.toolId,e))}async function F(e){await j();let t=k(),n=await t.select({id:h.id,name:h.name,description:h.description,icon:h.icon}).from(h).where(p(h,g));if(n.length===0)return[];let r=n.map(e=>e.id),i=await t.select().from(v).where(s(o(v.slotId,e),a(v.toolId,r))),c=new Map(n.map(e=>[e.id,e]));return i.map(e=>{let t=c.get(e.toolId);return{toolId:e.toolId,name:t.name,description:t.description,icon:t.icon,config:e.config}})}async function I(e,n,r){await j(),await m(`tool`,e,`viewer`);let a=B(),c=t(),l=k(),u=await l.select().from(y).where(s(o(y.ownerEmail,a),o(y.toolId,e),o(y.slotId,n)));if(u[0])return u[0];let d=_(),f=new Date().toISOString(),p=r?.position;if(p===void 0){let e=await l.select({pos:i`MAX(${y.position})`}).from(y).where(s(o(y.ownerEmail,a),o(y.slotId,n))),t=Number(e[0]?.pos??-1);p=Number.isFinite(t)?t+1:0}let h={id:d,toolId:e,slotId:n,ownerEmail:a,orgId:c??null,position:p,config:r?.config??null,createdAt:f,updatedAt:f};return await l.insert(y).values(h),h}async function L(e,t){await j();let n=B();return await k().delete(y).where(s(o(y.ownerEmail,n),o(y.toolId,e),o(y.slotId,t))),!0}async function R(e){await j();let t=B(),n=k(),r=await n.select().from(y).where(s(o(y.ownerEmail,t),o(y.slotId,e)));if(r.length===0)return[];let i=await n.select({id:h.id,name:h.name,description:h.description,icon:h.icon,updatedAt:h.updatedAt}).from(h).where(p(h,g)),a=new Map(i.map(e=>[e.id,e]));return r.filter(e=>a.has(e.toolId)).sort((e,t)=>e.position-t.position).map(e=>{let t=a.get(e.toolId);return{installId:e.id,toolId:e.toolId,name:t.name,description:t.description,icon:t.icon,updatedAt:t.updatedAt,position:e.position,config:e.config}})}async function z(e){await j();let t=k();await t.delete(v).where(o(v.toolId,e)),await t.delete(y).where(o(y.toolId,e))}function B(){let t=e();if(!t)throw Error(`Slot operations require an authenticated user.`);return t}export{M as addToolSlotTarget,z as cascadeDeleteToolSlots,j as ensureSlotTables,I as installToolSlot,R as listSlotInstallsForUser,P as listSlotsForTool,F as listToolsForSlot,N as removeToolSlotTarget,L as uninstallToolSlot};