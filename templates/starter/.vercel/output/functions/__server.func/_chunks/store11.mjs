import{i as e,l as t}from"./client.mjs";import{d as n,i as r,k as i,o as a}from"../_libs/@better-auth/drizzle-adapter+[...].mjs";import{i as o,n as s}from"./request-context.mjs";import{i as c,n as l,r as u,t as d}from"./schema.mjs";import{n as f,r as p}from"./access.mjs";import{t as m}from"./create-get-db.mjs";import{h,m as g}from"./schema3.mjs";import{randomUUID as _}from"node:crypto";const v=u(`tool_slots`,{id:c(`id`).primaryKey(),toolId:c(`tool_id`).notNull(),slotId:c(`slot_id`).notNull(),config:c(`config`),createdAt:c(`created_at`).notNull().default(l())}),y=u(`tool_slot_installs`,{id:c(`id`).primaryKey(),toolId:c(`tool_id`).notNull(),slotId:c(`slot_id`).notNull(),ownerEmail:c(`owner_email`).notNull(),orgId:c(`org_id`),position:d(`position`).notNull().default(0),config:c(`config`),createdAt:c(`created_at`).notNull().default(l()),updatedAt:c(`updated_at`).notNull().default(l())}),b=m({tools:h,toolShares:g,toolSlots:v,toolSlotInstalls:y});let x;async function S(){return x||=(async()=>{let n=e(),r=t();await n.execute(r?`CREATE TABLE IF NOT EXISTS tool_slots (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT now()
)`:`CREATE TABLE IF NOT EXISTS tool_slots (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`),await n.execute(`CREATE INDEX IF NOT EXISTS tool_slots_by_slot_idx ON tool_slots (slot_id)`),await n.execute(`CREATE INDEX IF NOT EXISTS tool_slots_by_tool_idx ON tool_slots (tool_id)`),await n.execute(`CREATE UNIQUE INDEX IF NOT EXISTS tool_slots_unique_idx ON tool_slots (tool_id, slot_id)`),await n.execute(r?`CREATE TABLE IF NOT EXISTS tool_slot_installs (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  updated_at TEXT NOT NULL DEFAULT now()
)`:`CREATE TABLE IF NOT EXISTS tool_slot_installs (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`),await n.execute(`CREATE INDEX IF NOT EXISTS tool_slot_installs_by_user_slot_idx ON tool_slot_installs (owner_email, slot_id)`),await n.execute(`CREATE UNIQUE INDEX IF NOT EXISTS tool_slot_installs_unique_idx ON tool_slot_installs (owner_email, tool_id, slot_id)`)})(),x}async function C(e,t,n){await S(),await p(`tool`,e,`editor`);let i=b(),o=_(),s=new Date().toISOString(),c={id:o,toolId:e,slotId:t,config:n??null,createdAt:s};try{await i.insert(v).values(c)}catch(n){if(String(n?.message??n).toLowerCase().includes(`unique`)){let n=await i.select().from(v).where(r(a(v.toolId,e),a(v.slotId,t)));if(n[0])return n[0]}throw n}return c}async function w(e,t){return await S(),await p(`tool`,e,`editor`),await b().delete(v).where(r(a(v.toolId,e),a(v.slotId,t))),!0}async function T(e){return await S(),await p(`tool`,e,`viewer`),await b().select().from(v).where(a(v.toolId,e))}async function E(e){await S();let t=b(),i=await t.select({id:h.id,name:h.name,description:h.description,icon:h.icon}).from(h).where(f(h,g));if(i.length===0)return[];let o=i.map(e=>e.id),s=await t.select().from(v).where(r(a(v.slotId,e),n(v.toolId,o))),c=new Map(i.map(e=>[e.id,e]));return s.map(e=>{let t=c.get(e.toolId);return{toolId:e.toolId,name:t.name,description:t.description,icon:t.icon,config:e.config}})}async function D(e,t,n){await S(),await p(`tool`,e,`viewer`);let o=j(),c=s(),l=b(),u=await l.select().from(y).where(r(a(y.ownerEmail,o),a(y.toolId,e),a(y.slotId,t)));if(u[0])return u[0];let d=_(),f=new Date().toISOString(),m=n?.position;if(m===void 0){let e=await l.select({pos:i`MAX(${y.position})`}).from(y).where(r(a(y.ownerEmail,o),a(y.slotId,t))),n=Number(e[0]?.pos??-1);m=Number.isFinite(n)?n+1:0}let h={id:d,toolId:e,slotId:t,ownerEmail:o,orgId:c??null,position:m,config:n?.config??null,createdAt:f,updatedAt:f};return await l.insert(y).values(h),h}async function O(e,t){await S();let n=j();return await b().delete(y).where(r(a(y.ownerEmail,n),a(y.toolId,e),a(y.slotId,t))),!0}async function k(e){await S();let t=j(),n=b(),i=await n.select().from(y).where(r(a(y.ownerEmail,t),a(y.slotId,e)));if(i.length===0)return[];let o=await n.select({id:h.id,name:h.name,description:h.description,icon:h.icon,updatedAt:h.updatedAt}).from(h).where(f(h,g)),s=new Map(o.map(e=>[e.id,e]));return i.filter(e=>s.has(e.toolId)).sort((e,t)=>e.position-t.position).map(e=>{let t=s.get(e.toolId);return{installId:e.id,toolId:e.toolId,name:t.name,description:t.description,icon:t.icon,updatedAt:t.updatedAt,position:e.position,config:e.config}})}async function A(e){await S();let t=b();await t.delete(v).where(a(v.toolId,e)),await t.delete(y).where(a(y.toolId,e))}function j(){let e=o();if(!e)throw Error(`Slot operations require an authenticated user.`);return e}export{C as addToolSlotTarget,A as cascadeDeleteToolSlots,S as ensureSlotTables,D as installToolSlot,k as listSlotInstallsForUser,T as listSlotsForTool,E as listToolsForSlot,w as removeToolSlotTarget,O as uninstallToolSlot};