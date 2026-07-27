/**
 * CLI dispatcher for `pnpm action ...`.
 *
 * This file lives in actions/ so the Agent Native CLI can find it. It is skipped
 * by action discovery and is not exposed as an agent tool.
 */
import { runScript } from "@agent-native/core/scripts";

runScript();
