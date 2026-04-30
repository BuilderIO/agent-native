import{n as e}from"../_runtime.mjs";import{i as t,o as n}from"./client.mjs";var r=e({hasOAuthTokens:()=>s,listOAuthAccountsByOwner:()=>o});let i;async function a(){return i||=(async()=>{let e=t();await e.execute(`
        CREATE TABLE IF NOT EXISTS oauth_tokens (
          provider TEXT NOT NULL,
          account_id TEXT NOT NULL,
          owner TEXT,
          tokens TEXT NOT NULL,
          updated_at ${n()} NOT NULL,
          PRIMARY KEY (provider, account_id)
        )
      `);try{await e.execute(`ALTER TABLE oauth_tokens ADD COLUMN owner TEXT`)}catch{}try{await e.execute(`ALTER TABLE oauth_tokens ADD COLUMN display_name TEXT`)}catch{}await e.execute(`UPDATE oauth_tokens SET owner = account_id WHERE owner IS NULL`)})(),i}async function o(e,n){await a();let{rows:r}=await t().execute({sql:`SELECT account_id, display_name, tokens FROM oauth_tokens WHERE provider = ? AND owner = ?`,args:[e,n]});return r.map(e=>({accountId:e.account_id,displayName:e.display_name??null,tokens:JSON.parse(e.tokens)}))}async function s(e,n){await a();let r=t();if(n===`local@localhost`){let{rows:t}=await r.execute({sql:`SELECT 1 FROM oauth_tokens WHERE provider = ? LIMIT 1`,args:[e]});return t.length>0}let{rows:i}=await r.execute({sql:`SELECT 1 FROM oauth_tokens WHERE provider = ? AND owner = ? LIMIT 1`,args:[e,n]});return i.length>0}export{o as n,r,s as t};