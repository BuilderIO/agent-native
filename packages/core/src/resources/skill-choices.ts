import { z } from "zod";

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
  SKILL_MARKS,
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
  resourceList,
  resourceListOrganization,
  resourceOwnersAtPaths,
  resourceWorkspaceAppId,
  WORKSPACE_OWNER,
  type EffectiveResourceContext,
  type ResourceMeta,
} from "./store.js";

export * from "./skill-choice-rules.js";

/** A person's switches: `{ [stored key]: { on, at } }`. */
export const SKILL_SWITCHES_SETTING_KEY = "skill-switches";
/** An organization's marks other than Recommended: `{ [stored key]: mark }`. */
export const SKILL_MARKS_SETTING_KEY = "skill-marks";

const skillSwitchSchema = z.object({ on: z.boolean(), at: z.number() });

/** A person's switches and their organization's marks, as actions return them. */
export const skillChoicesSchema = z.object({
  switches: z.partialRecord(z.string(), skillSwitchSchema),
  marks: z.record(z.string(), z.enum(SKILL_MARKS)),
});

/** How the organization's members chose, as `get-skill-choice-counts` returns it. */
export const skillChoiceCountsSchema = z.object({
  members: z.number(),
  counts: z.record(
    z.string(),
    z.object({ off: z.number(), on: z.number(), ownVersions: z.number() }),
  ),
});

const WORKSPACE_KEY_PREFIX = "workspace@";

// A Dispatch skill reaches every app, but switching or marking it in one app
// changes only that app, so its stored key names the app.
function storedKey(source: SkillSource, path: string): string {
  return source === "workspace"
    ? `${WORKSPACE_KEY_PREFIX}${resourceWorkspaceAppId() ?? ""}:${path}`
    : skillChoiceKey(source, path);
}

