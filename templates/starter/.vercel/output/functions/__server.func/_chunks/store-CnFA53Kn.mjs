import{i as e,l as t,o as n}from"./client-DU--QVjD.mjs";var r=[{match:/opus/i,pricing:{input:1500,output:7500,cacheRead:150,cacheWrite:1875}},{match:/haiku/i,pricing:{input:100,output:500,cacheRead:10,cacheWrite:125}},{match:/.*/,pricing:{input:300,output:1500,cacheRead:30,cacheWrite:375}}];function i(e){for(let t of r)if(t.match.test(e))return t.pricing;return r[r.length-1].pricing}var a;async function o(){return a||=(async()=>{let r=e();await r.execute(`
        CREATE TABLE IF NOT EXISTS token_usage (
          id ${n()} PRIMARY KEY,
          owner_email TEXT NOT NULL,
          input_tokens ${n()} NOT NULL DEFAULT 0,
          output_tokens ${n()} NOT NULL DEFAULT 0,
          cache_read_tokens ${n()} NOT NULL DEFAULT 0,
          cache_write_tokens ${n()} NOT NULL DEFAULT 0,
          cost_cents_x100 ${n()} NOT NULL DEFAULT 0,
          model TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT 'chat',
          app TEXT NOT NULL DEFAULT '',
          created_at ${n()} NOT NULL
        )
      `);let i=[[`cache_read_tokens`,`${n()} NOT NULL DEFAULT 0`],[`cache_write_tokens`,`${n()} NOT NULL DEFAULT 0`],[`label`,`TEXT NOT NULL DEFAULT 'chat'`],[`app`,`TEXT NOT NULL DEFAULT ''`]];for(let[e,n]of i)try{t()?await r.execute(`ALTER TABLE token_usage ADD COLUMN IF NOT EXISTS ${e} ${n}`):await r.execute(`ALTER TABLE token_usage ADD COLUMN ${e} ${n}`)}catch{}try{await r.execute(`CREATE INDEX IF NOT EXISTS idx_token_usage_owner_created ON token_usage (owner_email, created_at)`)}catch{}})(),a}function s(e,t,n,r=0,a=0){let o=i(n),s=(e,t)=>Math.round(e/1e6*t*100);return s(e,o.input)+s(t,o.output)+s(r,o.cacheRead)+s(a,o.cacheWrite)}async function c(t,n,r,i){let{ownerEmail:a,inputTokens:c,outputTokens:l,cacheReadTokens:u=0,cacheWriteTokens:d=0,model:f,label:p,app:m}=typeof t==`string`?{ownerEmail:t,inputTokens:n??0,outputTokens:r??0,model:i??``}:t;if(!c&&!l&&!u&&!d)return;await o();let h=e(),g=s(c,l,f,u,d),_=Date.now()*1e3+Math.floor(Math.random()*1e3),v=m??process.env.AGENT_APP??``,y=p??`chat`;await h.execute({sql:`INSERT INTO token_usage
      (id, owner_email, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents_x100, model, label, app, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,args:[_,a,c,l,u,d,g,f,y,v,Date.now()]})}async function l(t){await o();let{rows:n}=await e().execute({sql:`SELECT COALESCE(SUM(cost_cents_x100), 0) as total FROM token_usage WHERE owner_email = ?`,args:[t]});return Number(n[0]?.total??0)/100}async function u(e,t){let n=t??100,r=await l(e);return{allowed:r<n,usageCents:r,limitCents:n}}var d=864e5;async function f(t){await o();let n=e(),r=t.sinceMs??Date.now()-30*d,i=(await n.execute({sql:`SELECT
      COALESCE(SUM(cost_cents_x100), 0) AS cents,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens), 0) AS in_tok,
      COALESCE(SUM(output_tokens), 0) AS out_tok,
      COALESCE(SUM(cache_read_tokens), 0) AS cr_tok,
      COALESCE(SUM(cache_write_tokens), 0) AS cw_tok
      FROM token_usage WHERE owner_email = ? AND created_at >= ?`,args:[t.ownerEmail,r]})).rows[0]??{},a=e=>({sql:`SELECT ${e} AS k,
        COALESCE(SUM(cost_cents_x100), 0) AS cents,
        COUNT(*) AS calls,
        COALESCE(SUM(input_tokens), 0) AS in_tok,
        COALESCE(SUM(output_tokens), 0) AS out_tok,
        COALESCE(SUM(cache_read_tokens), 0) AS cr_tok,
        COALESCE(SUM(cache_write_tokens), 0) AS cw_tok
      FROM token_usage
      WHERE owner_email = ? AND created_at >= ?
      GROUP BY ${e}
      ORDER BY cents DESC`,args:[t.ownerEmail,r]}),s=e=>e.map(e=>{let t=e;return{key:String(t.k??``),cents:Number(t.cents??0)/100,calls:Number(t.calls??0),inputTokens:Number(t.in_tok??0),outputTokens:Number(t.out_tok??0),cacheReadTokens:Number(t.cr_tok??0),cacheWriteTokens:Number(t.cw_tok??0)}}),[c,l,u]=await Promise.all([n.execute(a(`label`)),n.execute(a(`model`)),n.execute(a(`app`))]),f=await n.execute({sql:`SELECT created_at, cost_cents_x100 FROM token_usage
      WHERE owner_email = ? AND created_at >= ?`,args:[t.ownerEmail,r]}),p=new Map;for(let e of f.rows){let t=new Date(Number(e.created_at)).toISOString().slice(0,10),n=p.get(t)??{cents:0,calls:0};n.cents+=Number(e.cost_cents_x100??0),n.calls+=1,p.set(t,n)}let m=[...p.entries()].map(([e,t])=>({date:e,cents:t.cents/100,calls:t.calls})).sort((e,t)=>e.date.localeCompare(t.date)),h=(await n.execute({sql:`SELECT id, created_at, label, app, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cost_cents_x100
      FROM token_usage
      WHERE owner_email = ?
      ORDER BY created_at DESC
      LIMIT 50`,args:[t.ownerEmail]})).rows.map(e=>({id:Number(e.id),createdAt:Number(e.created_at),label:String(e.label??`chat`),app:String(e.app??``),model:String(e.model??``),inputTokens:Number(e.input_tokens??0),outputTokens:Number(e.output_tokens??0),cacheReadTokens:Number(e.cache_read_tokens??0),cacheWriteTokens:Number(e.cache_write_tokens??0),cents:Number(e.cost_cents_x100??0)/100}));return{totalCents:Number(i.cents??0)/100,totalCalls:Number(i.calls??0),totalInputTokens:Number(i.in_tok??0),totalOutputTokens:Number(i.out_tok??0),totalCacheReadTokens:Number(i.cr_tok??0),totalCacheWriteTokens:Number(i.cw_tok??0),sinceMs:r,byLabel:s(c.rows),byModel:s(l.rows),byApp:s(u.rows),byDay:m,recent:h}}export{s as calculateCost,u as checkUsageLimit,f as getUsageSummary,c as recordUsage};