import{n as e}from"../_runtime.mjs";import{C as t,S as n,b as r,c as i,d as a,f as o,h as s,l as c,m as l,o as u,u as d,x as f}from"../_libs/h3+rou3+srvx.mjs";import{t as p}from"./h3-helpers.mjs";import{a as ee,c as m,d as te,i as h,l as ne,n as re,o as ie,r as ae}from"./client.mjs";import{a as oe,i as se,o as ce,r as le}from"../_libs/better-auth+defu.mjs";import{i as ue,r as de,t as fe}from"./store.mjs";import{c as g,d as _,f as v,l as y,m as pe,s as b,u as x}from"../_libs/drizzle-orm+postgres.mjs";import S from"node:crypto";import C from"node:path";import w from"node:fs";import me from"node:os";function he(){return!!(process.env.RESEND_API_KEY||process.env.SENDGRID_API_KEY)}function ge(){return process.env.RESEND_API_KEY?`resend`:process.env.SENDGRID_API_KEY?`sendgrid`:`dev`}function _e(e,t){let n=e||process.env.EMAIL_FROM;if(n)return n;if(t===`sendgrid`)throw Error(`EMAIL_FROM is required when using SendGrid — set it to a verified sender address.`);return`Agent Native <onboarding@resend.dev>`}async function ve(e){let t=ge(),n=_e(e.from,t);if(t===`resend`){let t={from:n,to:e.to,subject:e.subject,html:e.html,text:e.text};e.cc&&(t.cc=Array.isArray(e.cc)?e.cc:[e.cc]),e.replyTo&&(t.reply_to=e.replyTo),e.attachments?.length&&(t.attachments=e.attachments.map(e=>({filename:e.filename,content:typeof e.content==`string`?e.content:e.content.toString(`base64`),content_type:e.contentType})));let r={};e.inReplyTo&&(r[`In-Reply-To`]=e.inReplyTo),e.references&&(r.References=e.references),Object.keys(r).length&&(t.headers=r);let i=await fetch(`https://api.resend.com/emails`,{method:`POST`,headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":`application/json`},body:JSON.stringify(t)});if(!i.ok){let e=await i.text().catch(()=>``);throw Error(`Resend error ${i.status}: ${e}`)}return}if(t===`sendgrid`){let t={to:[{email:e.to}]};e.cc&&(t.cc=(Array.isArray(e.cc)?e.cc:[e.cc]).map(e=>({email:e})));let r={personalizations:[t],from:ye(n),subject:e.subject,content:[...e.text?[{type:`text/plain`,value:e.text}]:[],{type:`text/html`,value:e.html}]};e.replyTo&&(r.reply_to=ye(e.replyTo));let i={};e.inReplyTo&&(i[`In-Reply-To`]=e.inReplyTo),e.references&&(i.References=e.references),Object.keys(i).length&&(r.headers=i),e.attachments?.length&&(r.attachments=e.attachments.map(e=>({filename:e.filename,content:typeof e.content==`string`?Buffer.from(e.content).toString(`base64`):e.content.toString(`base64`),type:e.contentType})));let a=await fetch(`https://api.sendgrid.com/v3/mail/send`,{method:`POST`,headers:{Authorization:`Bearer ${process.env.SENDGRID_API_KEY}`,"Content-Type":`application/json`},body:JSON.stringify(r)});if(!a.ok){let e=await a.text().catch(()=>``);throw Error(`SendGrid error ${a.status}: ${e}`)}return}if(process.env.NODE_ENV===`production`)throw Error(`No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY.`);console.log(`
[agent-native:email] No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY to send real emails.
---\nTo: ${e.to}\nFrom: ${n}\nSubject: ${e.subject}\n\n${e.text||be(e.html)}\n---\n`)}function ye(e){let t=e.match(/^\s*(.*?)\s*<(.+)>\s*$/);return t&&t[2]?{name:t[1]||void 0,email:t[2]}:{email:e.trim()}}function be(e){return e.replace(/<br\s*\/?>/gi,`
`).replace(/<\/p>/gi,`

`).replace(/<[^>]+>/g,``).replace(/&nbsp;/g,` `).trim()}function T(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`)}function xe(e){return T(e)}function Se(e){if(e)return/^#[0-9a-fA-F]{6}$/.test(e)?e:void 0}function Ce(e){let t=e.preheader||``,n=Se(e.brandColor),r=n??`#fafafa`,i=n?`#ffffff`:`#0a0a0c`,a=n??`#a1a1aa`,o=e.paragraphs.map(e=>`<p style="margin:0 0 16px 0; font-size:16px; line-height:1.6; color:#d4d4d8;">${e}</p>`).join(``),s=e.cta?`
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">
        <tr>
          <td style="border-radius:10px; background:${r};">
            <a href="${xe(e.cta.url)}"
               style="display:inline-block; padding:14px 26px; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:15px; font-weight:600; color:${i}; text-decoration:none; border-radius:10px;">
              ${T(e.cta.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0; font-size:13px; line-height:1.5; color:#71717a; word-break:break-all;">
        Or paste this link into your browser:<br/>
        <a href="${xe(e.cta.url)}" style="color:${a}; text-decoration:none;">${T(e.cta.url)}</a>
      </p>
    `:``,c=e.footer?`<p style="margin:28px 0 0 0; font-size:13px; line-height:1.5; color:#71717a;">${T(e.footer)}</p>`:``,l=`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <meta name="supported-color-schemes" content="dark light" />
    <title>${T(e.heading)}</title>
    <style>
      @media (prefers-color-scheme: light) {
        .bg-outer { background-color: #0a0a0c !important; }
      }
      a { color: ${a}; }
    </style>
  </head>
  <body style="margin:0; padding:0; background-color:#0a0a0c; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing:antialiased;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      ${T(t)}
    </div>
    <table role="presentation" class="bg-outer" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0a0a0c; padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
            <tr>
              <td style="background-color:#141417; border:1px solid #27272a; border-radius:16px; padding:36px 36px 32px 36px;">
                <h1 style="margin:0 0 20px 0; font-size:24px; line-height:1.3; font-weight:600; color:#fafafa; letter-spacing:-0.02em;">
                  ${T(e.heading)}
                </h1>
                ${o}
                ${s}
                ${c}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,u=[];u.push(e.heading),u.push(``);for(let t of e.paragraphs)u.push(we(t)),u.push(``);return e.cta&&(u.push(`${e.cta.label}: ${e.cta.url}`),u.push(``)),e.footer&&u.push(e.footer),{html:l,text:u.join(`
`).trim()}}function we(e){return e.replace(/<br\s*\/?>/gi,`
`).replace(/<[^>]+>/g,``).replace(/&nbsp;/g,` `).replace(/&amp;/g,`&`).replace(/&lt;/g,`<`).replace(/&gt;/g,`>`).replace(/&quot;/g,`"`).replace(/&#39;/g,`'`).trim()}function E(e){return`<strong style="color:#fafafa; font-weight:600;">${T(e)}</strong>`}const Te=[{name:`mail`,label:`Mail`,hint:`Agent-native Superhuman — email client with keyboard shortcuts and AI triage`,icon:`Mail`,color:`#3B82F6`,colorRgb:`59 130 246`,devPort:8085,prodUrl:`https://mail.agent-native.com`,defaultMode:`prod`,core:!0},{name:`calendar`,label:`Calendar`,hint:`Agent-native Google Calendar — manage events, sync, and public booking`,icon:`CalendarDays`,color:`#8B5CF6`,colorRgb:`139 92 246`,devPort:8082,prodUrl:`https://calendar.agent-native.com`,defaultMode:`prod`,requiredPackages:[`scheduling`],core:!0},{name:`content`,label:`Content`,hint:`Agent-native Notion/Google Docs — write and organize with agent assistance`,icon:`FileText`,color:`#10B981`,colorRgb:`16 185 129`,devPort:8083,prodUrl:`https://content.agent-native.com`,defaultMode:`prod`,core:!0},{name:`slides`,label:`Slides`,hint:`Agent-native Google Slides — generate and edit React presentations`,icon:`GalleryHorizontal`,color:`#EC4899`,colorRgb:`236 72 153`,devPort:8086,prodUrl:`https://slides.agent-native.com`,defaultMode:`prod`,core:!0},{name:`videos`,label:`Video`,hint:`Agent-native video editing with Remotion`,icon:`Video`,color:`#EF4444`,colorRgb:`239 68 68`,devPort:8087,prodUrl:`https://videos.agent-native.com`,defaultMode:`prod`,core:!0},{name:`analytics`,label:`Analytics`,hint:`Agent-native Amplitude/Mixpanel — connect data sources, prompt for charts`,icon:`BarChart2`,color:`#F59E0B`,colorRgb:`245 158 11`,devPort:8088,prodUrl:`https://analytics.agent-native.com`,defaultMode:`prod`,core:!0},{name:`dispatch`,label:`Dispatch`,hint:`Central Slack/Telegram router with jobs, memory, approvals, and A2A delegation`,icon:`MessageCircle`,color:`#14B8A6`,colorRgb:`20 184 166`,devPort:8092,prodUrl:`https://dispatch.agent-native.com`,defaultMode:`prod`,core:!0},{name:`forms`,label:`Forms`,hint:`Agent-native form builder — create, edit, and manage forms`,icon:`ClipboardList`,color:`#06B6D4`,colorRgb:`6 182 212`,devPort:8084,prodUrl:`https://forms.agent-native.com`,defaultMode:`prod`,core:!0},{name:`issues`,label:`Issues`,hint:`Agent-native Jira — project management and issue tracking`,icon:`BrandJira`,color:`#6366F1`,colorRgb:`99 102 241`,devPort:8091,prodUrl:`https://issues.agent-native.com`,defaultMode:`dev`},{name:`recruiting`,label:`Recruiting`,hint:`Agent-native Greenhouse — manage candidates and recruiting pipelines`,icon:`Users`,color:`#16A34A`,colorRgb:`22 163 74`,devPort:8090,prodUrl:`https://recruiting.agent-native.com`,defaultMode:`dev`},{name:`starter`,label:`Starter`,hint:`Minimal scaffold with the agent chat and core architecture wired up`,icon:`Code`,color:`#71717A`,colorRgb:`113 113 122`,devPort:8089,defaultMode:`prod`,alwaysAvailable:!0,core:!0},{name:`clips`,label:`Clips`,hint:`Async screen recording — record, transcribe, share`,icon:`ScreenShare`,color:`#625DF5`,colorRgb:`98 93 245`,devPort:8094,prodUrl:`https://clips.agent-native.com`,defaultMode:`prod`,core:!0},{name:`design`,label:`Design`,hint:`Agent-native design tool — create and edit visual designs with agent assistance`,icon:`Brush`,color:`#F472B6`,colorRgb:`244 114 182`,devPort:8099,prodUrl:`https://design.agent-native.com`,defaultMode:`prod`,core:!0},{name:`calls`,label:`Calls`,hint:`Agent-native Gong — record, transcribe, and analyze sales calls`,icon:`Phone`,color:`#111111`,colorRgb:`17 17 17`,devPort:8095,prodUrl:`https://calls.agent-native.com`,defaultMode:`prod`},{name:`meeting-notes`,label:`Meeting Notes`,hint:`AI meeting notes — transcribe, enhance, and share meeting notes`,icon:`Note`,color:`#16A34A`,colorRgb:`22 163 74`,devPort:8096,prodUrl:`https://meeting-notes.agent-native.com`,defaultMode:`prod`},{name:`scheduling`,label:`Scheduling`,hint:`Full scheduling app — event types, team round-robin, routing forms, workflows`,icon:`CalendarTime`,color:`#7C3AED`,colorRgb:`124 58 237`,devPort:8098,prodUrl:`https://scheduling.agent-native.com`,defaultMode:`prod`,requiredPackages:[`scheduling`]},{name:`voice`,label:`Voice`,hint:`Voice dictation — speak to type anywhere with context-aware formatting`,icon:`Microphone`,color:`#8B5CF6`,colorRgb:`139 92 246`,devPort:8097,prodUrl:`https://voice.agent-native.com`,defaultMode:`prod`},{name:`macros`,label:`Macros`,hint:`Internal template — not shown in pickers`,icon:`Code`,color:`#71717A`,colorRgb:`113 113 122`,devPort:8093,hidden:!0,defaultMode:`dev`}];let Ee=null;function De(){try{let e=C.join(process.cwd(),`package.json`);return JSON.parse(w.readFileSync(e,`utf8`))}catch{return null}}function Oe(e){return e.split(/[-_\s]+/).filter(Boolean).map(e=>e[0].toUpperCase()+e.slice(1)).join(` `)}function ke(){if(process.env.APP_NAME)return process.env.APP_NAME;if(Ee!==null)return Ee??void 0;let e=De(),t;if(e?.displayName)t=e.displayName;else if(e?.name){let n=Te.find(t=>t.name===e.name);t=n?n.label||Oe(n.name):void 0}return Ee=t??void 0,t}function D(e){return e.replace(/[\r\n]+/g,` `).trim()}function Ae(){return D(ke()||`Agent Native`)}function je(e){let t=D(e.invitee),n=D(e.orgName||`your team`),r=D(e.inviter),i=Ae(),a=i?` on ${i}`:``,{html:o,text:s}=Ce({preheader:`${r} invited you to join ${n}${a}.`,heading:`You're invited to join ${n}`,paragraphs:[`${E(r)} invited you to join ${E(n)}${i?` on ${E(i)}`:``}.`,`Sign in with ${E(t)} to accept the invitation.`],cta:{label:`Accept invitation`,url:e.acceptUrl},footer:`If you weren't expecting this, you can safely ignore this email.`});return{subject:`${r} invited you to join ${n}${a}`,html:o,text:s}}function Me(e){let t=D(e.email),n=Ae(),{html:r,text:i}=Ce({preheader:`Confirm ${t} to finish setting up your ${n} account.`,heading:`Verify your email for ${n}`,paragraphs:[`Thanks for signing up for ${E(n)}. To finish creating your account, confirm that ${E(t)} is your email address.`,`This link expires in 1 hour.`],cta:{label:`Verify email`,url:e.verifyUrl},footer:`If you didn't sign up, you can safely ignore this email.`});return{subject:`Verify your email for ${n}`,html:r,text:i}}function Ne(e){let t=D(e.email),n=Ae(),{html:r,text:i}=Ce({preheader:`Reset the password for ${t}. This link expires in 1 hour.`,heading:`Reset your ${n} password`,paragraphs:[`Someone requested a password reset for ${E(t)}. Click the button below to choose a new password.`,`This link expires in 1 hour.`],cta:{label:`Reset password`,url:e.resetUrl},footer:`If you didn't request this, you can safely ignore this email — your password won't change.`});return{subject:`Reset your ${n} password`,html:r,text:i}}let O=null;function Pe(){if(O!==null)return O??void 0;try{let e=C.join(process.cwd(),`package.json`),t=JSON.parse(w.readFileSync(e,`utf8`)),n=typeof t?.name==`string`?t.name:void 0;O=n&&Te.some(e=>e.name===n)?n:void 0}catch{O=void 0}return O??void 0}function Fe(e){return e.replace(/\/+$/,``)}function Ie(){let e=Pe();if(e)return Te.find(t=>t.name===e)?.prodUrl}function Le(e){let t=process.env.APP_URL||process.env.BETTER_AUTH_URL;if(t)return Fe(t);if(e)try{let t=s(e);return`${t.protocol}//${t.host}`}catch{}if(process.env.NODE_ENV===`production`||!m()){let e=Ie();if(e)return Fe(e)}return`http://localhost:3000`}function Re(e,t){return`u:${e}:${t}`}async function ze(e,t){return de(Re(e,t))}async function Be(e,t,n,r){return ue(Re(e,t),n,r)}async function Ve(e,t,n){return fe(Re(e,t),n)}const He=()=>globalThis.crypto?.randomUUID?.().replace(/-/g,``)??Math.random().toString(36).slice(2)+Date.now().toString(36);async function Ue(e){let t=e.trim().toLowerCase();if(!t||t===`local@localhost`)return{accepted:[],activeOrgId:null};let n=h(),r=[];try{r=(await n.execute({sql:`SELECT id, org_id AS "orgId" FROM org_invitations
            WHERE LOWER(email) = ? AND status = 'pending'
            ORDER BY created_at DESC`,args:[t]})).rows.map(e=>({id:String(e.id),orgId:String(e.orgId??e.org_id)}))}catch{return{accepted:[],activeOrgId:null}}if(r.length===0)return{accepted:[],activeOrgId:null};let i=[];for(let e of r)(await n.execute({sql:`SELECT 1 FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,args:[e.orgId,t]})).rows.length===0&&await n.execute({sql:`INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, 'member', ?)`,args:[He(),e.orgId,t,Date.now()]}),await n.execute({sql:`UPDATE org_invitations SET status = 'accepted' WHERE id = ?`,args:[e.id]}),i.push({invitationId:e.id,orgId:e.orgId});let a=i[0]?.orgId??null;if(a)try{await Be(t,`active-org-id`,{orgId:a})}catch{}return{accepted:i,activeOrgId:a}}function We(){if(process.env.BETTER_AUTH_SECRET)return process.env.BETTER_AUTH_SECRET;if(process.env.NODE_ENV===`production`){let e=S.randomBytes(32).toString(`hex`);throw Error(`[agent-native] BETTER_AUTH_SECRET is not set. This is required in production so signed session cookies stay valid across deploys. Set it as a deploy environment variable (any 32-byte hex string), e.g.:

  BETTER_AUTH_SECRET=${e}\n\nGenerate your own with \`openssl rand -hex 32\`. If you already have a running deploy on the legacy hardcoded fallback and need to preserve existing sessions, set BETTER_AUTH_SECRET=agent-native-local-dev-secret-k9x2m7q4w8 first, then rotate to a real value.`)}try{let e=C.resolve(process.cwd(),`.env.local`),t=Ge(e);if(t)return process.env.BETTER_AUTH_SECRET=t,t;let n=S.randomBytes(32).toString(`hex`);return Ke(e,n),process.env.BETTER_AUTH_SECRET=n,console.log(`[agent-native] Generated a persistent BETTER_AUTH_SECRET in .env.local. Sessions will now survive dev-server restarts. (Delete .env.local to rotate; set BETTER_AUTH_SECRET in .env to override.)`),n}catch{return process.env.GOOGLE_CLIENT_SECRET||process.env.ACCESS_TOKEN||`agent-native-local-dev-secret-k9x2m7q4w8`}}function Ge(e){try{return w.readFileSync(e,`utf8`).match(/^(?:export\s+)?BETTER_AUTH_SECRET\s*=\s*"?([^"\r\n]+)"?\s*$/m)?.[1]?.trim()||void 0}catch{return}}function Ke(e,t){let n=`BETTER_AUTH_SECRET=${t}\n`;if(w.existsSync(e)){let t=w.readFileSync(e,`utf8`),r=t.length>0&&!t.endsWith(`
`);w.appendFileSync(e,(r?`
`:``)+`
# Auto-generated by agent-native on first boot. Gitignored.
# Keeps signed session cookies valid across dev-server restarts.
# Delete this file (or this line) to rotate the secret.
`+n)}else w.writeFileSync(e,`# Auto-generated by agent-native on first boot. Gitignored.
# Keeps signed session cookies valid across dev-server restarts.
# Delete this file (or this line) to rotate the secret.
`+n,{mode:384})}function qe(){let e=process.env.AUTH_SKIP_EMAIL_VERIFICATION;if(e==null)return!1;let t=e.trim().toLowerCase();return t!==``&&t!==`0`&&t!==`false`}function Je(){return We()}let k,Ye,Xe;const A={user:x(`user`,{id:v(`id`).primaryKey(),name:v(`name`).notNull(),email:v(`email`).notNull().unique(),emailVerified:pe(`email_verified`).notNull().default(!1),image:v(`image`),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),updatedAt:_(`updated_at`,{withTimezone:!0}).notNull()}),session:x(`session`,{id:v(`id`).primaryKey(),expiresAt:_(`expires_at`,{withTimezone:!0}).notNull(),token:v(`token`).notNull().unique(),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),updatedAt:_(`updated_at`,{withTimezone:!0}).notNull(),ipAddress:v(`ip_address`),userAgent:v(`user_agent`),userId:v(`user_id`).notNull(),activeOrganizationId:v(`active_organization_id`)}),account:x(`account`,{id:v(`id`).primaryKey(),accountId:v(`account_id`).notNull(),providerId:v(`provider_id`).notNull(),userId:v(`user_id`).notNull(),accessToken:v(`access_token`),refreshToken:v(`refresh_token`),idToken:v(`id_token`),accessTokenExpiresAt:_(`access_token_expires_at`,{withTimezone:!0}),refreshTokenExpiresAt:_(`refresh_token_expires_at`,{withTimezone:!0}),scope:v(`scope`),password:v(`password`),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),updatedAt:_(`updated_at`,{withTimezone:!0}).notNull()}),verification:x(`verification`,{id:v(`id`).primaryKey(),identifier:v(`identifier`).notNull(),value:v(`value`).notNull(),expiresAt:_(`expires_at`,{withTimezone:!0}).notNull(),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),updatedAt:_(`updated_at`,{withTimezone:!0}).notNull()}),organization:x(`organization`,{id:v(`id`).primaryKey(),name:v(`name`).notNull(),slug:v(`slug`).notNull().unique(),logo:v(`logo`),metadata:v(`metadata`),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),updatedAt:_(`updated_at`,{withTimezone:!0}).notNull()}),member:x(`member`,{id:v(`id`).primaryKey(),organizationId:v(`organization_id`).notNull(),userId:v(`user_id`).notNull(),role:v(`role`).notNull().default(`member`),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),updatedAt:_(`updated_at`,{withTimezone:!0}).notNull()}),invitation:x(`invitation`,{id:v(`id`).primaryKey(),organizationId:v(`organization_id`).notNull(),email:v(`email`).notNull(),role:v(`role`),status:v(`status`).notNull().default(`pending`),expiresAt:_(`expires_at`,{withTimezone:!0}).notNull(),inviterId:v(`inviter_id`).notNull(),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),updatedAt:_(`updated_at`,{withTimezone:!0}).notNull()}),jwks:x(`jwks`,{id:v(`id`).primaryKey(),publicKey:v(`public_key`).notNull(),privateKey:v(`private_key`).notNull(),createdAt:_(`created_at`,{withTimezone:!0}).notNull(),expiresAt:_(`expires_at`,{withTimezone:!0})})},j={user:b(`user`,{id:g(`id`).primaryKey(),name:g(`name`).notNull(),email:g(`email`).notNull().unique(),emailVerified:y(`email_verified`,{mode:`boolean`}).notNull().default(!1),image:g(`image`),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),updatedAt:y(`updated_at`,{mode:`timestamp_ms`}).notNull()}),session:b(`session`,{id:g(`id`).primaryKey(),expiresAt:y(`expires_at`,{mode:`timestamp_ms`}).notNull(),token:g(`token`).notNull().unique(),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),updatedAt:y(`updated_at`,{mode:`timestamp_ms`}).notNull(),ipAddress:g(`ip_address`),userAgent:g(`user_agent`),userId:g(`user_id`).notNull(),activeOrganizationId:g(`active_organization_id`)}),account:b(`account`,{id:g(`id`).primaryKey(),accountId:g(`account_id`).notNull(),providerId:g(`provider_id`).notNull(),userId:g(`user_id`).notNull(),accessToken:g(`access_token`),refreshToken:g(`refresh_token`),idToken:g(`id_token`),accessTokenExpiresAt:y(`access_token_expires_at`,{mode:`timestamp_ms`}),refreshTokenExpiresAt:y(`refresh_token_expires_at`,{mode:`timestamp_ms`}),scope:g(`scope`),password:g(`password`),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),updatedAt:y(`updated_at`,{mode:`timestamp_ms`}).notNull()}),verification:b(`verification`,{id:g(`id`).primaryKey(),identifier:g(`identifier`).notNull(),value:g(`value`).notNull(),expiresAt:y(`expires_at`,{mode:`timestamp_ms`}).notNull(),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),updatedAt:y(`updated_at`,{mode:`timestamp_ms`}).notNull()}),organization:b(`organization`,{id:g(`id`).primaryKey(),name:g(`name`).notNull(),slug:g(`slug`).notNull().unique(),logo:g(`logo`),metadata:g(`metadata`),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),updatedAt:y(`updated_at`,{mode:`timestamp_ms`}).notNull()}),member:b(`member`,{id:g(`id`).primaryKey(),organizationId:g(`organization_id`).notNull(),userId:g(`user_id`).notNull(),role:g(`role`).notNull().default(`member`),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),updatedAt:y(`updated_at`,{mode:`timestamp_ms`}).notNull()}),invitation:b(`invitation`,{id:g(`id`).primaryKey(),organizationId:g(`organization_id`).notNull(),email:g(`email`).notNull(),role:g(`role`),status:g(`status`).notNull().default(`pending`),expiresAt:y(`expires_at`,{mode:`timestamp_ms`}).notNull(),inviterId:g(`inviter_id`).notNull(),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),updatedAt:y(`updated_at`,{mode:`timestamp_ms`}).notNull()}),jwks:b(`jwks`,{id:g(`id`).primaryKey(),publicKey:g(`public_key`).notNull(),privateKey:g(`private_key`).notNull(),createdAt:y(`created_at`,{mode:`timestamp_ms`}).notNull(),expiresAt:y(`expires_at`,{mode:`timestamp_ms`})})};async function Ze(){let e=h(),t=ne()?[`CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified BOOLEAN NOT NULL DEFAULT FALSE, image TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,`CREATE TABLE IF NOT EXISTS "session" (id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL, token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL, active_organization_id TEXT)`,`CREATE TABLE IF NOT EXISTS "account" (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at TIMESTAMPTZ, refresh_token_expires_at TIMESTAMPTZ, scope TEXT, password TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,`CREATE TABLE IF NOT EXISTS "verification" (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,`CREATE TABLE IF NOT EXISTS "organization" (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, logo TEXT, metadata TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,`CREATE TABLE IF NOT EXISTS "member" (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,`CREATE TABLE IF NOT EXISTS "invitation" (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT, status TEXT NOT NULL DEFAULT 'pending', expires_at TIMESTAMPTZ NOT NULL, inviter_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,`CREATE TABLE IF NOT EXISTS "jwks" (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ)`]:[`CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,`CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL, active_organization_id TEXT)`,`CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,`CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,`CREATE TABLE IF NOT EXISTS organization (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, logo TEXT, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,`CREATE TABLE IF NOT EXISTS member (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,`CREATE TABLE IF NOT EXISTS invitation (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT, status TEXT NOT NULL DEFAULT 'pending', expires_at INTEGER NOT NULL, inviter_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,`CREATE TABLE IF NOT EXISTS jwks (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER)`];for(let n of t)await e.execute(n)}async function M(e){return k||Ye||(Ye=$e(e),k=await Ye,k)}function Qe(){return k}async function $e(e){let t=ee(),n=e?.basePath??`/_agent-native/auth/ba`;await Ze();let r={...e?.socialProviders};process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&(r.google={clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET}),process.env.GITHUB_CLIENT_ID&&process.env.GITHUB_CLIENT_SECRET&&(r.github={clientId:process.env.GITHUB_CLIENT_ID,clientSecret:process.env.GITHUB_CLIENT_SECRET});let i=await et(t),a=We(),o=Le(),s=he()&&!qe();return ce({basePath:n,baseURL:o,database:i,secret:a,emailAndPassword:{enabled:!0,minPasswordLength:8,requireEmailVerification:s,sendResetPassword:async({user:e,token:t})=>{let n=`${o}${(process.env.VITE_APP_BASE_PATH||process.env.APP_BASE_PATH||``).replace(/\/$/,``)}/_agent-native/auth/reset?token=${encodeURIComponent(t)}`,{subject:r,html:i,text:a}=Ne({email:e.email,resetUrl:n});await ve({to:e.email,subject:r,html:i,text:a})}},emailVerification:{sendOnSignUp:s,autoSignInAfterVerification:!0,sendVerificationEmail:async({user:e,url:t})=>{let n=(process.env.VITE_APP_BASE_PATH||process.env.APP_BASE_PATH||``).replace(/\/$/,``),r=n?t.replace(/(\/\/[^/]+)(\/)/,`$1${n}$2`):t,{subject:i,html:a,text:o}=Me({email:e.email,verifyUrl:r});await ve({to:e.email,subject:i,html:a,text:o})}},socialProviders:r,account:{accountLinking:{enabled:!0,trustedProviders:[`google`,`github`]}},databaseHooks:{user:{create:{after:async e=>{let t=e?.email;if(t)try{await Ue(t)}catch(e){console.error(`[auth] failed to auto-accept pending invitations`,e)}}}}},session:{expiresIn:3600*24*30,updateAge:3600*24,cookieCache:{enabled:!0,maxAge:300}},advanced:{cookiePrefix:`an`,...o.startsWith(`https://`)?{defaultCookieAttributes:{sameSite:`none`,secure:!0,partitioned:!0}}:{}},plugins:[oe(),se({jwt:{issuer:o,expirationTime:`15m`}}),le(),...e?.plugins??[]]})}async function et(e){if(e===`postgres`){let e=ae(),{isNeonUrl:t}=await import(`./create-get-db.mjs`).then(e=>e.n);if(t(e)){let{Pool:t}=await import(`../_libs/neondatabase__serverless.mjs`).then(e=>e.i);Xe=new t({connectionString:e});let{drizzle:n}=await import(`../_libs/drizzle-orm+postgres.mjs`).then(e=>e.i),r=n(Xe,{schema:A}),{drizzleAdapter:i}=await import(`../_libs/better-auth+defu.mjs`).then(e=>e.n);return i(r,{provider:`pg`,schema:A})}let{default:n}=await import(`../_libs/drizzle-orm+postgres.mjs`).then(e=>e.r),r=n(e,{onnotice:()=>{},idle_timeout:240,max_lifetime:1800,connect_timeout:10,...e.includes(`supabase`)?{prepare:!1}:{}}),{drizzle:i}=await import(`../_libs/drizzle-orm+postgres.mjs`).then(e=>e.n),a=i(r,{schema:A}),{drizzleAdapter:o}=await import(`../_libs/better-auth+defu.mjs`).then(e=>e.n);return o(a,{provider:`pg`,schema:A})}let t=ae(`file:./data/app.db`);if(t.startsWith(`file:`)||!t.includes(`://`)){let{default:e}=await import(`better-sqlite3`),n=new e(t.replace(/^file:/,``));n.pragma(`journal_mode = WAL`);let{drizzle:r}=await import(`../_libs/drizzle-orm+postgres.mjs`).then(e=>e.o),i=r(n,{schema:j}),{drizzleAdapter:a}=await import(`../_libs/better-auth+defu.mjs`).then(e=>e.n);return a(i,{provider:`sqlite`,schema:j})}let{createClient:n}=await import(`../_libs/@libsql/client+[...].mjs`).then(e=>e.n),r=n({url:t,authToken:re()}),{drizzle:i}=await import(`../_libs/drizzle-orm+postgres.mjs`).then(e=>e.a),a=i(r,{schema:j}),{drizzleAdapter:o}=await import(`../_libs/better-auth+defu.mjs`).then(e=>e.n);return o(a,{provider:`sqlite`,schema:j})}function tt(){let e=process.env.NODE_ENV;return e!==`development`&&e!==`test`}function nt(){return!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET)}function rt(){let e=process.env.DATABASE_URL||``;return e?e.startsWith(`postgres://`)||e.startsWith(`postgresql://`)?e.includes(`neon.tech`)?`Neon Postgres`:e.includes(`supabase`)?`Supabase Postgres`:`Postgres`:e.startsWith(`file:`)?`SQLite (local file)`:e.startsWith(`libsql://`)||e.includes(`turso.io`)?`Turso`:`SQL database`:`SQLite (local file)`}const it=`an_migrate_from_local`;function N(e={}){let t=!tt()&&!e.googleOnly&&m(),n=nt(),r=!!e.googleOnly,i=t?`
  <div class="divider" id="local-divider">or</div>

  <button class="btn-secondary" id="local-btn" onclick="useLocally()">Use locally without an account</button>
  <p class="local-info" id="local-info">Skip auth for solo local development. You can create an account later.</p>`:``,a=t?`
  async function useLocally() {
    var btn = document.getElementById('local-btn');
    btn.disabled = true;
    btn.textContent = 'Setting up...';
    try {
      try {
        if (localStorage.getItem('${it}')) {
          localStorage.removeItem('${it}');
        }
      } catch (e) {}
      var res = await fetch(__anPath('/_agent-native/auth/local-mode'), { method: 'POST' });
      if (res.ok) {
        window.location.reload();
      } else {
        var data = await res.json().catch(function() { return {}; });
        var info = document.getElementById('local-info');
        if (info && data && data.error) {
          info.textContent = data.error;
          info.style.color = '#f87171';
        }
        btn.textContent = 'Not available';
        btn.disabled = true;
      }
    } catch(e) {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }`:``,o=e.marketing,s=!!o,c=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`),l=s?`
  body.has-marketing { padding: 0; position: relative; overflow-x: hidden; }
  #starfield {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.35;
    pointer-events: none;
    z-index: 0;
  }
  .split {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 100vh;
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
  }
  .marketing-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 3rem 3.5rem;
  }
  .marketing-content { max-width: 480px; }
  .app-name {
    font-size: 2rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 0.625rem;
    letter-spacing: -0.02em;
  }
  .app-tagline {
    font-size: 1.25rem;
    color: #a1a1aa;
    line-height: 1.6;
    margin-bottom: 2rem;
  }
  .app-desc {
    font-size: 1rem;
    color: #71717a;
    line-height: 1.6;
    margin-bottom: 2rem;
  }
  .feature-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }
  .feature-list li {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    font-size: 1rem;
    color: #a1a1aa;
    line-height: 1.5;
  }
  .feature-list li::before {
    content: '';
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    margin-top: 6px;
    border-radius: 50%;
    background: #3f3f46;
    border: 1px solid #52525b;
  }
  .oss-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    margin-top: 2rem;
    font-size: 0.8125rem;
    color: #71717a;
    text-decoration: none;
  }
  .oss-link:hover { color: #a1a1aa; }
  .oss-link svg { width: 15px; height: 15px; flex-shrink: 0; }
  .form-panel {
    flex: 0 0 440px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
  }
  .form-panel .card { max-width: 400px; }
  .form-panel .local-note { max-width: 400px; }
  @media (max-width: 900px) {
    .split { flex-direction: column; min-height: auto; }
    .marketing-panel { padding: 2rem 1.5rem 1.5rem; }
    .app-name { font-size: 1.375rem; }
    .app-tagline { font-size: 1rem; margin-bottom: 1rem; }
    .app-desc { margin-bottom: 1rem; }
    .feature-list { gap: 0.5rem; }
    .form-panel { flex: none; padding: 1.5rem 1rem; }
  }
`:``,u=s?`<canvas id="starfield"></canvas>
<div class="split">
  <div class="marketing-panel">
    <div class="marketing-content">
      <h2 class="app-name">${c(o.appName)}</h2>
      <p class="app-tagline">${c(o.tagline)}</p>
${o.description?`      <p class="app-desc">${c(o.description)}</p>\n`:``}${o.features?.length?`      <ul class="feature-list">\n${o.features.map(e=>`        <li>${c(e)}</li>`).join(`
`)}\n      </ul>\n`:``}      <a class="oss-link" href="https://github.com/BuilderIO/agent-native" target="_blank" rel="noreferrer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>
        Open source
      </a>
    </div>
  </div>
  <div class="form-panel">`:``,d=s?`
  </div>
</div>`:``,f=s?`
  (function initStarfield() {
    var canvas = document.getElementById('starfield');
    if (!canvas) return;
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, 'attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}');
    gl.compileShader(vs);

    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, [
      'precision highp float;',
      'uniform float iTime;uniform vec2 iResolution;',
      '#define S(a,b,t) smoothstep(a,b,t)',
      '#define NUM_LAYERS 4.',
      'float N21(vec2 p){vec3 a=fract(vec3(p.xyx)*vec3(213.897,653.453,253.098));a+=dot(a,a.yzx+79.76);return fract((a.x+a.y)*a.z);}',
      'vec2 GetPos(vec2 id,vec2 offs,float t){float n=N21(id+offs);float n1=fract(n*10.);float n2=fract(n*100.);float a=t+n;return offs+vec2(sin(a*n1),cos(a*n2))*.4;}',
      'float df_line(vec2 a,vec2 b,vec2 p){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}',
      'float line(vec2 a,vec2 b,vec2 uv){float r1=.025;float r2=.006;float d=df_line(a,b,uv);float d2=length(a-b);float fade=S(1.5,.5,d2);fade+=S(.05,.02,abs(d2-.75));return S(r1,r2,d)*fade;}',
      'float NetLayer(vec2 st,float n,float t){',
      '  vec2 id=floor(st)+n;st=fract(st)-.5;',
      '  vec2 p0=GetPos(id,vec2(-1,-1),t);vec2 p1=GetPos(id,vec2(0,-1),t);vec2 p2=GetPos(id,vec2(1,-1),t);',
      '  vec2 p3=GetPos(id,vec2(-1,0),t);vec2 p4=GetPos(id,vec2(0,0),t);vec2 p5=GetPos(id,vec2(1,0),t);',
      '  vec2 p6=GetPos(id,vec2(-1,1),t);vec2 p7=GetPos(id,vec2(0,1),t);vec2 p8=GetPos(id,vec2(1,1),t);',
      '  float m=0.;float sparkle=0.;float d;float s;float pulse;',
      '  m+=line(p4,p0,st);d=length(st-p0);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p0.x)+fract(p0.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p1,st);d=length(st-p1);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p1.x)+fract(p1.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p2,st);d=length(st-p2);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p2.x)+fract(p2.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p3,st);d=length(st-p3);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p3.x)+fract(p3.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p4,st);d=length(st-p4);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p4.x)+fract(p4.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p5,st);d=length(st-p5);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p5.x)+fract(p5.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p6,st);d=length(st-p6);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p6.x)+fract(p6.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p7,st);d=length(st-p7);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p7.x)+fract(p7.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p4,p8,st);d=length(st-p8);s=(.005/(d*d));s*=S(1.,.7,d);pulse=sin((fract(p8.x)+fract(p8.y)+t)*5.)*.4+.6;pulse=pow(pulse,20.);sparkle+=s*pulse;',
      '  m+=line(p1,p3,st);m+=line(p1,p5,st);m+=line(p7,p5,st);m+=line(p7,p3,st);',
      '  float sPhase=(sin(t+n)+sin(t*.1))*.25+.5;sPhase+=pow(sin(t*.1)*.5+.5,50.)*5.;m+=sparkle*sPhase;',
      '  return m;',
      '}',
      'void mainImage(out vec4 fragColor,in vec2 fragCoord){',
      '  vec2 uv=(fragCoord-iResolution.xy*.5)/iResolution.y;',
      '  float t=iTime*.03;float s=sin(t);float c=cos(t);mat2 rot=mat2(c,-s,s,c);vec2 st=uv*rot;',
      '  float m=0.;',
      '  for(float i=0.;i<1.;i+=1./NUM_LAYERS){float z=fract(t+i);float size=mix(15.,1.,z);float fade=S(0.,.6,z)*S(1.,.8,z);m+=fade*NetLayer(st*size,i,iTime*0.3);}',
      '  vec3 col=vec3(0.35)*m;col*=1.-dot(uv,uv);',
      '  float tt=min(iTime,5.0);col*=S(0.,20.,tt);',
      '  col=clamp(col,0.,1.);fragColor=vec4(col,1.);',
      '}',
      'void main(){mainImage(gl_FragColor,gl_FragCoord.xy);}'
    ].join('\\n'));
    gl.compileShader(fs);

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    var pos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, 'iTime');
    var uRes = gl.getUniformLocation(prog, 'iResolution');

    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      var dpr = Math.min(window.devicePixelRatio, 1.5);
      canvas.width = w * dpr; canvas.height = h * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    var start = performance.now(), last = 0;
    function render(now) {
      requestAnimationFrame(render);
      if (now - last < 33) return;
      last = now;
      gl.uniform1f(uTime, (now - start) * 0.001);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    requestAnimationFrame(render);
  })();`:``;return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>${s?c(o.appName)+` — Sign in`:`Welcome`}</title>
${s?`<meta name="description" content="${c(o.tagline)}">
<meta property="og:title" content="${c(o.appName)}">
<meta property="og:description" content="${c(o.tagline)}">`:``}
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .card {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
  }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  .tabs {
    display: inline-flex;
    width: 100%;
    padding: 4px;
    margin-bottom: 1.5rem;
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
  }
  .tab {
    flex: 1;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: #888;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
  }
  .tab.active {
    background: #1e1e1e;
    color: #fff;
    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
  }
  .tab:hover:not(.active) { color: #bbb; }
  .form { display: none; }
  .form.active { display: block; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    color: #e5e5e5;
    font-size: 0.875rem;
    outline: none;
    margin-bottom: 0.875rem;
  }
  input:focus { border-color: rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }
  input::placeholder { color: #555; }
  button[type="submit"], .btn-primary {
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  button[type="submit"]:hover, .btn-primary:hover { background: #e5e5e5; }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    width: 100%;
    margin-top: 0.75rem;
    padding: 0.5rem;
    background: transparent;
    color: #888;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-secondary:hover { color: #bbb; border-color: rgba(255,255,255,0.2); }
  .msg { margin-top: 0.75rem; font-size: 0.8125rem; display: none; }
  .msg.error { color: #f87171; }
  .msg.success { color: #4ade80; }
  .msg.show { display: block; }
  .divider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1.25rem 0;
    font-size: 0.75rem;
    color: #555;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.08);
  }
  .local-info {
    font-size: 0.75rem;
    color: #666;
    margin-top: 0.5rem;
    line-height: 1.4;
  }
  .upgrade-note {
    margin-bottom: 1rem;
    padding: 0.75rem;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    background: rgba(255,255,255,0.03);
    font-size: 0.75rem;
    line-height: 1.5;
    color: #a1a1aa;
    display: none;
  }
  .upgrade-note.show { display: block; }
  .btn-google {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.625rem;
    padding: 0.5rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 6px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-google:hover { background: #e5e5e5; }
  .btn-google:disabled { opacity: 0.5; cursor: wait; }
  .btn-google svg { width: 18px; height: 18px; flex-shrink: 0; }
  .google-error { margin-top: 0.5rem; font-size: 0.8125rem; color: #f87171; display: none; }
  .google-error.show { display: block; }
  .local-note {
    display: none;
    max-width: 400px;
    width: 100%;
    margin-top: 1rem;
    padding: 0.625rem 0.875rem;
    font-size: 0.6875rem;
    line-height: 1.5;
    color: #666;
    border: 1px dashed rgba(255,255,255,0.08);
    border-radius: 8px;
    text-align: center;
  }
  .local-note.show { display: block; }
  .local-note strong { color: #999; font-weight: 500; }
  .local-note a { color: #888; text-decoration: none; }
  .local-note a:hover { color: #bbb; }
${l}
</style>
</head>
<body${s?` class="has-marketing"`:``}>
${u}
<div class="card">
  <h1 id="heading">Welcome</h1>
  <p class="subtitle" id="subtitle">Create an account to get started</p>
  <p class="upgrade-note" id="upgrade-note">
    You started this flow from <code>local@localhost</code>. Continue signing in to upgrade this workspace to a real account and migrate your local data. If you want to cancel that and keep using local mode, use the secondary button below.
  </p>

${n?`
  <button class="btn-google" id="google-btn" onclick="signInWithGoogle()">
    <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    Sign in with Google
  </button>
  <p class="google-error" id="google-err"></p>
${r?``:`
  <div class="divider">or</div>
`}
`:r?`
  <p style="color:#f87171;font-size:0.875rem;text-align:center;padding:1rem 0">
    Google sign-in is not configured. Set <code>GOOGLE_CLIENT_ID</code> and
    <code>GOOGLE_CLIENT_SECRET</code> environment variables to enable login.
  </p>
`:``}
${r?``:`  <div class="tabs">
    <button class="tab" data-tab="signup">Create account</button>
    <button class="tab" data-tab="login">Sign in</button>
  </div>

  <form id="signup-form" class="form">
    <label for="s-email">Email</label>
    <input id="s-email" type="email" autocomplete="email" autofocus placeholder="you@example.com" required />
    <label for="s-pass">Password</label>
    <input id="s-pass" type="password" autocomplete="new-password" placeholder="At least 8 characters" required minlength="8" />
    <label for="s-pass2">Confirm password</label>
    <input id="s-pass2" type="password" autocomplete="new-password" placeholder="Confirm password" required minlength="8" />
    <button type="submit">Create account</button>
    <p class="msg" id="s-msg"></p>
  </form>

  <form id="login-form" class="form">
    <label for="l-email">Email</label>
    <input id="l-email" type="email" autocomplete="email" placeholder="you@example.com" required />
    <label for="l-pass">Password</label>
    <input id="l-pass" type="password" autocomplete="current-password" placeholder="Enter password" required />
    <button type="submit">Sign in</button>
    <p class="msg error" id="l-msg"></p>
    <p style="margin-top:0.75rem;font-size:0.75rem;text-align:right">
      <a href="#" id="forgot-link" style="color:#888;text-decoration:underline;text-underline-offset:2px">Forgot password?</a>
    </p>
  </form>

  <form id="forgot-form" class="form">
    <label for="f-email">Email</label>
    <input id="f-email" type="email" autocomplete="email" placeholder="you@example.com" required />
    <button type="submit">Send reset link</button>
    <p class="msg" id="f-msg"></p>
    <p style="margin-top:0.75rem;font-size:0.75rem;text-align:center">
      <a href="#" id="back-to-login" style="color:#888;text-decoration:underline;text-underline-offset:2px">Back to sign in</a>
    </p>
  </form>`}
${i}
</div>
<p class="local-note" id="local-note">
  Your account is stored in this app's own DB (<strong>${rt()}</strong>), not a third-party service.
</p>${d}
<script>
  function __anBasePath() {
    var marker = '/_agent-native';
    var idx = window.location.pathname.indexOf(marker);
    return idx > 0 ? window.location.pathname.slice(0, idx) : '';
  }
  function __anPath(path) {
    return __anBasePath() + path;
  }
  (function revealLocalNote() {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) {
      var n = document.getElementById('local-note');
      if (n) n.classList.add('show');
    }
  })();
${r?``:`  var TAB_STORAGE_KEY = 'an.onboarding.tab';
  var tabs = document.querySelectorAll('.tab');
  var forms = document.querySelectorAll('.form');
  var subtitles = { signup: 'Create an account to get started', login: 'Sign in to your account' };
  var headings = { signup: 'Welcome', login: 'Welcome back' };
  function setActiveTab(name, opts) {
    if (name !== 'signup' && name !== 'login') return;
    var form = document.getElementById(name + '-form');
    if (!form) return;
    tabs.forEach(function(x) { x.classList.remove('active'); });
    forms.forEach(function(x) { x.classList.remove('active'); });
    var btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (btn) btn.classList.add('active');
    form.classList.add('active');
    var sub = document.getElementById('subtitle');
    if (sub && subtitles[name]) sub.textContent = subtitles[name];
    var heading = document.getElementById('heading');
    if (heading && headings[name]) heading.textContent = headings[name];
    if (opts && opts.persist) {
      try { localStorage.setItem(TAB_STORAGE_KEY, name); } catch (e) {}
    }
  }
  (function initActiveTab() {
    var initial = 'signup';
    try {
      var params = new URLSearchParams(location.search);
      var qp = params.get('tab');
      if (qp === 'login' || qp === 'signup') {
        initial = qp;
      } else if (params.has('verified')) {
        initial = 'login';
      } else {
        var stored = localStorage.getItem(TAB_STORAGE_KEY);
        if (stored === 'login' || stored === 'signup') initial = stored;
      }
    } catch (e) {}
    setActiveTab(initial, { persist: false });
    try {
      if (new URLSearchParams(location.search).has('verified')) {
        var msg = document.getElementById('l-msg');
        if (msg) {
          msg.textContent = 'Email verified! Sign in to continue.';
          msg.classList.remove('error');
          msg.classList.add('show', 'success');
        }
      }
    } catch (e) {}
  })();
  tabs.forEach(function(t) { t.addEventListener('click', function() {
    setActiveTab(t.dataset.tab, { persist: true });
  }); });

  document.getElementById('signup-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var btn = form.querySelector('button[type="submit"]');
    var msg = document.getElementById('s-msg');
    msg.classList.remove('show', 'error', 'success');
    var pass = document.getElementById('s-pass').value;
    var pass2 = document.getElementById('s-pass2').value;
    if (pass !== pass2) {
      msg.textContent = 'Passwords do not match';
      msg.classList.add('show', 'error');
      return;
    }
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    try {
      var email = document.getElementById('s-email').value;
      var res = await fetch(__anPath('/_agent-native/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: pass }),
      });
      var data = await res.json().catch(function() { return {}; });
      if (res.ok) {
        // If email verification is required, the server won't return a session.
        // Try logging in — if it fails (unverified), show a "check your email" message.
        var loginRes = await fetch(__anPath('/_agent-native/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: pass }),
        });
        if (loginRes.ok) {
          msg.textContent = 'Account created — signing you in…';
          msg.classList.add('show', 'success');
          window.location.reload();
          return;
        }
        // Login failed — likely email verification required.
        // Switch to login tab first, then show the message there so
        // the user actually sees it (the signup form is hidden after switch).
        btn.disabled = false;
        btn.textContent = originalLabel;
        setActiveTab('login', { persist: true });
        var loginMsg = document.getElementById('l-msg');
        if (loginMsg) {
          loginMsg.textContent = 'Account created! Check your email to verify, then sign in.';
          loginMsg.classList.remove('error');
          loginMsg.classList.add('show', 'success');
        }
        return;
      }
      msg.textContent = data.error || 'Registration failed';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    } catch (err) {
      msg.textContent = 'Network error — please try again';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  var forgotLink = document.getElementById('forgot-link');
  var backToLogin = document.getElementById('back-to-login');
  if (forgotLink) forgotLink.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('forgot-form').classList.add('active');
    var sub = document.getElementById('subtitle');
    if (sub) sub.textContent = 'Reset your password';
    var heading = document.getElementById('heading');
    if (heading) heading.textContent = 'Reset password';
    var fEmail = document.getElementById('f-email');
    var lEmail = document.getElementById('l-email');
    if (lEmail && lEmail.value) fEmail.value = lEmail.value;
    setTimeout(function() { fEmail.focus(); }, 0);
  });
  if (backToLogin) backToLogin.addEventListener('click', function(e) {
    e.preventDefault();
    document.getElementById('forgot-form').classList.remove('active');
    document.getElementById('login-form').classList.add('active');
    var sub = document.getElementById('subtitle');
    if (sub) sub.textContent = subtitles.login;
    var heading = document.getElementById('heading');
    if (heading) heading.textContent = headings.login;
  });

  var forgotForm = document.getElementById('forgot-form');
  if (forgotForm) forgotForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    var btn = e.currentTarget.querySelector('button[type="submit"]');
    var msg = document.getElementById('f-msg');
    msg.classList.remove('show', 'error', 'success');
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      var email = document.getElementById('f-email').value;
      var res = await fetch(__anPath('/_agent-native/auth/ba/request-password-reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      if (res.ok) {
        msg.textContent = 'If that email exists, a reset link is on its way.';
        msg.classList.add('show', 'success');
        btn.textContent = 'Sent';
        return;
      }
      var data = await res.json().catch(function() { return {}; });
      msg.textContent = (data && (data.message || data.error)) || 'Could not send reset email.';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = original;
    } catch (err) {
      msg.textContent = 'Network error — please try again';
      msg.classList.add('show', 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  document.getElementById('login-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var form = e.currentTarget;
    var btn = form.querySelector('button[type="submit"]');
    var msg = document.getElementById('l-msg');
    msg.classList.remove('show');
    var originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      var res = await fetch(__anPath('/_agent-native/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('l-email').value,
          password: document.getElementById('l-pass').value,
        }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      var data = await res.json().catch(function() { return {}; });
      msg.textContent = data.error || 'Invalid email or password';
      msg.classList.add('show');
      btn.disabled = false;
      btn.textContent = originalLabel;
    } catch (err) {
      msg.textContent = 'Network error — please try again';
      msg.classList.add('show');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
`}${a}
${t?`
  (function syncUpgradeFromLocalUi() {
    var subtitle = document.querySelector('.subtitle');
    var note = document.getElementById('upgrade-note');
    var localBtn = document.getElementById('local-btn');
    var localInfo = document.getElementById('local-info');
    var divider = document.getElementById('local-divider');
    if (!subtitle || !note || !localBtn || !localInfo || !divider) return;
    try {
      if (!localStorage.getItem('${it}')) return;
    } catch (e) {
      return;
    }
    subtitle.textContent = 'Sign in to upgrade your local workspace';
    note.classList.add('show');
    localBtn.textContent = 'Stay in local mode';
    localInfo.textContent = 'Use this if you want to cancel the upgrade and go back to local@localhost on this device.';
    divider.textContent = 'or stay local';
  })();
`:``}
${n?`
  function __anGetReturnPath() {
    // If we landed here via /_agent-native/sign-in?return=X (force-sign-in
    // entrypoint from a public page), prefer the inner return URL.
    // Otherwise the loginHtml is being served at the URL the user actually
    // wanted to reach (a bookmarked / deep-linked private path), so use it.
    try {
      var inner = new URLSearchParams(window.location.search).get('return');
      if (inner) return inner;
    } catch(e) {}
    return window.location.pathname + window.location.search;
  }
  async function signInWithGoogle() {
    var btn = document.getElementById('google-btn');
    var err = document.getElementById('google-err');
    btn.disabled = true;
    err.classList.remove('show');
    try {
      var ret = __anGetReturnPath();
      var authUrl = __anPath('/_agent-native/google/auth-url') + '?return=' + encodeURIComponent(ret);
      var res = await fetch(authUrl);
      var data = await res.json();
      if (data.url) {
        try { sessionStorage.setItem('__an_signin', '1'); } catch(e) {}
        window.open(data.url, '_blank');
        btn.disabled = false;
        btn.textContent = 'Waiting for sign-in…';
        var poll = setInterval(function() {
          fetch(__anPath('/_agent-native/auth/session')).then(function(r) { return r.json(); }).then(function(s) {
            if (s && s.email) { clearInterval(poll); window.location.reload(); }
          }).catch(function() {});
        }, 1500);
      } else {
        err.textContent = data.message || 'Google OAuth is not configured.';
        err.classList.add('show');
        btn.disabled = false;
      }
    } catch (e) {
      err.textContent = 'Failed to connect. Please try again.';
      err.classList.add('show');
      btn.disabled = false;
    }
  }`:``}
${f}
<\/script>
</body>
</html>`}N();function at(){return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Reset password</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1rem; }
  .card { width: 100%; max-width: 400px; padding: 2rem; background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
  h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.25rem; color: #fff; }
  .subtitle { font-size: 0.8125rem; color: #888; margin-bottom: 1.5rem; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input { width: 100%; padding: 0.5rem 0.75rem; background: transparent; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: #e5e5e5; font-size: 0.875rem; outline: none; margin-bottom: 0.875rem; }
  input:focus { border-color: rgba(255,255,255,0.3); box-shadow: 0 0 0 1px rgba(255,255,255,0.1); }
  input::placeholder { color: #555; }
  button[type="submit"] { width: 100%; margin-top: 0.25rem; padding: 0.5rem; background: #fff; color: #000; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 500; cursor: pointer; }
  button[type="submit"]:hover { background: #e5e5e5; }
  button[type="submit"]:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg { margin-top: 0.75rem; font-size: 0.8125rem; display: none; }
  .msg.error { color: #f87171; }
  .msg.success { color: #4ade80; }
  .msg.show { display: block; }
  .back { display: inline-block; margin-top: 1rem; font-size: 0.75rem; color: #888; text-decoration: none; }
  .back:hover { color: #bbb; }
</style>
</head>
<body>
<div class="card">
  <h1>Choose a new password</h1>
  <p class="subtitle">Set a new password for your account.</p>
  <form id="reset-form">
    <label for="p1">New password</label>
    <input id="p1" type="password" autocomplete="new-password" autofocus placeholder="At least 8 characters" required minlength="8" />
    <label for="p2">Confirm password</label>
    <input id="p2" type="password" autocomplete="new-password" placeholder="Confirm password" required minlength="8" />
    <button type="submit">Save new password</button>
    <p class="msg" id="msg"></p>
  </form>
  <a class="back" id="back-link" href="/">Back to sign in</a>
</div>
<script>
  (function() {
    // Derive the app's base path so apps mounted under a prefix
    // (e.g. /mail, /calendar) get sent home instead of to the root domain.
    var RESET_PATH = '/_agent-native/auth/reset';
    var pathname = window.location.pathname;
    var idx = pathname.indexOf(RESET_PATH);
    var basePath = (idx >= 0 ? pathname.slice(0, idx) : '') || '';
    var homeHref = basePath + '/';
    var backLink = document.getElementById('back-link');
    if (backLink) backLink.setAttribute('href', homeHref);
    var params = new URLSearchParams(location.search);
    var token = params.get('token') || '';
    var msg = document.getElementById('msg');
    if (!token) {
      msg.textContent = 'Missing or invalid reset token. Request a new reset link.';
      msg.classList.add('show', 'error');
      document.getElementById('reset-form').style.display = 'none';
      return;
    }
    document.getElementById('reset-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = e.currentTarget.querySelector('button[type="submit"]');
      var p1 = document.getElementById('p1').value;
      var p2 = document.getElementById('p2').value;
      msg.classList.remove('show', 'error', 'success');
      if (p1 !== p2) {
        msg.textContent = 'Passwords do not match';
        msg.classList.add('show', 'error');
        return;
      }
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        var res = await fetch(basePath + '/_agent-native/auth/ba/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: p1, token: token }),
        });
        if (res.ok) {
          msg.textContent = 'Password updated — redirecting to sign in…';
          msg.classList.add('show', 'success');
          setTimeout(function() { window.location.href = homeHref; }, 1200);
          return;
        }
        var data = await res.json().catch(function() { return {}; });
        msg.textContent = (data && (data.message || data.error)) || 'Reset failed. The link may have expired — request a new one.';
        msg.classList.add('show', 'error');
        btn.disabled = false;
        btn.textContent = original;
      } catch (err) {
        msg.textContent = 'Network error — please try again';
        msg.classList.add('show', 'error');
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  })();
<\/script>
</body>
</html>`}const P=`local@localhost`,ot=`local`,st=`owner_email`,ct=/no such table|no such column|does not exist|undefined table|undefined column|relation .* does not exist|column .* does not exist|permission denied|is not a table|cannot update view|cannot change column in a view/i;function lt(e){let t=e instanceof Error?e.message:String(e);return ct.test(t)}async function ut(){let e=h();if(ne()){let{rows:t}=await e.execute({sql:`SELECT c.table_name
              FROM information_schema.columns c
              JOIN information_schema.tables t
                ON t.table_schema = c.table_schema
               AND t.table_name = c.table_name
             WHERE c.table_schema = 'public'
               AND c.column_name = $1
               AND t.table_type = 'BASE TABLE'`,args:[st]});return t.map(e=>e.table_name??e[0]).filter(Boolean)}let t=(await e.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)).rows.map(e=>e.name??e[0]).filter(Boolean),n=[];for(let r of t){let t=r.replace(/"/g,`""`);(await e.execute(`PRAGMA table_info("${t}")`)).rows.some(e=>(e.name??e[1])===st)&&n.push(r)}return n}function F(e){if(!ne())return e;let t=0;return e.replace(/\?/g,()=>`$${++t}`)}async function dt(e){let t=h(),n=`u:${P}:`,r=`u:${e}:`,{rows:i}=await t.execute({sql:F(`SELECT key FROM settings WHERE key LIKE ? ESCAPE '\\'`),args:[n.replace(/([\\%_])/g,`\\$1`)+`%`]}),a=0;for(let e of i){let i=e.key??e[0];if(!i.startsWith(n))continue;let o=r+i.slice(n.length);if((await t.execute({sql:F(`SELECT 1 FROM settings WHERE key = ?`),args:[o]})).rows.length>0){await t.execute({sql:F(`DELETE FROM settings WHERE key = ?`),args:[i]});continue}await t.execute({sql:F(`UPDATE settings SET key = ? WHERE key = ?`),args:[o,i]}),a++}return a}async function ft(e){let t=h(),{rows:n}=await t.execute({sql:F(`SELECT key FROM application_state WHERE session_id = ?`),args:[ot]}),r=0;for(let i of n){let n=i.key??i[0];if((await t.execute({sql:F(`SELECT 1 FROM application_state WHERE session_id = ? AND key = ?`),args:[e,n]})).rows.length>0){await t.execute({sql:F(`DELETE FROM application_state WHERE session_id = ? AND key = ?`),args:[ot,n]});continue}await t.execute({sql:F(`UPDATE application_state SET session_id = ? WHERE session_id = ? AND key = ?`),args:[e,ot,n]}),r++}return r}async function pt(e){return(await h().execute({sql:F(`UPDATE oauth_tokens SET owner = ? WHERE owner = ?`),args:[e,P]})).rowsAffected??0}async function mt(e,t){let n=h(),r=e.replace(/"/g,`""`);return(await n.execute({sql:F(`UPDATE "${r}" SET owner_email = ? WHERE owner_email = ?`),args:[t,P]})).rowsAffected??0}async function ht(e){let t=e?.trim().toLowerCase();if(!t||t===P)return{migrated:!1,tables:{},targetEmail:t||``};let n={},r=[[`settings`,()=>dt(t)],[`application_state`,()=>ft(t)],[`oauth_tokens`,()=>pt(t)]],i=[];for(let[e,t]of r)try{let r=await t();r>0&&(n[e]=r)}catch(t){if(!lt(t)){let n=t?.message??String(t);i.push({step:e,message:n}),console.error(`[local-migration] ${e} failed:`,t)}}let a=[];try{a=await ut()}catch(e){console.error(`[local-migration] owner_email table discovery failed:`,e),a=[]}for(let e of a)try{let r=await mt(e,t);r>0&&(n[e]=r)}catch(t){if(!lt(t)){let n=t?.message??String(t);i.push({step:e,message:n}),console.error(`[local-migration] ${e} failed:`,t)}}let o={migrated:Object.values(n).some(e=>e>0),tables:n,targetEmail:t};return i.length>0&&(o.errors=i),o}let gt;async function _t(){return gt||=await import(`node:fs`),gt}function vt(){return C.join(me.homedir(),`.agent-native`,`desktop-sso.json`)}async function yt(){try{let e=(await _t()).readFileSync(vt(),`utf-8`),t=JSON.parse(e);return!t||typeof t.email!=`string`||typeof t.token!=`string`||typeof t.expiresAt!=`number`||t.expiresAt<=0||t.expiresAt<Date.now()?null:t}catch{return null}}async function bt(e){try{let t=await _t(),n=vt();t.mkdirSync(C.dirname(n),{recursive:!0,mode:448});let r=`${n}.tmp`;t.writeFileSync(r,JSON.stringify(e),{mode:384}),t.renameSync(r,n)}catch{}}async function I(){try{(await _t()).unlinkSync(vt())}catch{}}function L(e,t=200){return new Response(e,{status:t,headers:{"Content-Type":`text/html; charset=utf-8`}})}function xt(e){return String(e??``).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#39;`)}function R(e){return/Electron/i.test(d(e,`user-agent`)||``)}function St(e){return/iPhone|iPad|iPod|Android/i.test(d(e,`user-agent`)||``)}function Ct(){let e=new Set;for(let t of[process.env.APP_URL,process.env.BETTER_AUTH_URL])if(t)try{let n=new URL(t);e.add(`${n.protocol}//${n.host}`)}catch{}return e}function wt(e){let t=d(e,`x-forwarded-host`)||d(e,`host`),n=process.env.NODE_ENV===`production`,r=d(e,`x-forwarded-proto`)||(n?`https`:`http`);if(n){let e=Ct();if(e.size>0){let n=t?`${r}://${t}`:``;return n&&e.has(n)?n:[...e][0]}return`${r}://${t??``}`}return`${r}://${t??`localhost`}`}function Tt(e){if(!e||e===`/`)return``;let t=e.trim();return!t||t===`/`?``:`/${t.replace(/^\/+/,``).replace(/\/+$/,``)}`}function Et(){return Tt(process.env.VITE_APP_BASE_PATH||process.env.APP_BASE_PATH)}function Dt(e,t=`/`){let n=t.startsWith(`/`)?t:`/${t}`;return`${wt(e)}${Et()}${n}`}function Ot(e,t){if(typeof e!=`string`||e.length===0)return!1;let n;try{n=new URL(e)}catch{return!1}let r=wt(t),i;try{i=new URL(r)}catch{return!1}if(n.protocol!==i.protocol||n.host!==i.host)return!1;let a=`${Et()}/_agent-native/`;return!!n.pathname.startsWith(a)}function kt(e,t=`/_agent-native/google/callback`){let n=o(e).redirect_uri;return typeof n==`string`&&n.length>0?Ot(n,e)?n:null:Dt(e,t)}let At;function jt(){let e=process.env.OAUTH_STATE_SECRET||process.env.BETTER_AUTH_SECRET;if(e)return e;if(process.env.NODE_ENV===`production`)throw Error(`OAuth state signing requires a server secret. Set OAUTH_STATE_SECRET or BETTER_AUTH_SECRET in production.`);return At||=S.randomBytes(32).toString(`hex`),At}function Mt(e,t,n,r,i,a,o){let s=typeof e==`string`?{redirectUri:e,owner:t,desktop:n,addAccount:r,app:i,returnUrl:a,flowId:o}:e,c={n:S.randomBytes(8).toString(`hex`),r:s.redirectUri};s.owner&&(c.o=s.owner),s.desktop&&(c.d=!0),s.addAccount&&(c.a=!0),s.app&&(c.app=s.app),s.returnUrl&&(c.r2=s.returnUrl),s.flowId&&(c.f=s.flowId);let l=Buffer.from(JSON.stringify(c)).toString(`base64url`);return`${l}.${S.createHmac(`sha256`,jt()).update(l).digest(`base64url`)}`}function Nt(e,t){if(e)try{let n=e.lastIndexOf(`.`);if(n===-1)return{redirectUri:t};let r=e.slice(0,n),i=e.slice(n+1),a=S.createHmac(`sha256`,jt()).update(r).digest(`base64url`);if(i.length!==a.length||!S.timingSafeEqual(Buffer.from(i),Buffer.from(a)))return{redirectUri:t};let o=JSON.parse(Buffer.from(r,`base64url`).toString());return{redirectUri:o.r||t,owner:o.o||void 0,desktop:!!o.d,addAccount:!!o.a,returnUrl:typeof o.r2==`string`?o.r2:void 0,flowId:o.f||void 0}}catch{}return{redirectUri:t}}async function Pt(e,t,n){let r=St(e),i=n.desktop||r,a=Ut(),o;return(!n.hasProductionSession||i)&&(o=S.randomBytes(32).toString(`hex`),await H(o,t),f(e,z,o,{httpOnly:!0,secure:process.env.NODE_ENV===`production`,sameSite:`lax`,path:`/`,maxAge:a}),n.desktop&&!n.hasProductionSession&&await bt({email:t,token:o,expiresAt:Date.now()+a*1e3})),{sessionToken:o}}function Ft(e,r,i){let a=St(e),s=o(e),c=typeof s.state==`string`&&s.state.length>0?s.state:void 0;if(a){let e=Lt(i.sessionToken,c);return L(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><title>Connected</title></head><body style="background:#111;color:#aaa;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Connected! Returning to app…</p><script>window.location.href=${JSON.stringify(e)};setTimeout(function(){window.location.href="/"},1500)<\/script></body></html>`)}if(i.desktop&&i.addAccount){let e=r?xt(r):``;return L(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${e?`Connected ${e}!`:`Connected!`}</p><p style="font-size:13px;color:#888">You can close this tab and return to Agent Native.</p></body></html>`)}if(i.desktop&&i.flowId){let e=r?xt(r):``;return L(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${e?`Signed in as ${e}!`:`Signed in!`}</p><p style="font-size:13px;color:#888">You can close this tab and return to Clips.</p></body></html>`)}return i.desktop?Rt(e,r,i.sessionToken,c):i.addAccount?L(`<!DOCTYPE html><html><body><script>
        window.close();
        var p = document.createElement('p');
        p.style.cssText = 'font-family:system-ui;text-align:center;margin-top:40vh';
        p.textContent = 'Connected ' + ${JSON.stringify(typeof r==`string`?r:``)} + '! You can close this tab.';
        document.body.appendChild(p);
      <\/script></body></html>`):(t(e,302),n(e,`Location`,Yt(i.returnUrl)),``)}function It(e){return L(`<!DOCTYPE html><html><body>
    <div style="font-family:system-ui;max-width:420px;margin:30vh auto;text-align:center">
      <p style="font-size:15px;color:#e55">${xt(e)}</p>
      <p style="margin-top:16px;font-size:13px;color:#888"><a href="/" style="color:#888">Back to login</a></p>
    </div>
  </body></html>`,400)}function Lt(e,t){let n=new URLSearchParams;e&&n.set(`token`,e),t&&n.set(`state`,t);let r=n.toString();return r?`agentnative://oauth-complete?${r}`:`agentnative://oauth-complete`}function Rt(e,t,n,r){let i=t?xt(t):``,a=i?`Connected ${i}!`:`Connected!`;if(n){let e=Lt(n,r),t=JSON.stringify(e);return L(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title><style>@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}.spinner{width:28px;height:28px;border:2px solid #333;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.fallback{display:none;flex-direction:column;align-items:center;gap:8px;animation:fadeIn .2s ease-out}.fallback.show{display:flex}</style></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px"><p style="font-size:16px;margin:0">${a}</p><div id="loading" class="spinner"></div><div id="fallback" class="fallback"><a href=${t} style="display:inline-block;padding:10px 24px;background:#fff;color:#000;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Open Agent Native</a><p style="font-size:12px;color:#666;margin:0">If the app didn\u2019t open automatically, click the button above.</p></div><script>window.location.href=${t};setTimeout(function(){document.getElementById("loading").style.display="none";document.getElementById("fallback").classList.add("show")},3000)<\/script></body></html>`)}return L(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body style="background:#111;color:#ccc;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:8px"><p style="font-size:16px">${a}</p><p style="font-size:13px;color:#888">You can close this tab and return to Agent Native.</p></body></html>`)}var zt=e({COOKIE_NAME:()=>z,DEV_MODE_USER_EMAIL:()=>`local@localhost`,addSession:()=>H,autoMountAuth:()=>kn,getSession:()=>X,getSessionEmail:()=>W,getSessionMaxAge:()=>Ut,isDevEnvironment:()=>B,removeSession:()=>U,runAuthGuard:()=>ln,safeReturnPath:()=>Yt});let Bt;async function Vt(){return Bt||=await import(`node:fs`),Bt}function Ht(e){let t=e.req,n=e.context;if(n?._mountedPathname&&n._mountPrefix)try{let e=new URL(t.url),r=xn(n._mountedPathname);if(e.pathname!==r){e.pathname=r;let n=t.method.toUpperCase(),i=n!==`GET`&&n!==`HEAD`;return new Request(e.href,{method:t.method,headers:t.headers,...i?{body:t.body,duplex:`half`}:{}})}}catch{}return t}function Ut(){return V}const Wt=(process.env.APP_NAME||``).toLowerCase().replace(/[^a-z0-9]+/g,`_`).replace(/^_+|_+$/g,``),z=Wt?`an_session_${Wt}`:`an_session`,Gt=3600*24*30,Kt=C.resolve(process.cwd(),`.agent-native`,`auth-mode`);let qt=!1;async function Jt(){if(!m())return process.env.AUTH_MODE===`local`&&!qt&&(qt=!0,console.warn(`[agent-native] AUTH_MODE=local ignored: database is not local SQLite. local@localhost has no per-user scoping and would collide across developers on a shared DB.`)),!1;if(process.env.AUTH_MODE===`local`)return!0;try{return(await Vt()).readFileSync(Kt,`utf-8`).trim()===`local`}catch{return!1}}function B(){let e=process.env.NODE_ENV;return e===`development`||e===`test`}function Yt(e){if(!e||/[\x00-\x1f]/.test(e))return`/`;try{let t=new URL(e,`http://safe-base.invalid`);return t.origin===`http://safe-base.invalid`?t.pathname+t.search+t.hash:`/`}catch{return`/`}}async function Xt(e){if(process.env.NODE_ENV===`production`||!R(e))return null;let t;try{t=l(e)??void 0}catch{t=void 0}let n=(t??``).split(`%`)[0];return n===`127.0.0.1`||n===`::1`||n===`::ffff:127.0.0.1`||n.startsWith(`127.`)?await yt():null}function Zt(e){try{let t=e.headers,n=typeof t.getSetCookie==`function`?t.getSetCookie():(t.get(`set-cookie`)??``).split(/,(?=[^;]+=)/).map(e=>e.trim()).filter(Boolean);for(let e of n){let t=e.match(/(?:^|\s|;)(an_session|[\w.-]*session_token)=([^;]+)/i);if(t)return t[2]}}catch{}}function Qt(){let e=process.env.ACCESS_TOKEN,t=process.env.ACCESS_TOKENS,n=[];if(e&&n.push(e),t)for(let e of t.split(`,`)){let t=e.trim();t&&!n.includes(t)&&n.push(t)}return n}function $t(e,t){let n=Buffer.from(e);for(let e of t){let t=Buffer.from(e);if(n.length===t.length&&S.timingSafeEqual(n,t))return!0}return!1}let en,V=Gt;async function tn(){return en||=(async()=>{let e=h();await te(()=>e.execute(`
          CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            email TEXT,
            created_at ${ie()} NOT NULL
          )
        `));try{await e.execute(`ALTER TABLE sessions ADD COLUMN email TEXT`)}catch{}})().catch(e=>{throw en=void 0,e}),en}async function nn(e){try{return await e()}catch(t){if(t?.code!==`42P01`||!String(t?.message??``).includes(`sessions`))throw t;return en=void 0,await tn(),await e()}}async function H(e,t){await tn();let n=h();await nn(()=>n.execute({sql:ne()?`INSERT INTO sessions (token, email, created_at) VALUES (?, ?, ?) ON CONFLICT (token) DO UPDATE SET email=EXCLUDED.email, created_at=EXCLUDED.created_at`:`INSERT OR REPLACE INTO sessions (token, email, created_at) VALUES (?, ?, ?)`,args:[e,t??null,Date.now()]}))}async function U(e){await tn();let t=h();await nn(()=>t.execute({sql:`DELETE FROM sessions WHERE token = ?`,args:[e]}))}async function W(e){await tn();let t=h(),{rows:n}=await nn(()=>t.execute({sql:`SELECT email, created_at FROM sessions WHERE token = ?`,args:[e]}));if(n.length===0)return null;let r=n[0].created_at;return Date.now()-r>V*1e3?(await t.execute({sql:`DELETE FROM sessions WHERE token = ?`,args:[e]}),null):n[0].email??null}let G=null,rn=!1,K=null;const q=new Map,an=300*1e3;async function on(e,t,n){try{await H(`dex:${e}`,`${t}::${n}`)}catch{}}async function sn(e){try{let{rows:t}=await h().execute({sql:`DELETE FROM sessions WHERE token = ? AND created_at > ? RETURNING email`,args:[`dex:${e}`,Date.now()-an]});if(t.length===0)return null;let n=t[0].email??t[0][0];if(!n)return null;let r=n.indexOf(`::`);return r===-1?null:{token:n.slice(0,r),email:n.slice(r+2)}}catch{return null}}setInterval(()=>{let e=Date.now();for(let[t,n]of q)n.expiresAt<e&&q.delete(t)},6e4).unref?.();let J=null,cn=null;async function ln(e){if(J)return J(e)}const un=`local@localhost`,dn={email:`local@localhost`};function fn(e){let t=(e.node?.req?.headers??{}).origin,r=Array.isArray(t)?t[0]:t;if(!r)return;let i=(process.env.CORS_ALLOWED_ORIGINS??``).split(`,`).map(e=>e.trim()).filter(Boolean);(i.length===0?/^(https?|tauri):\/\/(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?$/.test(r):i.includes(r))&&(n(e,`Access-Control-Allow-Origin`,r),n(e,`Vary`,`Origin`),n(e,`Access-Control-Allow-Credentials`,`true`),n(e,`Access-Control-Allow-Methods`,`GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS`),n(e,`Access-Control-Allow-Headers`,`Content-Type,Authorization,X-Requested-With,X-Request-Source`))}function Y(){return async e=>{let n=K;if(!n)return;let{loginHtml:r,publicPaths:i}=n,o=e.node?.req?.url??e.path??`/`,s=o.indexOf(`?`),c=xn(s>=0?o.slice(0,s):o),l=s>=0?`${c}${o.slice(s)}`:c;if(fn(e),a(e)===`OPTIONS`)return t(e,204),``;if(!(c.startsWith(`/_agent-native/auth/`)||c===`/_agent-native/google/callback`||c===`/_agent-native/google/auth-url`||c===`/_agent-native/google/add-account/callback`)&&!/^\/_agent-native\/integrations\/[^/]+\/webhook$/.test(c)&&c!==`/_agent-native/integrations/process-task`&&c!==`/_agent-native/a2a`&&c!==`/_agent-native/a2a/_process-task`&&c!==`/_agent-native/org/a2a-secret/receive`){if(c===`/_agent-native/sign-in`){let t=s>=0?o.slice(s+1):``,n=Yt(new URLSearchParams(t).get(`return`));return await X(e)?new Response(``,{status:302,headers:{Location:n}}):new Response(r,{status:200,headers:{"Content-Type":`text/html; charset=utf-8`}})}if(!(c.startsWith(`/assets/`)||c.startsWith(`/_build/`)||c.endsWith(`.js`)||c.endsWith(`.css`)||c.endsWith(`.map`)||c.endsWith(`.ico`)||c.endsWith(`.png`)||c.endsWith(`.svg`)||c.endsWith(`.woff2`)||c.endsWith(`.woff`))&&!bn(l,i)&&!await X(e))return c.startsWith(`/api/`)||c.startsWith(`/_agent-native/`)?(t(e,401),{error:`Unauthorized`}):new Response(r,{status:200,headers:{"Content-Type":`text/html; charset=utf-8`}})}}}function pn(e){return{email:e.user.email,userId:e.user.id,name:e.user.name,token:e.session?.token,orgId:e.session?.activeOrganizationId??void 0}}async function X(e){if(await Jt()||rn){try{let t=c(e,z);if(t){let e=await W(t);if(e)return{email:e,token:t}}}catch{}try{let t=Qe();if(t){let n=await t.api.getSession({headers:e.headers});if(n?.user?.email)return pn(n)}}catch{}return dn}if(Qt().length>0){let t=c(e,z);if(t){let e=await W(t);if(e)return{email:e,token:t}}}if(G){let t=await G(e);if(t)return t;let n=await Xt(e);if(n?.email)return{email:n.email,token:n.token}}else{try{let t=Qe();if(t){let n=await t.api.getSession({headers:e.headers});if(n?.user?.email)return yn(e),pn(n)}}catch(e){console.error(`[auth] ba.api.getSession error:`,e)}let t=c(e,z);if(t){let n=await W(t);if(n)return yn(e),{email:n,token:t}}let n=await Xt(e);if(n?.email)return yn(e),{email:n.email,token:n.token}}let t=o(e)?._session;if(t){let r=await W(t);if(r)return f(e,z,t,{httpOnly:!0,...Q(e),path:`/`,maxAge:V}),n(e,`Referrer-Policy`,`no-referrer`),{email:r,token:t}}return process.env.NODE_ENV===`development`&&m()&&!hn(e)&&!_n(e)?dn:null}const mn=`an_upgrade_pending`;function hn(e){try{return c(e,mn)===`1`}catch{return!1}}function gn(e){f(e,mn,`1`,{httpOnly:!0,...Q(e),path:`/`,maxAge:3600})}function _n(e){try{return o(e)?.signin===`1`}catch{return!1}}function Z(e){let t=a(e);return t===`GET`||t===`HEAD`}function Q(e){return vn(e)?{sameSite:`none`,secure:!0}:{sameSite:`lax`,secure:!1}}function vn(e){try{let t=e.req??e.node?.req,n=t?.headers,r=(e=>{if(!n)return;if(typeof n.get==`function`)return n.get(e)??void 0;let t=n[e];return Array.isArray(t)?t[0]:t})(`x-forwarded-proto`);if(r&&String(r).split(`,`)[0].trim()===`https`)return!0;let i=t?.url;if(typeof i==`string`&&i.startsWith(`https://`)||(process.env.APP_URL||process.env.BETTER_AUTH_URL||``).startsWith(`https://`))return!0}catch{}return!1}function yn(e){try{i(e,mn,{path:`/`})}catch{}}function bn(e,t){let n=e.split(`?`)[0];return t.some(e=>n===e||n.startsWith(e+`/`))}function xn(e){let t=Et();return t?e===t?`/`:e.startsWith(`${t}/`)?e.slice(t.length)||`/`:e:e}const Sn=`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Sign in</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0a0a0a;
    color: #e5e5e5;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .card {
    width: 100%;
    max-width: 360px;
    padding: 2rem;
    background: #141414;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
  }
  h1 { font-size: 1.125rem; font-weight: 600; margin-bottom: 1.5rem; color: #fff; }
  label { display: block; font-size: 0.8125rem; color: #888; margin-bottom: 0.375rem; }
  input {
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: #1e1e1e;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    color: #e5e5e5;
    font-size: 0.9375rem;
    outline: none;
  }
  input:focus { border-color: rgba(255,255,255,0.3); }
  button {
    width: 100%;
    margin-top: 1rem;
    padding: 0.625rem;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
  }
  button:hover { opacity: 0.85; }
  .error { margin-top: 0.75rem; font-size: 0.8125rem; color: #f87171; display: none; }
  .error.show { display: block; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign in</h1>
  <form id="form">
    <label for="token">Access token</label>
    <input id="token" type="password" autocomplete="current-password" autofocus placeholder="Enter access token" />
    <button type="submit">Continue</button>
    <p class="error" id="err">Invalid token. Please try again.</p>
  </form>
</div>
<script>
  function __anBasePath() {
    var marker = '/_agent-native';
    var idx = window.location.pathname.indexOf(marker);
    return idx > 0 ? window.location.pathname.slice(0, idx) : '';
  }
  function __anPath(path) {
    return __anBasePath() + path;
  }
  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = document.getElementById('token').value;
    const res = await fetch(__anPath('/_agent-native/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      document.getElementById('err').classList.add('show');
    }
  });
<\/script>
</body>
</html>`;async function Cn(){try{let e=await Vt();return e.mkdirSync(C.dirname(Kt),{recursive:!0}),e.writeFileSync(Kt,`local
`,`utf-8`),process.env.AUTH_MODE=`local`,!0}catch{return!1}}async function wn(){try{let e=await Vt();try{e.unlinkSync(Kt)}catch{}return delete process.env.AUTH_MODE,!0}catch{return!1}}const $=u(async e=>{if(a(e)!==`POST`)return t(e,405),{error:`Method not allowed`};let n=await X(e);if(!n?.email||n.email===`local@localhost`)return t(e,401),{error:`Not authenticated as a real account`};try{return{ok:!0,...await ht(n.email)}}catch(r){return console.error(`[migrate-local-data] Migration threw for`,n.email,r),t(e,500),{error:r?.message||`Migration failed`,stack:process.env.AGENT_NATIVE_DEBUG_ERRORS===`1`?r?.stack:void 0}}});async function Tn(e,n){let s=[...n.publicPaths??[]];for(let e of[`/.well-known`,`/favicon.ico`,`/favicon.png`])s.includes(e)||s.push(e);if(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET){for(let e of[`/_agent-native/google/callback`,`/_agent-native/google/auth-url`])s.includes(e)||s.push(e);let n=[`openid`,`https://www.googleapis.com/auth/userinfo.email`,`https://www.googleapis.com/auth/userinfo.profile`].join(` `);e.use(`/_agent-native/google/auth-url`,u(e=>{if(a(e)!==`GET`)return t(e,405),{error:`Method not allowed`};let i=kt(e);if(i===null)return t(e,400),{error:`Invalid redirect_uri`};let s=o(e),c=R(e)||s.desktop===`1`||s.desktop===`true`,l=c&&s.flow_id||void 0,u=s.return,d=typeof u==`string`?Yt(u):`/`,f=Mt(i,void 0,c,!1,void 0,d===`/`?void 0:d,l),p=`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:i,response_type:`code`,scope:n,access_type:`online`,prompt:`select_account`,state:f})}`;return s.redirect===`1`?r(e,p,302):{url:p}})),e.use(`/_agent-native/google/callback`,u(async e=>{if(a(e)!==`GET`)return t(e,405),{error:`Method not allowed`};try{let n=o(e),r=n.code;if(!r)return t(e,400),{error:`Missing authorization code`};let{redirectUri:i,desktop:a,returnUrl:s,flowId:c}=Nt(n.state,Dt(e,`/_agent-native/google/callback`));if(!Ot(i,e))return t(e,400),{error:`Invalid redirect_uri in state`};let l=await fetch(`https://oauth2.googleapis.com/token`,{method:`POST`,headers:{"Content-Type":`application/x-www-form-urlencoded`},body:new URLSearchParams({code:r,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:i,grant_type:`authorization_code`})}),u=await l.json();if(!l.ok)throw Error(u.error_description||u.error||`Token exchange failed`);let d=await(await fetch(`https://www.googleapis.com/oauth2/v2/userinfo`,{headers:{Authorization:`Bearer ${u.access_token}`}})).json(),f=d.email;if(!f)throw Error(`Could not get email from Google`);if(d.verified_email!==!0)throw Error(`Google account email is not verified. Please verify your email with Google and try again.`);let{sessionToken:p}=await Pt(e,f,{hasProductionSession:!1,desktop:a});return c&&p&&(q.set(c,{token:p,email:f,expiresAt:Date.now()+an}),on(c,p,f)),Ft(e,f,{sessionToken:p,desktop:a,returnUrl:s,flowId:c})}catch(e){return It(`Connection failed: ${e.message||`Unknown error`}`)}}))}e.use(`/_agent-native/auth/desktop-exchange`,u(async e=>{if(a(e)!==`GET`)return t(e,405),{error:`Method not allowed`};let n=o(e).flow_id;if(!n)return t(e,400),{error:`Missing flow_id`};let r=q.get(n);if(!r||r.expiresAt<Date.now()){let e=await sn(n);if(!e)return{pending:!0};r={token:e.token,email:e.email,expiresAt:Date.now()+1}}return q.delete(n),U(`dex:${n}`),{token:r.token,email:r.email}}));let l=Qt(),d=await M(n.betterAuth);e.use(`/_agent-native/auth/ba`,u(async e=>{let t=e.url?.pathname??e.path??``,n=t.includes(`reset-password`)&&a(e)===`POST`,r,i;if(n){try{r=(await e.req.clone().json().catch(()=>void 0))?.token}catch{}if(r)try{let{getDbExec:e}=await import(`./client.mjs`).then(e=>e.t);i=(await e().execute({sql:`SELECT value FROM verification WHERE identifier = ?`,args:[`reset-password:${r}`]})).rows[0]?.value}catch{}}let o=await d.handler(Ht(e)),s=o!=null&&typeof o.status==`number`&&typeof o.headers?.get==`function`;if(t.includes(`verify-email`)&&s&&o.status>=300&&o.status<400){let e=o.headers.get(`location`);if(e&&!/[?&]verified=/.test(e)){let t=e.includes(`?`)?`&`:`?`;o.headers.set(`location`,e+t+`verified=1`)}}if(n&&i&&s&&o.status>=200&&o.status<300)try{let{getDbExec:e}=await import(`./client.mjs`).then(e=>e.t),t=e();await t.execute({sql:`UPDATE "user" SET email_verified = TRUE WHERE id = ? AND (email_verified = FALSE OR email_verified IS NULL)`,args:[i]});let n=Zt(o);n?await t.execute({sql:`DELETE FROM "session" WHERE user_id = ? AND token <> ?`,args:[i,n]}):await t.execute({sql:`DELETE FROM "session" WHERE user_id = ?`,args:[i]});try{let{rows:e}=await t.execute({sql:`SELECT email FROM "user" WHERE id = ?`,args:[i]}),r=e[0]?.email??e[0]?.[0];r&&(n?await t.execute({sql:`DELETE FROM sessions WHERE email = ? AND token <> ?`,args:[r,n]}):await t.execute({sql:`DELETE FROM sessions WHERE email = ?`,args:[r]}))}catch{}}catch{}return o})),e.use(`/_agent-native/auth/local-mode`,u(async e=>a(e)===`POST`?B()?m()?await Cn()?{ok:!0}:(t(e,500),{error:`Failed to enable local mode`}):(t(e,400),{error:`Local mode is only available on a local SQLite database. Your DATABASE_URL points at a shared database — create an account instead.`}):(t(e,403),{error:`Local mode is not available in production. Create an account to continue.`}):(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/exit-local-mode`,u(async e=>a(e)===`POST`?await wn()?(gn(e),{ok:!0}):(t(e,500),{error:`Failed to disable local mode`}):(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/login`,u(async e=>{if(a(e)!==`POST`)return t(e,405),{error:`Method not allowed`};let n=await p(e);if(n?.token&&typeof n.token==`string`&&l.length>0){if(!$t(n.token,l))return t(e,401),{error:`Invalid token`};let r=S.randomBytes(32).toString(`hex`);return await H(r,`user`),f(e,z,r,{httpOnly:!0,...Q(e),path:`/`,maxAge:V}),{ok:!0}}let r=n?.email?.trim?.()?.toLowerCase?.(),i=n?.password;if(!r||!i)return t(e,400),{error:`Email and password are required`};try{let n=await d.api.signInEmail({body:{email:r,password:i}});return n?.token?(f(e,z,n.token,{httpOnly:!0,...Q(e),path:`/`,maxAge:V}),await H(n.token,r),R(e)&&await bt({email:r,token:n.token,expiresAt:Date.now()+V*1e3}),{ok:!0}):(t(e,403),{error:`Email not verified. Check your inbox for a verification link.`})}catch(n){return t(e,401),{error:n?.message||`Invalid email or password`}}})),e.use(`/_agent-native/auth/register`,u(async e=>{if(a(e)!==`POST`)return t(e,405),{error:`Method not allowed`};let n=await p(e),r=n?.email?.trim?.()?.toLowerCase?.(),i=n?.password;if(!r||typeof r!=`string`||!r.includes(`@`))return t(e,400),{error:`Valid email is required`};if(!i||typeof i!=`string`||i.length<8)return t(e,400),{error:`Password must be at least 8 characters`};try{return await d.api.signUpEmail({body:{email:r,password:i,name:r.split(`@`)[0]}}),{ok:!0}}catch(n){return t(e,409),{error:n?.message||`Registration failed`}}})),e.use(`/_agent-native/auth/logout`,u(async e=>{let t=c(e,z);t&&await U(t),i(e,z,{path:`/`});try{await d.api.signOut({headers:e.headers})}catch{}return R(e)&&await I(),{ok:!0}})),e.use(`/_agent-native/auth/logout-all`,u(async e=>{if(a(e)!==`POST`)return t(e,405),{error:`Method not allowed`};let n=await X(e);if(!n?.email)return t(e,401),{error:`Not authenticated`};try{let t=h(),r;try{let{rows:e}=await t.execute({sql:`SELECT id FROM "user" WHERE email = ?`,args:[n.email]});r=e[0]?.id??e[0]?.[0]}catch{}if(r)try{await t.execute({sql:`DELETE FROM "session" WHERE user_id = ?`,args:[r]})}catch{}try{await t.execute({sql:`DELETE FROM sessions WHERE email = ?`,args:[n.email]})}catch{}i(e,z,{path:`/`});try{await d.api.signOut({headers:e.headers})}catch{}return R(e)&&await I(),{ok:!0}}catch(n){return t(e,500),{error:n?.message||`Failed to revoke sessions`}}})),e.use(`/_agent-native/auth/session`,u(async e=>Z(e)?await X(e)??{error:`Not authenticated`}:(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/migrate-local-data`,$),e.use(`/_agent-native/auth/reset`,u(e=>Z(e)?new Response(at(),{headers:{"Content-Type":`text/html; charset=utf-8`}}):(t(e,405),{error:`Method not allowed`}))),K={loginHtml:n.loginHtml??N({googleOnly:n.googleOnly,marketing:n.marketing}),publicPaths:s};let ee=Y();J=ee,e.use(u(ee))}function En(e,n,r=[]){e.use(`/_agent-native/auth/login`,u(async e=>{if(a(e)!==`POST`)return t(e,405),{error:`Method not allowed`};let r=await p(e);if(!r?.token||typeof r.token!=`string`||!$t(r.token,n))return t(e,401),{error:`Invalid token`};let i=S.randomBytes(32).toString(`hex`);return await H(i,`user`),f(e,z,i,{httpOnly:!0,...Q(e),path:`/`,maxAge:V}),{ok:!0}})),e.use(`/_agent-native/auth/logout`,u(async e=>{let t=c(e,z);return t&&await U(t),i(e,z,{path:`/`}),R(e)&&await I(),{ok:!0}})),e.use(`/_agent-native/auth/session`,u(async e=>Z(e)?await X(e)??{error:`Not authenticated`}:(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/migrate-local-data`,$),K={loginHtml:Sn,publicPaths:r};let o=Y();J=o,e.use(u(o))}function Dn(e){e.use(`/_agent-native/auth/session`,u(async e=>Z(e)?await X(e):(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/login`,u(()=>({ok:!0}))),e.use(`/_agent-native/auth/logout`,u(()=>({ok:!0}))),e.use(`/_agent-native/auth/exit-local-mode`,u(async e=>a(e)===`POST`?await wn()?(gn(e),{ok:!0}):(t(e,500),{error:`Failed to disable local mode`}):(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/migrate-local-data`,$)}function On(e){e.use(`/_agent-native/auth/login`,u(async e=>{if(a(e)!==`POST`)return t(e,405),{error:`Method not allowed`};let n=await p(e),r=n?.email?.trim?.()?.toLowerCase?.(),i=n?.password;if(!r||!i)return t(e,400),{error:`Email and password are required`};try{let n=await(await M()).api.signInEmail({body:{email:r,password:i}});return n?.token?(f(e,z,n.token,{httpOnly:!0,...Q(e),path:`/`,maxAge:V}),await H(n.token,r),R(e)&&await bt({email:r,token:n.token,expiresAt:Date.now()+V*1e3}),{ok:!0}):(t(e,403),{error:`Email not verified. Check your inbox for a verification link.`})}catch(n){return t(e,401),{error:n?.message||`Invalid email or password`}}})),e.use(`/_agent-native/auth/register`,u(async e=>{if(a(e)!==`POST`)return t(e,405),{error:`Method not allowed`};let n=await p(e),r=n?.email?.trim?.()?.toLowerCase?.(),i=n?.password;if(!r||typeof r!=`string`||!r.includes(`@`))return t(e,400),{error:`Valid email is required`};if(!i||typeof i!=`string`||i.length<8)return t(e,400),{error:`Password must be at least 8 characters`};try{return await(await M()).api.signUpEmail({body:{email:r,password:i,name:r.split(`@`)[0]}}),{ok:!0}}catch(n){return t(e,409),{error:n?.message||`Registration failed`}}})),e.use(`/_agent-native/auth/logout`,u(async e=>{let t=c(e,z);t&&await U(t),i(e,z,{path:`/`});try{await(await M()).api.signOut({headers:e.headers})}catch{}return R(e)&&await I(),{ok:!0}})),e.use(`/_agent-native/auth/local-mode`,u(async e=>a(e)===`POST`?B()?m()?await Cn()?{ok:!0}:(t(e,500),{error:`Failed to enable local mode`}):(t(e,400),{error:`Local mode is only available on a local SQLite database. Your DATABASE_URL points at a shared database — create an account instead.`}):(t(e,403),{error:`Local mode is not available in production. Create an account to continue.`}):(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/exit-local-mode`,u(async e=>a(e)===`POST`?await wn()?(gn(e),{ok:!0}):(t(e,500),{error:`Failed to disable local mode`}):(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/session`,u(async e=>Z(e)?await X(e)??{error:`Not authenticated`}:(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/migrate-local-data`,$)}async function kn(e,n={}){if(J&&cn===e)return n.getSession&&(G=n.getSession),K&&((n.googleOnly||n.loginHtml||n.marketing)&&(K.loginHtml=n.loginHtml??N({googleOnly:n.googleOnly,marketing:n.marketing})),n.publicPaths&&(K.publicPaths=[...K.publicPaths??[],...n.publicPaths])),!0;if(J=null,K=null,cn=e,!e){if(await Jt()||B())return rn=!1,G=null,!1;throw Error(`autoMountAuth: H3 app is required. In Nitro plugins, pass nitroApp.h3App.`)}G=null,rn=!1,V=n.maxAge??Gt;let r=n.publicPaths??[];if(n.getSession&&(G=n.getSession),await Jt()){try{await Tn(e,n)}catch(t){console.error(`[agent-native] Failed to initialize Better Auth in local mode:`,t),Dn(e)}return console.log(`[agent-native] Auth mode: local (upgrade path enabled).`),!1}if(G){e.use(`/_agent-native/auth/session`,u(async e=>Z(e)?await X(e)??{error:`Not authenticated`}:(t(e,405),{error:`Method not allowed`}))),e.use(`/_agent-native/auth/login`,u(()=>({ok:!0}))),e.use(`/_agent-native/auth/logout`,u(async e=>{let t=c(e,z);return t&&await U(t),i(e,z,{path:`/`}),R(e)&&await I(),{ok:!0}})),e.use(`/_agent-native/auth/migrate-local-data`,$),K={loginHtml:n.loginHtml??Sn,publicPaths:r};let a=Y();return J=a,e.use(u(a)),process.env.DEBUG&&console.log(`[agent-native] Auth enabled — custom getSession provider.`),!0}if(process.env.AUTH_DISABLED===`true`)return rn=!0,console.warn(`[agent-native] AUTH_DISABLED=true — running without auth. Ensure this app is behind infrastructure-level auth (Cloudflare Access, VPN, etc.).`),Dn(e),!1;let a=Qt();if(a.length>0)return En(e,a,r),process.env.DEBUG&&console.log(`[agent-native] Auth enabled — ${a.length} access token(s) configured.`),!0;try{await Tn(e,n),process.env.DEBUG&&console.log(`[agent-native] Auth enabled — Better Auth (accounts + organizations).`)}catch(t){console.error(`[agent-native] Failed to initialize Better Auth:`,t),On(e),K={loginHtml:n.loginHtml??N({googleOnly:n.googleOnly,marketing:n.marketing}),publicPaths:r};let i=Y();J=i,e.use(u(i)),console.log(`[agent-native] Auth guard registered despite init failure — app is locked.`)}return!0}export{ve as _,B as a,wt as c,ze as d,Be as f,he as g,ge as h,X as i,Je as l,je as m,zt as n,ln as o,Le as p,kn as r,Et as s,un as t,Ve as u};