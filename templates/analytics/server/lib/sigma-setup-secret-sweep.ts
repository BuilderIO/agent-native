import { getDbExec } from "@agent-native/core/db";
import { registerRecurringSweepHandler } from "@agent-native/core/server";

const SIGMA_SETUP_SECRET_AGE_MS = 60 * 60 * 1_000;
const SIGMA_SETUP_SECRET_PATTERN =
  "^ANALYTICS_SIGMA_SETUP_[0-9a-f-]{36}_(CLIENT_ID|CLIENT_SECRET|BASE_URL)$";

export async function pruneExpiredSigmaSetupSecrets(now = Date.now()) {
  const exec = getDbExec();
  const { rows } = await exec.execute({
    sql: "SELECT to_regclass('public.app_secrets') AS table_name",
    args: [],
  });
  if (!rows[0]?.table_name) return 0;

  const result = await exec.execute({
    sql: `DELETE FROM public.app_secrets
      WHERE id IN (
        SELECT id
        FROM public.app_secrets
        WHERE scope = 'workspace' AND key ~ ? AND updated_at < ?
        ORDER BY updated_at
        LIMIT 100
      )`,
    args: [SIGMA_SETUP_SECRET_PATTERN, now - SIGMA_SETUP_SECRET_AGE_MS],
  });
  return result.rowsAffected;
}

registerRecurringSweepHandler(
  "analytics-sigma-setup-secrets",
  async ({ signal }) => {
    if (signal?.aborted) return;
    const removed = await pruneExpiredSigmaSetupSecrets();
    if (removed > 0) {
      console.info(
        "[analytics-sigma-setup-secrets] expired staged values removed",
        {
          count: removed,
        },
      );
    }
  },
);
