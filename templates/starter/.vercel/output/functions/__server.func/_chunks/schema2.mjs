import{n as e}from"../_runtime.mjs";import{n as t,r as n}from"./client.mjs";import{i as r}from"./utils.mjs";import{t as i}from"../_libs/@libsql/client+[...].mjs";import a from"path";var o=e({default:()=>u});function s(e){return e.startsWith(`postgres://`)||e.startsWith(`postgresql://`)}async function c(e,t){let n=await e.execute(t);return n.rows.map(e=>{let t={};for(let r=0;r<n.columns.length;r++)t[n.columns[r]]=e[r];return t})}async function l(e,t){let{default:n}=await import(`../_libs/drizzle-orm+postgres.mjs`).then(e=>e.r),r=n(e);try{let n=await r`
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `,i=[];for(let e of n){let t=await r`
        SELECT
          column_name as name,
          data_type as type,
          CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END as notnull,
          column_default as dflt_value
        FROM information_schema.columns
        WHERE table_name = ${e.name}
        ORDER BY ordinal_position
      `,n=await r`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = ${e.name}
          AND tc.constraint_type = 'PRIMARY KEY'
      `,a=new Set(n.map(e=>e.column_name)),o=await r`
        SELECT
          kcu.column_name as "from",
          ccu.table_name as "table",
          ccu.column_name as "to"
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = ${e.name}
          AND tc.constraint_type = 'FOREIGN KEY'
      `,s=(await r`
        SELECT indexname as name, indexdef
        FROM pg_indexes
        WHERE tablename = ${e.name} AND schemaname = 'public'
      `).map(e=>{let t=/\bUNIQUE\b/i.test(e.indexdef),n=e.indexdef.match(/\(([^)]+)\)/),r=n?n[1].split(`,`).map(e=>e.trim()):[];return{name:e.name,unique:t,columns:r}});i.push({name:e.name,columns:t.map(e=>({name:e.name,type:e.type||`ANY`,notnull:e.notnull===1,pk:a.has(e.name),dflt_value:e.dflt_value})),foreignKeys:o.map(e=>({from:e.from,table:e.table,to:e.to})),indexes:s})}if(t.format===`json`){console.log(JSON.stringify({database:e,tables:i},null,2));return}console.log(`Database: ${e}`),console.log(`Tables: ${i.length}\n`);for(let e of i){console.log(`Table: ${e.name} (${e.columns.length} columns)`);let t=new Map;for(let n of e.foreignKeys)t.set(n.from,`${n.table}(${n.to})`);let n=Math.max(...e.columns.map(e=>e.name.length)),r=Math.max(...e.columns.map(e=>e.type.length));for(let i of e.columns){let e=[];i.pk&&e.push(`PRIMARY KEY`),i.notnull&&!i.pk&&e.push(`NOT NULL`),i.dflt_value!==null&&e.push(`DEFAULT ${i.dflt_value}`);let a=t.get(i.name);a&&e.push(`→ ${a}`);let o=e.length>0?`  ${e.join(`, `)}`:``;console.log(`  ${i.name.padEnd(n)}  ${i.type.padEnd(r)}${o}`)}if(e.indexes.length>0){console.log(`  Indexes:`);for(let t of e.indexes){let e=t.unique?`UNIQUE `:``;console.log(`    ${e}${t.name} (${t.columns.join(`, `)})`)}}console.log()}}finally{await r.end()}}async function u(e){let o=r(e);if(o.help===`true`){console.log(`Usage: pnpm action db-schema [--db <path>] [--format json]

Options:
  --db <path>     Path to SQLite database (default: data/app.db)
  --format json   Output as JSON instead of human-readable text
  --help          Show this help message`);return}let u;if(u=o.db?`file:`+a.resolve(o.db):n()?n():`file:`+a.resolve(process.cwd(),`data`,`app.db`),s(u))return l(u,o);let d=i({url:u,authToken:t()});try{let e=(await d.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map(e=>({name:e[0]})),t=[];for(let n of e){let e=n.name.replace(/"/g,`""`),r=await c(d,`PRAGMA table_info("${e}")`),i=await c(d,`PRAGMA foreign_key_list("${e}")`),a=await c(d,`PRAGMA index_list("${e}")`),o=[];for(let e of a){let t=e.name;if(t.startsWith(`sqlite_`))continue;let n=await c(d,`PRAGMA index_info("${t.replace(/"/g,`""`)}")`);o.push({name:t,unique:e.unique===1,columns:n.map(e=>e.name)})}t.push({name:n.name,columns:r.map(e=>({name:e.name,type:e.type||`ANY`,notnull:e.notnull===1,pk:e.pk===1,dflt_value:e.dflt_value})),foreignKeys:i.map(e=>({from:e.from,table:e.table,to:e.to})),indexes:o})}if(o.format===`json`){let e=u.startsWith(`file:`)?u.slice(5):u;console.log(JSON.stringify({database:e,tables:t},null,2));return}let n=u.startsWith(`file:`)?u.slice(5):u;console.log(`Database: ${n}`),console.log(`Tables: ${t.length}\n`);for(let e of t){console.log(`Table: ${e.name} (${e.columns.length} columns)`);let t=new Map;for(let n of e.foreignKeys)t.set(n.from,`${n.table}(${n.to})`);let n=Math.max(...e.columns.map(e=>e.name.length)),r=Math.max(...e.columns.map(e=>e.type.length));for(let i of e.columns){let e=[];i.pk&&e.push(`PRIMARY KEY`),i.notnull&&!i.pk&&e.push(`NOT NULL`),i.dflt_value!==null&&e.push(`DEFAULT ${i.dflt_value}`);let a=t.get(i.name);a&&e.push(`→ ${a}`);let o=e.length>0?`  ${e.join(`, `)}`:``;console.log(`  ${i.name.padEnd(n)}  ${i.type.padEnd(r)}${o}`)}if(e.indexes.length>0){console.log(`  Indexes:`);for(let t of e.indexes){let e=t.unique?`UNIQUE `:``;console.log(`    ${e}${t.name} (${t.columns.join(`, `)})`)}}console.log()}}finally{d.close()}}export{o as t};