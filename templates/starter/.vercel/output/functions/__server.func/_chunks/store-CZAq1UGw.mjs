import{i as e,o as t}from"./client-DU--QVjD.mjs";var n;async function r(){return n||=(async()=>{await e().execute(`
        CREATE TABLE IF NOT EXISTS agent_checkpoints (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          run_id TEXT,
          commit_sha TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          created_at ${t()} NOT NULL
        )
      `)})(),n}async function i(t,n,i,a,o){await r(),await e().execute({sql:`INSERT INTO agent_checkpoints (id, thread_id, run_id, commit_sha, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,args:[t,n,i,a,o,Date.now()]})}async function a(t){await r();let{rows:n}=await e().execute({sql:`SELECT id, thread_id, run_id, commit_sha, message, created_at FROM agent_checkpoints WHERE thread_id = ? ORDER BY created_at DESC`,args:[t]});return n.map(e=>({id:e.id,threadId:e.thread_id,runId:e.run_id,commitSha:e.commit_sha,message:e.message,createdAt:e.created_at}))}async function o(t){await r();let{rows:n}=await e().execute({sql:`SELECT id, thread_id, run_id, commit_sha, message, created_at FROM agent_checkpoints WHERE id = ?`,args:[t]});if(n.length===0)return null;let i=n[0];return{id:i.id,threadId:i.thread_id,runId:i.run_id,commitSha:i.commit_sha,message:i.message,createdAt:i.created_at}}export{o as getCheckpointById,a as getCheckpointsByThread,i as insertCheckpoint};