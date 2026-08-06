
Stop paying Clips' startup data work on every cold start. The boolean-column retype made eleven serialized `information_schema` round trips before the app could serve; it now makes one. The `recordings.org_id` backfill moved from the plugin body into a tracked migration, so it runs once instead of re-scanning for `org_id IS NULL` on every cold start.
