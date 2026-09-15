import { PGlite } from "@electric-sql/pglite";
const db = await PGlite.create("memory://");
await db.exec(`
CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY, context_id TEXT, status_state TEXT NOT NULL DEFAULT 'submitted',
  status_message TEXT, status_timestamp TEXT NOT NULL, history TEXT NOT NULL DEFAULT '[]',
  artifacts TEXT NOT NULL DEFAULT '[]', metadata TEXT, owner_email TEXT,
  owner_scope TEXT NOT NULL DEFAULT '', idempotency_key TEXT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX idx_a2a_tasks_status_state_created_at ON a2a_tasks(status_state, created_at);
`);
// Realistic: 50k historical terminal rows, 40 non-terminal.
await db.exec(`
INSERT INTO a2a_tasks (id, status_state, status_timestamp, metadata, created_at, updated_at)
SELECT 'done-'||i, (ARRAY['completed','failed','canceled'])[1+(i%3)], 'ts',
       '{"__a2a_processor":{}}', 1000000+i, 1000000+i
FROM generate_series(1,50000) i;
INSERT INTO a2a_tasks (id, status_state, status_timestamp, metadata, created_at, updated_at)
SELECT 'live-'||i, (ARRAY['working','processing','submitted'])[1+(i%3)], 'ts',
       '{"__a2a_processor":{}}', 1000000+i, 1000000+i
FROM generate_series(1,40) i;
ANALYZE a2a_tasks;
`);
const now = 1060000;
const sql = `EXPLAIN ANALYZE SELECT id, status_state, created_at, updated_at, metadata
  FROM a2a_tasks
  WHERE strpos(COALESCE(metadata, ''), '"__a2a_processor"') > 0
  AND (
    (status_state IN ('submitted','working') AND created_at <= ${now})
    OR
    (status_state = 'processing' AND (updated_at <= ${now} OR created_at <= ${now}))
  )
  ORDER BY created_at ASC LIMIT 201`;
const r = await db.query(sql);
console.log(r.rows.map(x => x["QUERY PLAN"]).join("\n"));
await db.close();
