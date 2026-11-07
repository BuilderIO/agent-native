import { getDbExec } from "../db/client.js";
import { getOrgSetting, mutateOrgSetting } from "../settings/org-settings.js";
import {
  getUserSetting,
  getUserSettings,
  mutateUserSetting,
} from "../settings/user-settings.js";
import {
  isSkillMark,
  isSkillOn,
  skillChoiceKey,
  skillMarkFor,
  type SkillChoiceCount,
  type SkillChoiceCounts,
  type SkillChoices,
  type SkillMark,
  type SkillSource,
  type SkillSwitch,
} from "./skill-choice-rules.js";
import {
  resourceListOrganization,
  resourceOwnersAtPaths,
  resourceWorkspaceAppId,
  type EffectiveResourceContext,
  type ResourceMeta,
} from "./store.js";

export * from "./skill-choice-rules.js";

/** A person's switches: `{ [stored key]: { on, at } }`. */
export const SKILL_SWITCHES_SETTING_KEY = "skill-switches";
/** An organization's marks other than Recommended: `{ [stored key]: mark }`. */
export const SKILL_MARKS_SETTING_KEY = "skill-marks";

const WORKSPACE_KEY_PREFIX = "workspace@";

// A Dispatch skill reaches every app, but switching or marking it in one app
// changes only that app, so its stored key names the app.
function storedKey(source: SkillSource, path: string): string {
  return source === "workspace"
    ? `${WORKSPACE_KEY_PREFIX}${resourceWorkspaceAppId() ?? ""}:${path}`
    : skillChoiceKey(source, path);
}

/** The `skillChoiceKey` a stored key means in this app, or null if another app's. */
function choiceKey(stored: string): string | null {
  if (!stored.startsWith(WORKSPACE_KEY_PREFIX)) {
    return stored.startsWith("personal:") || stored.startsWith("organization:")
      ? stored
      : null;
  }
  const thisApp = `${WORKSPACE_KEY_PREFIX}${resourceWorkspaceAppId() ?? ""}:`;
  return stored.startsWith(thisApp)
    ? skillChoiceKey("workspace", stored.slice(thisApp.length))
    : null;
}

function isSkillSwitch(value: unknown): value is SkillSwitch {
  if (!value || typeof value !== "object") return false;
  const { on, at } = value as Record<string, unknown>;
  return typeof on === "boolean" && typeof at === "number";
}

function readSwitches(
  value: Record<string, unknown> | null,
): Record<string, SkillSwitch> {
  const switches: Record<string, SkillSwitch> = {};
  for (const [stored, raw] of Object.entries(value ?? {})) {
    const key = choiceKey(stored);
    if (key && isSkillSwitch(raw)) switches[key] = { on: raw.on, at: raw.at };
  }
  return switches;
}

function readMarks(
  value: Record<string, unknown> | null,
): Record<string, SkillMark> {
  const marks: Record<string, SkillMark> = {};
  for (const [stored, raw] of Object.entries(value ?? {})) {
    const key = choiceKey(stored);
    if (key && !key.startsWith("personal:") && isSkillMark(raw)) {
      marks[key] = raw;
    }
  }
  return marks;
}

/** A person's switches and their organization's marks, as this app reads them. */
export async function readSkillChoices(input: {
  email?: string | null;
  orgId?: string | null;
}): Promise<SkillChoices> {
  const email = input.email?.trim();
  const orgId = input.orgId?.trim();
  const [switches, marks] = await Promise.all([
    email ? getUserSetting(email, SKILL_SWITCHES_SETTING_KEY) : null,
    orgId ? getOrgSetting(orgId, SKILL_MARKS_SETTING_KEY) : null,
  ]);
  return { switches: readSwitches(switches), marks: readMarks(marks) };
}

export async function setSkillSwitch(
  email: string,
  source: SkillSource,
  path: string,
  on: boolean,
  now = Date.now(),
): Promise<SkillSwitch> {
  const key = storedKey(source, path);
  const choice: SkillSwitch = { on, at: now };
  await mutateUserSetting(email, SKILL_SWITCHES_SETTING_KEY, (current) => ({
    ...(current ?? {}),
    [key]: choice,
  }));
  return choice;
}

