import { getAppConfig } from "../app-config/index.js";
import {
  isTestIdentityEmail,
  testIdentityEmailSql,
} from "../shared/qa-test-email.js";

/**
 * Whether an email belongs to a test identity on this deployment: the
 * built-in rules plus `testIdentity.emails` (`AGENT_NATIVE_TEST_IDENTITY_EMAILS`).
 * Test identities keep running every flow; metrics and non-auth email skip them.
 */
export function isTestIdentity(value: unknown): boolean {
  return isTestIdentityEmail(value, getAppConfig().testIdentity.emails);
}

/** `isTestIdentity` as a PostgreSQL/BigQuery boolean expression over `column`. */
export function testIdentitySql(column: string): string {
  return testIdentityEmailSql(column, getAppConfig().testIdentity.emails);
}
