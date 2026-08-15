import pg from 'pg'
import fs from 'node:fs'
const url = fs.readFileSync('.env','utf8').split('\n').find(l=>l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
const r = await c.query("select id, data from decks where id = $1", ['deck-1786805170323-mwaau'])
if (!r.rows.length) { const t = await c.query("select table_name from information_schema.tables where table_schema='public'"); console.log(t.rows.map(x=>x.table_name).join('\n')); process.exit(1) }
fs.writeFileSync('/tmp/deck.json', JSON.stringify(r.rows[0].data, null, 2))
console.log('ok')
await c.end()