/** Recommended is the default, so it clears the stored mark. */
export async function setSkillMark(
  orgId: string,
  source: Exclude<SkillSource, "personal">,
  path: string,
  mark: SkillMark,
): Promise<void> {
  const key = storedKey(source, path);
  await mutateOrgSetting(orgId, SKILL_MARKS_SETTING_KEY, (current) => {
    const next = { ...(current ?? {}) };
    if (mark === "recommended") delete next[key];
    else next[key] = mark;
    return next;
  });
}

/**
 * The skills the agent may use from each place, in the order it prefers them.
 * Required skills come first, so one beats any same-named skill of the
 * person's own. Switched-off skills drop out before a personal skill hides a
 * shared one at the same path, so switching off your own copy brings the
 * shared one back.
 */
export function applySkillChoices<T extends Pick<ResourceMeta, "path">>(
  layers: { personal: T[]; organization: T[]; workspace: T[] },
  choices: SkillChoices,
): { required: T[]; rest: T[] } {
  const takenPaths = new Set<string>();
  const take = (resource: T) => {
    if (takenPaths.has(resource.path)) return false;
    takenPaths.add(resource.path);
    return true;
  };
  const shared = [
    ...layers.organization.map((resource) => ({
      resource,
      source: "organization" as const,
    })),
    ...layers.workspace.map((resource) => ({
      resource,
      source: "workspace" as const,
    })),
  ];
  const isRequired = (source: SkillSource, path: string) =>
    skillMarkFor(choices, source, path) === "required";

  const required = shared
    .filter(({ resource, source }) => isRequired(source, resource.path))
    .map(({ resource }) => resource)
    .filter(take);
  const rest = [
    ...layers.personal.filter((resource) =>
      isSkillOn(choices, "personal", resource.path),
    ),
    ...shared
      .filter(
        ({ resource, source }) =>
          !isRequired(source, resource.path) &&
          isSkillOn(choices, source, resource.path),
      )
      .map(({ resource }) => resource),
  ].filter(take);
  return { required, rest };
}

/**
 * The skill file a reference to one path reads. A personal copy normally
 * wins, but when the organization's or Dispatch's skill at that path is
 * Required, nobody can use their own version, so the required one does.
 */
export function skillReferenceResource(
  effective: Pick<
    EffectiveResourceContext,
    "path" | "effectiveScope" | "effectiveResource" | "layers"
  >,
  choices: SkillChoices,
): ResourceMeta | null {
  if (effective.effectiveScope !== "personal") {
    return effective.effectiveResource;
  }
  for (const [scope, source] of [
    ["shared", "organization"],
    ["workspace", "workspace"],
  ] as const) {
    const layer = effective.layers.find((entry) => entry.scope === scope);
    if (
      layer?.resource &&
      skillMarkFor(choices, source, effective.path) === "required"
    ) {
      return layer.resource;
    }
  }
  return effective.effectiveResource;
}

async function listOrgMemberEmails(orgId: string): Promise<string[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT email FROM org_members
          WHERE org_id = ? AND federation_removal_pending_at IS NULL`,
    args: [orgId],
  });
  return rows.map((row: any) => String(row.email));
}

export async function readSkillChoiceCounts(
  orgId: string,
): Promise<SkillChoiceCounts> {
  const members = await listOrgMemberEmails(orgId);
  const [settings, orgSkills] = await Promise.all([
    getUserSettings(members, SKILL_SWITCHES_SETTING_KEY),
    resourceListOrganization(orgId, "skills/"),
  ]);
  const counts: Record<string, SkillChoiceCount> = {};
  const bump = (key: string, field: keyof SkillChoiceCount) => {
    counts[key] ??= { off: 0, on: 0, ownVersions: 0 };
    counts[key][field] += 1;
  };
  for (const email of members) {
    const switches = readSwitches(settings.get(email) ?? null);
    for (const [key, choice] of Object.entries(switches)) {
      // Other people's personal skills are theirs alone.
      if (key.startsWith("personal:")) continue;
      bump(key, choice.on ? "on" : "off");
    }
  }
  const owned = await resourceOwnersAtPaths(
    members,
    orgSkills.map((skill) => skill.path),
  );
  for (const { path } of owned) {
    bump(skillChoiceKey("organization", path), "ownVersions");
  }
  return { members: members.length, counts };
}
