import{n as e}from"../_runtime.mjs";import{i as t,l as n,o as r}from"./client.mjs";var i=e({DEFAULT_USAGE_LIMIT_CENTS:()=>100,calculateCost:()=>l,checkUsageLimit:()=>f,getUsageSummary:()=>p,getUserUsageCents:()=>d,recordUsage:()=>u});const a=[{match:/opus/i,pricing:{input:1500,output:7500,cacheRead:150,cacheWrite:1875}},{match:/haiku/i,pricing:{input:100,output:500,cacheRead:10,cacheWrite:125}},{match:/.*/,pricing:{input:300,output:1500,cacheRead:30,cacheWrite:375}}];function o(e){for(let t of a)if(t.match.test(e))return t.pricing;return a[a.length-1].pricing}let s;async function c(){return s||=(async()=>{let e=t();await e.execute(`
        CREATE TABLE IF NOT EXISTS token_usage (
          id ${r()} PRIMARY KEY,
          owner_email TEXT NOT NULL,
          input_tokens ${r()} NOT NULL DEFAULT 0,
          output_tokens ${r()} NOT NULL DEFAULT 0,
          cache_read_tokens ${r()} NOT NULL DEFAULT 0,
          cache_write_tokens ${r()} NOT NULL DEFAULT 0,
          cost_cents_x100 ${r()} NOT NULL DEFAULT 0,
          model TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT 'chat',
          app TEXT NOT NULL DEFAULT '',
          created_at ${r()} NOT NULL
        )
      `);let i=[[`cache_read_tokens`,`${r()} NOT NULL DEFAULT 0`],[`cache_write_tokens`,`${r()} NOT NULL DEFAULT 0`],[`label`,`TEXT NOT NULL DEFAULT 'chat'`],[`app`,`TEXT NOT NULL DEFAULT ''`]];for(let[t,r]of i)try{n()?await e.execute(`ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS ${t} ${r}`):await e.execute(`ALTER TABLE token_usage ADD COLUMN ${t} ${r}`)}catch{}try{await e.execute(`CREATE INDEX IF NOT EXISTS idx_token_usage_owner_created ON token_usage (owner_email, created_at)`)}catch{}})(),s}function l(e,t,n,r=0,i=0){let a=o(n),s=(e,t)=>Math.round(e/1e6*t*100);return s(e,a.input)+s(t,a.output)+s(r,a.cacheRead)+s(i,a.cacheWrite)}async function u(e,n,r,i){let{ownerEmail:a,inputTokens:o,outputTokens:s,cacheReadTokens:u=0,cacheWriteTokens:d=0,model:f,label:p,app:m}=typeof e==`string`?{ownerEmail:e,inputTokens:n??0,outputTokens:r??0,model:i??``}:e;if(!o&&!s&&!u&&!d)return;await c();let h=t(),g=l(o,s,f,u,d),_=Date.now()*1e3+Math.floor(Math.random()*1e3),v=m??process.env.AGENT_APP??``,y=p??`chat`;await h.execute({sql:`INSERT INTO token_usage
      (id, owner_email, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents_x100, model, label, app, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,args:[_,a,o,s,u,d,g,f,y,v,Date.now()]})}async function d(e){await c();let{rows:n}=await t().execute({sql:`SELECT COALESCE(SUM(cost_cents_x100), 0) as total FROM token_usage WHERE owner_email = ?`,args:[e]});return Number(n[0]?.total??0)/100}async function f(e,t){let n=t??100,r=await d(e);return{allowed:r<n,usageCents:r,limitCents:n}}async function p(e){await c();let n=t(),r=e.sinceMs??Date.now()-30*864e5,i=(await n.execute({sql:`SELECT
      COALESCE(SUM(cost_cents_x100), 0) AS cents,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0) AS in_tok,
      COALESCE(SUM(output_tokens), 0) AS out_tok,
      COALESCE(SUM(cache_read_tokens), 0) AS cr_tok,
      COALESCE(SUM(cache_write_tokens), 0) AS cw_tok
      FROM token_usage WHERE owner_email = ? AND created_at >= ?`,args:[e.ownerEmail,r]})).rows[0]??{},a=t=>({sql:`SELECT ${t} AS k,
        COALESCE(SUM(cost_cents_x100), 0) AS cents,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS in_tok,
        COALESCE(SUM(output_tokens), 0) AS out_tok,
        COALESCE(SUM(cache_read_tokens), 0) AS cr_tok,
        COALESCE(SUM(cache_write_tokens), 0) AS cw_tok
      FROM token_usage
      WHERE owner_email = ? AND created_at >= ?
      GROUP BY ${t}
      ORDER BY cents DESC`,args:[e.ownerEmail,r]}),o=e=>e.map(e=>{let t=e;return{key:String(t.k??``),cents:Number(t.cents??0)/100,calls:Number(t.calls??0),inputTokens:Number(t.in_tok??0),outputTokens:Number(t.out_tok??0),cacheReadTokens:Number(t.cr_tok??0),cacheWriteTokens:Number(t.cw_tok??0)}}),[s,l,u]=await Promise.all([n.execute(a(`label`)),n.execute(a(`model`)),n.execute(a(`app`))]),d=await n.execute({sql:`SELECT created_at, cost_cents_x100 FROM token_usage
      WHERE owner_email = ? AND created_at >= ?`,args:[e.ownerEmail,r]}),f=new Map;for(let e of d.rows){let t=new Date(Number(e.created_at)).toISOString().slice(0,10),n=f.get(t)??{cents:0,calls:0};n.cents+=Number(e.cost_cents_x100??0),n.calls+=1,f.set(t,n)}let p=[...f.entries()].map(([e,t])=>({date:e,cents:t.cents/100,calls:t.calls})).sort((e,t)=>e.date.localeCompare(t.date)),m=(await n.execute({sql:`SELECT id, created_at, label, app, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_cents_x100
      FROM token_usage
      WHERE owner_email = ?
      ORDER BY created_at DESC
      LIMIT 50`,args:[e.ownerEmail]})).rows.map(e=>({id:Number(e.id),createdAt:Number(e.created_at),label:String(e.label??`chat`),app:String(e.app??``),model:String(e.model??``),inputTokens:Number(e.input_tokens??0),outputTokens:Number(e.output_tokens??0),cacheReadTokens:Number(e.cache_read_tokens??0),cacheWriteTokens:Number(e.cache_write_tokens??0),cents:Number(e.cost_cents_x100??0)/100}));return{totalCents:Number(i.cents??0)/100,totalCalls:Number(i.calls??0),totalInputTokens:Number(i.in_tok??0),totalOutputTokens:Number(i.out_tok??0),totalCacheReadTokens:Number(i.cr_tok??0),totalCacheWriteTokens:Number(i.cw_tok??0),sinceMs:r,byLabel:o(s.rows),byModel:o(l.rows),byApp:o(u.rows),byDay:p,recent:m}}export{i as t};