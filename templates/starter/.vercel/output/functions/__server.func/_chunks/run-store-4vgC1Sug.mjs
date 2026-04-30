import{n as e}from"../_runtime.mjs";import{r as t}from"./chunk-D3zDcpJC.mjs";import{i as n,l as r,o as i}from"./client-DU--QVjD.mjs";var a=e({a:()=>u,c:()=>m,d:()=>d,f:()=>p,i:()=>_,l:()=>f,n:()=>v,o:()=>g,r:()=>y,s:()=>h,t:()=>x,u:()=>o}),o=t({RUN_STALE_MS:()=>c,cleanupOldRuns:()=>x,getRunById:()=>v,getRunByThread:()=>y,getRunEventsSince:()=>_,insertRun:()=>u,insertRunEvent:()=>g,isRunAborted:()=>h,markRunAborted:()=>m,reapAllStaleRuns:()=>b,reapIfStale:()=>f,updateRunHeartbeat:()=>d,updateRunStatus:()=>p}),s,c=6e3;async function l(){return s||=(async()=>{let e=n();await e.execute(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          started_at ${i()} NOT NULL,
          completed_at ${i()},
          heartbeat_at ${i()}
        )
      `);try{r()?await e.execute(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS heartbeat_at ${i()}`):await e.execute(`ALTER TABLE agent_runs ADD COLUMN heartbeat_at ${i()}`)}catch{}await e.execute(`
        CREATE TABLE IF NOT EXISTS agent_run_events (
          run_id TEXT NOT NULL,
          seq ${i()} NOT NULL,
          event_data TEXT NOT NULL,
          PRIMARY KEY (run_id, seq)
        )
      `)})(),s}async function u(e,t){await l();let r=n(),i=Date.now();await r.execute({sql:`INSERT INTO agent_runs (id, thread_id, status, started_at, heartbeat_at) VALUES (?, ?, 'running', ?, ?)`,args:[e,t,i,i]})}async function d(e){await l(),await n().execute({sql:`UPDATE agent_runs SET heartbeat_at = ? WHERE id = ?`,args:[Date.now(),e]})}async function f(e,t=c){await l();let r=n(),i=Date.now()-t,{rowsAffected:a}=await r.execute({sql:`UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE id = ?
            AND status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,args:[Date.now(),e,i]});return(a??0)>0}async function p(e,t){await l(),await n().execute({sql:`UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?`,args:[t,Date.now(),e]})}async function m(e){await l(),await n().execute({sql:`UPDATE agent_runs SET status = 'aborted', completed_at = ? WHERE id = ?`,args:[Date.now(),e]})}async function h(e){await l();let{rows:t}=await n().execute({sql:`SELECT status FROM agent_runs WHERE id = ?`,args:[e]});return t.length>0&&t[0].status===`aborted`}async function g(e,t,r){await l(),await n().execute({sql:`INSERT INTO agent_run_events (run_id, seq, event_data) VALUES (?, ?, ?)`,args:[e,t,r]})}async function _(e,t){await l();let{rows:r}=await n().execute({sql:`SELECT seq, event_data FROM agent_run_events WHERE run_id = ? AND seq >= ? ORDER BY seq ASC`,args:[e,t]});return r.map(e=>{let t=e;return{seq:Number(t.seq),eventData:t.event_data}})}async function v(e){await l();let{rows:t}=await n().execute({sql:`SELECT id, thread_id, status, started_at FROM agent_runs WHERE id = ?`,args:[e]});if(t.length===0)return null;let r=t[0];return{id:r.id,threadId:r.thread_id,status:r.status,startedAt:Number(r.started_at)}}async function y(e){await l();let{rows:t}=await n().execute({sql:`SELECT id, thread_id, status, started_at, heartbeat_at FROM agent_runs WHERE thread_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,args:[e]});if(t.length===0)return null;let r=t[0];return{id:r.id,threadId:r.thread_id,status:r.status,startedAt:Number(r.started_at),heartbeatAt:r.heartbeat_at==null?null:Number(r.heartbeat_at)}}async function b(){await l();let e=n(),t=Date.now()-c,{rowsAffected:r}=await e.execute({sql:`UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,args:[Date.now(),t]});return r??0}async function x(e){await l();let t=n(),r=Date.now()-e;await t.execute({sql:`UPDATE agent_runs SET status = 'errored', completed_at = ? WHERE status = 'running' AND started_at < ?`,args:[Date.now(),r]});let i=Date.now()-c;await t.execute({sql:`UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,args:[Date.now(),i]}),await t.execute({sql:`DELETE FROM agent_run_events WHERE run_id IN (
      SELECT id FROM agent_runs WHERE status != 'running' AND completed_at < ?
    )`,args:[r]}),await t.execute({sql:`DELETE FROM agent_runs WHERE status != 'running' AND completed_at < ?`,args:[r]})}export{u as a,m as c,d,p as f,_ as i,f as l,v as n,g as o,y as r,h as s,x as t,a as u};