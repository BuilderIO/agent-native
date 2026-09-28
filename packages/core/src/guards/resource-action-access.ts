import {
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult } from "./types.js";

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const ACTION_FILE = /(?:^|[/\\])actions(?:[/\\]).+\.[^/\\]+$/;
const ACTION_CALL = /\bdefineAction\s*\(/g;
const RESOURCE_HINT = /\b(?:resourceType|resourceId)\s*:|\bresource\s*:\s*\{/;
const ACCESS_GUARD =
  /\b(?:access\s*:|resource\s*:\s*\{|assertAccess\s*\(|resolveAccess\s*\(|accessFilter\s*\()/;
const ALLOW = /guard:allow-resource-action-access\b/;

export function scanResourceActionAccess({
  root,
}: {
  root: string;
}): GuardResult {
  const warnings: GuardFinding[] = [];
  for (const file of walk(root)) {
    if (!SOURCE_FILE.test(file) || !ACTION_FILE.test(file)) continue;
    const contents = readFileSafe(file);
    if (!contents || ALLOW.test(contents) || !ACTION_CALL.test(contents)) {
      ACTION_CALL.lastIndex = 0;
      continue;
    }
    ACTION_CALL.lastIndex = 0;
    if (!RESOURCE_HINT.test(contents) || ACCESS_GUARD.test(contents)) continue;
    const offset = contents.search(ACTION_CALL);
    const { line } = lineColForOffset(contents, offset);
    warnings.push({
      file: relPosix(root, file),
      line,
      message:
        "This action appears resource-scoped but declares neither access nor assertAccess. Add a declarative access contract or an explicit assertAccess guard.",
    });
  }
  return { name: "resource-action-access", findings: [], warnings };
}
