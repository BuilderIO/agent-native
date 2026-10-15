import {
  lineColForOffset,
  readFileSafe,
  relPosix,
  walk,
} from "./scan-utils.js";
import type { GuardFinding, GuardResult } from "./types.js";

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const TEST_FILE = /\.(?:spec|test)\.[^/\\]+$/;
const ACTION_FILE = /(?:^|[/\\])actions(?:[/\\]).+\.[^/\\]+$/;
const ACTION_CALL = /\bdefineAction\s*\(/;
const NO_CHANGE_EVENT =
  /\breadOnly\s*:\s*true\b|\bchangeEvents\s*:\s*false\b|\bmethod\s*:\s*["']GET["']|\beffect\s*:\s*["']read["']/;
const DECLARED = /\bchangeResource\s*:/;
const IMPERATIVE_ACCESS = /\bresolveAccess\s*\(/;
const WRITE_ACCESS =
  /\bassertAccess\s*\([^;]*?["'](?:editor|admin|owner)["']|\blevel\s*:\s*["'](?:editor|admin|owner)["']/s;
const ALLOW = /guard:allow-action-change-resource\b/;

/**
 * A mutating action reaches other collaborators only when its change event
 * names the resource it changed. Core names it from a declared
 * `changeResource`, or from the one resource the call asserted write access to
 * (`assertAccess(..., "editor")` or a declarative `access.resource` with a
 * write level). `resolveAccess` returns a role without saying whether the call
 * meant to write, so an action that checks access only that way stays
 * invisible to everyone but its actor unless it declares `changeResource`.
 */
export function scanActionChangeResource({
  root,
}: {
  root: string;
}): GuardResult {
  const findings: GuardFinding[] = [];
  for (const file of walk(root)) {
    if (
      !SOURCE_FILE.test(file) ||
      TEST_FILE.test(file) ||
      !ACTION_FILE.test(file)
    ) {
      continue;
    }
    const contents = readFileSafe(file);
    if (!contents || !ACTION_CALL.test(contents) || ALLOW.test(contents)) {
      continue;
    }
    if (
      NO_CHANGE_EVENT.test(contents) ||
      DECLARED.test(contents) ||
      !IMPERATIVE_ACCESS.test(contents) ||
      WRITE_ACCESS.test(contents)
    ) {
      continue;
    }
    const { line } = lineColForOffset(contents, contents.search(ACTION_CALL));
    findings.push({
      file: relPosix(root, file),
      line,
      message:
        'This mutating action checks access only with resolveAccess, so core cannot tell which resource it changed and collaborators are never told. Declare changeResource (return null when it changes no shared resource), assert write access with assertAccess(..., "editor"), or mark it readOnly / changeEvents: false.',
    });
  }
  return { name: "action-change-resource", findings };
}
