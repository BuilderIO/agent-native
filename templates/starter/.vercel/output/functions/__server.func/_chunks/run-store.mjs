import{n as e}from"../_runtime.mjs";import{i as t,l as n,o as r}from"./client.mjs";var i=e({RUN_STALE_MS:()=>6e3,cleanupOldRuns:()=>v,getRunById:()=>h,getRunByThread:()=>g,getRunEventsSince:()=>m,insertRun:()=>s,insertRunEvent:()=>p,isRunAborted:()=>f,markRunAborted:()=>d,reapAllStaleRuns:()=>_,reapIfStale:()=>l,updateRunHeartbeat:()=>c,updateRunStatus:()=>u});let a;async function o(){return a||=(async()=>{let e=t();await e.execute(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          started_at ${r()} NOT NULL,
          completed_at ${r()},
          heartbeat_at ${r()}
        )
      `);try{n()?await e.execute(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS heartbeat_at ${r()}`):await e.execute(`ALTER TABLE agent_runs ADD COLUMN heartbeat_at ${r()}`)}catch{}await e.execute(`
        CREATE TABLE IF NOT EXISTS agent_run_events (
          run_id TEXT NOT NULL,
          seq ${r()} NOT NULL,
          event_data TEXT NOT NULL,
          PRIMARY KEY (run_id, seq)
        )
      `)})(),a}async function s(e,n){await o();let r=t(),i=Date.now();await r.execute({sql:`INSERT INTO agent_runs (id, thread_id, status, started_at, heartbeat_at) VALUES (?, ?, 'running', ?, ?)`,args:[e,n,i,i]})}async function c(e){await o(),await t().execute({sql:`UPDATE agent_runs SET heartbeat_at = ? WHERE id = ?`,args:[Date.now(),e]})}async function l(e,n=6e3){await o();let r=t(),i=Date.now()-n,{rowsAffected:a}=await r.execute({sql:`UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE id = ?
            AND status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,args:[Date.now(),e,i]});return(a??0)>0}async function u(e,n){await o(),await t().execute({sql:`UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?`,args:[n,Date.now(),e]})}async function d(e){await o(),await t().execute({sql:`UPDATE agent_runs SET status = 'aborted', completed_at = ? WHERE id = ?`,args:[Date.now(),e]})}async function f(e){await o();let{rows:n}=await t().execute({sql:`SELECT status FROM agent_runs WHERE id = ?`,args:[e]});return n.length>0&&n[0].status===`aborted`}async function p(e,n,r){await o(),await t().execute({sql:`INSERT INTO agent_run_events (run_id, seq, event_data) VALUES (?, ?, ?)`,args:[e,n,r]})}async function m(e,n){await o();let{rows:r}=await t().execute({sql:`SELECT seq, event_data FROM agent_run_events WHERE run_id = ? AND seq >= ? ORDER BY seq ASC`,args:[e,n]});return r.map(e=>{let t=e;return{seq:Number(t.seq),eventData:t.event_data}})}async function h(e){await o();let{rows:n}=await t().execute({sql:`SELECT id, thread_id, status, started_at FROM agent_runs WHERE id = ?`,args:[e]});if(n.length===0)return null;let r=n[0];return{id:r.id,threadId:r.thread_id,status:r.status,startedAt:Number(r.started_at)}}async function g(e){await o();let{rows:n}=await t().execute({sql:`SELECT id, thread_id, status, started_at, heartbeat_at FROM agent_runs WHERE thread_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`,args:[e]});if(n.length===0)return null;let r=n[0];return{id:r.id,threadId:r.thread_id,status:r.status,startedAt:Number(r.started_at),heartbeatAt:r.heartbeat_at==null?null:Number(r.heartbeat_at)}}async function _(){await o();let e=t(),n=Date.now()-6e3,{rowsAffected:r}=await e.execute({sql:`UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,args:[Date.now(),n]});return r??0}async function v(e){await o();let n=t(),r=Date.now()-e;await n.execute({sql:`UPDATE agent_runs SET status = 'errored', completed_at = ? WHERE status = 'running' AND started_at < ?`,args:[Date.now(),r]});let i=Date.now()-6e3;await n.execute({sql:`UPDATE agent_runs
          SET status = 'errored', completed_at = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, started_at) < ?`,args:[Date.now(),i]}),await n.execute({sql:`DELETE FROM agent_run_events WHERE run_id IN (
      SELECT id FROM agent_runs WHERE status != 'running' AND completed_at < ?
    )`,args:[r]}),await n.execute({sql:`DELETE FROM agent_runs WHERE status != 'running' AND completed_at < ?`,args:[r]})}export{s as a,d as c,c as d,u as f,m as i,l,h as n,p as o,g as r,f as s,v as t,i as u};