// A person's switches go with them into every organization they belong to,
// but each organization has its own shared skills, so a switch on one names
// the organization it was made in. Personal skills are the same everywhere.
function storedSwitchKey(
  source: SkillSource,
  path: string,
  orgId: string | null,
): string {
  const key = storedKey(source, path);
  return orgId && source !== "personal" ? `${orgId}/${key}` : key;
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

/** A person's switches as they apply in one organization, or in none. */
function readSwitches(
  value: Record<string, unknown> | null,
  orgId: string | null,
): Record<string, SkillSwitch> {
  const inOrg = orgId ? `${orgId}/` : null;
  const switches: Record<string, SkillSwitch> = {};
  for (const [stored, raw] of Object.entries(value ?? {})) {
    const key = stored.startsWith("personal:")
      ? stored
      : !inOrg
        ? choiceKey(stored)
        : stored.startsWith(inOrg)
          ? choiceKey(stored.slice(inOrg.length))
          : null;
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
  const orgId = input.orgId?.trim() || null;
  const [switches, marks] = await Promise.all([
    email ? getUserSetting(email, SKILL_SWITCHES_SETTING_KEY) : null,
    orgId ? getOrgSetting(orgId, SKILL_MARKS_SETTING_KEY) : null,
  ]);
  return { switches: readSwitches(switches, orgId), marks: readMarks(marks) };
}

export async function setSkillSwitch(
  person: { email: string; orgId: string | null },
  source: SkillSource,
  path: string,
  on: boolean,
  now = Date.now(),
): Promise<SkillSwitch> {
  const { email } = person;
  const key = storedSwitchKey(source, path, person.orgId?.trim() || null);
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
 * The skill file a reference to one path reads: the copy the prompt would
 * use. A Required organization or Dispatch skill comes first, then the first
 * copy the person has on, their own before the organization's and
 * Dispatch's. Asking for a skill by name is explicit, so when every copy is
 * off the reference still reads the usual one.
 */
export function skillReferenceResource(
  effective: Pick<
    EffectiveResourceContext,
    "path" | "effectiveScope" | "effectiveResource" | "layers"
  >,
  choices: SkillChoices,
): ResourceMeta | null {
  const copies = (
    [
      ["personal", "personal"],
      ["shared", "organization"],
      ["workspace", "workspace"],
    ] as const
  ).flatMap(([scope, source]) => {
    const resource = effective.layers.find(
      (entry) => entry.scope === scope,
    )?.resource;
    return resource ? [{ resource, source }] : [];
  });
  const chosen =
    copies.find(
      ({ source }) =>
        skillMarkFor(choices, source, effective.path) === "required",
    ) ??
    copies.find(({ source }) => isSkillOn(choices, source, effective.path));
  return chosen?.resource ?? effective.effectiveResource;
}

/** Paths of the organization and Dispatch skills marked Required. */
export function requiredSkillPaths(choices: SkillChoices): string[] {
  const paths = new Set<string>();
  for (const [key, mark] of Object.entries(choices.marks)) {
    if (mark === "required") paths.add(key.slice(key.indexOf(":") + 1));
  }
  return [...paths];
}

/** A skill file as a reference reads it, with what the prompt orders it by. */
export interface ReferencedSkill extends Pick<
  ResourceMeta,
  "owner" | "path" | "updatedAt"
> {
  name: string;
  content: string;
}

/**
 * The text a reference to one skill path reads. `readSkill` reads the copy
 * at a path that `skillReferenceResource` picks, or null when it can't. The
 * prompt knows skills by name and keeps the first Required one with a name,
 * so a Required skill also replaces a same-named one at another path, such
 * as the person's own. `orderSkills` puts same-named Required skills in the
 * prompt's order (`sortResourceSkills`), so the reference reads the one the
 * prompt keeps.
 */
export async function readSkillReference<T extends ReferencedSkill>(
  path: string,
  choices: SkillChoices,
  readSkill: (path: string) => Promise<T | null>,
  orderSkills: (skills: T[]) => T[],
): Promise<string | null> {
  const skill = await readSkill(path);
  if (!skill) return null;
  const sameName = await Promise.all(
    requiredSkillPaths(choices).map(async (required) => {
      const found = required === path ? skill : await readSkill(required);
      return found?.name === skill.name ? found : null;
    }),
  );
  const replacement = orderSkills(
    sameName.filter((other) => other !== null),
  ).at(0);
  return (replacement ?? skill).content;
}

async function listOrgMemberEmails(orgId: string): Promise<string[]> {
  const { rows } = await getDbExec().execute({
    sql: `SELECT email FROM org_members
          WHERE org_id = ? AND federation_removal_pending_at IS NULL`,
    args: [orgId],
  });
  return rows.map((row) => String(row.email));
}

export async function readSkillChoiceCounts(
  orgId: string,
): Promise<SkillChoiceCounts> {
  const members = await listOrgMemberEmails(orgId);
  const [settings, orgSkills, dispatchSkills] = await Promise.all([
    getUserSettings(members, SKILL_SWITCHES_SETTING_KEY),
    resourceListOrganization(orgId, "skills/"),
    resourceList(WORKSPACE_OWNER, "skills/", { orgId }),
  ]);
  const orgPaths = new Set(orgSkills.map((skill) => skill.path));
  const dispatchPaths = new Set(dispatchSkills.map((skill) => skill.path));
  // Only this organization's skills are counted. Other people's personal
  // skills are theirs alone, and a stored key for anything else says
  // nothing an admin here should see.
  const counted = new Set([
    ...[...orgPaths].map((path) => skillChoiceKey("organization", path)),
    ...[...dispatchPaths].map((path) => skillChoiceKey("workspace", path)),
  ]);
  const counts: Record<string, SkillChoiceCount> = {};
  const bump = (key: string, field: keyof SkillChoiceCount) => {
    counts[key] ??= { off: 0, on: 0, ownVersions: 0 };
    counts[key][field] += 1;
  };
  for (const email of members) {
    const switches = readSwitches(settings.get(email) ?? null, orgId);
    for (const [key, choice] of Object.entries(switches)) {
      if (counted.has(key)) bump(key, choice.on ? "on" : "off");
    }
  }
  // A Required organization or Dispatch skill replaces anyone's own at its
  // path, so admins see how many people have one.
  const owned = await resourceOwnersAtPaths(members, [
    ...new Set([...orgPaths, ...dispatchPaths]),
  ]);
  for (const { path } of owned) {
    if (orgPaths.has(path)) {
      bump(skillChoiceKey("organization", path), "ownVersions");
    }
    if (dispatchPaths.has(path)) {
      bump(skillChoiceKey("workspace", path), "ownVersions");
    }
  }
  return { members: members.length, counts };
}
