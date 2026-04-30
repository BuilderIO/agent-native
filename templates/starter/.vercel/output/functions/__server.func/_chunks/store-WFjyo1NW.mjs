import{n as e}from"../_runtime.mjs";import{r as t}from"./chunk-D3zDcpJC.mjs";import{i as n,o as r}from"./client-DU--QVjD.mjs";var i=e({n:()=>c,r:()=>a,t:()=>l}),a=t({hasOAuthTokens:()=>l,listOAuthAccountsByOwner:()=>c}),o;async function s(){return o||=(async()=>{let e=n();await e.execute(`
        CREATE TABLE IF NOT EXISTS oauth_tokens (
          provider TEXT NOT NULL,
          account_id TEXT NOT NULL,
          owner TEXT,
          tokens TEXT NOT NULL,
          updated_at ${r()} NOT NULL,
          PRIMARY KEY (provider, account_id)
        )
      `);try{await e.execute(`ALTER TABLE oauth_tokens ADD COLUMN owner TEXT`)}catch{}try{await e.execute(`ALTER TABLE oauth_tokens ADD COLUMN display_name TEXT`)}catch{}await e.execute(`UPDATE oauth_tokens SET owner = account_id WHERE owner IS NULL`)})(),o}async function c(e,t){await s();let{rows:r}=await n().execute({sql:`SELECT account_id, display_name, tokens FROM oauth_tokens WHERE provider = ? AND owner = ?`,args:[e,t]});return r.map(e=>({accountId:e.account_id,displayName:e.display_name??null,tokens:JSON.parse(e.tokens)}))}async function l(e,t){await s();let r=n();if(t===`local@localhost`){let{rows:t}=await r.execute({sql:`SELECT 1 FROM oauth_tokens WHERE provider = ? LIMIT 1`,args:[e]});return t.length>0}let{rows:i}=await r.execute({sql:`SELECT 1 FROM oauth_tokens WHERE provider = ? AND owner = ? LIMIT 1`,args:[e,t]});return i.length>0}export{c as n,i as r,l as t};