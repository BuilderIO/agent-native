/**
 * "1 member" / "N members", without an ICU plural.
 *
 * The plural message (`agentChat.accountMenu.membersCount`) is written as `{count, plural, ...}` in
 * the catalogue, and host applications whose i18n has no ICU plural helper fall back to a
 * humanized key (`"Members count"`), which is what reached the menu before this helper. Two plain
 * messages keep the same copy in every host. */
export function workspaceMembersLabel(
  count: number,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  const copy = t(
    count === 1
      ? "agentChat.accountMenu.membersCountOne"
      : "agentChat.accountMenu.membersCountOther",
    { count },
  );
  // A host whose catalogue does not carry these keys humanizes them, and "Members count other" reached the menu as a
  // placeholder (independent review, 11-11). A member count is a number: never print a key-shaped string for it.
  if (!/\d/.test(copy) || /members?\s+count/i.test(copy)) {
    return count === 1 ? "1 member" : `${count} members`;
  }
  return copy;
}

/**
 * The card at the top of the workspace menu: the workspace name over its member count.
 *
 * The reference leads its workspace menu with the workspace name and a member count. Its line also
 * carries a plan name and an upgrade prompt; those are deliberately not reproduced (no plans, tiers
 * or upgrade prompts), so this reads "<workspace>" over "<n> members".
 */
export function WorkspaceMenuHeader({
  name,
  memberCount,
  membersLabel,
}: {
  name: string;
  /** null while the member count is still loading — the header then shows the name alone. */
  memberCount: number | null;
  /** Pre-formatted “N members”, supplied by the caller so the copy stays in the catalogue. */
  membersLabel: (count: number) => string;
}) {
  return (
    <div data-workspace-menu-header="" className="px-2 pb-1.5 pt-0.5">
      <div
        data-workspace-menu-header-name=""
        className="truncate text-sm font-medium text-foreground"
      >
        {name}
      </div>
      {memberCount !== null ? (
        <div
          data-workspace-menu-header-members={String(memberCount)}
          className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground"
        >
          {membersLabel(memberCount)}
        </div>
      ) : null}
    </div>
  );
}
