import { sql, type SQL } from "drizzle-orm";

import { schema } from "../server/db/index.js";

export const slides2DeckScope: SQL<unknown> = sql`CASE WHEN ${schema.decks.data} IS JSON OBJECT THEN (${schema.decks.data}::jsonb ->> 'appId') = 'slides-2' ELSE false END`;
