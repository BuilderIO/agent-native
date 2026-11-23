/**
 * The account and workspace menus render their actions from handlers the shell
 * receives. Where no handler is passed the item renders disabled, which is a
 * dead control: a tester found Log out, Log out all and every Help row greyed
 * out at sprint-analytics-2#593.
 *
 * This module owns the rules so they can be tested without a browser: which
 * handlers the app can actually back today, what each one does, and the text
 * Copy debug info puts on the clipboard.
 */

export type AccountMenuDeps = {
  /** Ends this session. */
  signOut: () => Promise<void> | void;
  /** Ends every session for the member. */
  signOutAll?: (() => Promise<void> | void) | undefined;
  /** Sends the reader to the signed-out entry point. */
  goHome: () => void;
  /** Writes text to the clipboard. */
  copyText: (text: string) => Promise<void> | void;
  /** Facts about the running build that support needs. */
  debugInfo: () => string;
};

export type AccountMenuHandlers = {
  workspaceMenu: {
    onLogout: () => Promise<void>;
    onLogoutAll?: () => Promise<void>;
  };
  accountMenu: { onCopyDebugInfo: () => Promise<void> };
};

/** Signs out, then leaves the signed-in shell. */
async function signOutAndLeave(
  signOut: () => Promise<void> | void,
  goHome: () => void,
): Promise<void> {
  try {
    await signOut();
  } finally {
    goHome();
  }
}

/**
 * The handlers this app can back. Anything the app has no destination for is
 * deliberately absent here rather than passed as a handler that does nothing:
 * the menu hides a disabled row and a row that cannot work must not read as
 * available.
 */
export function buildAccountMenuHandlers(
  deps: AccountMenuDeps,
): AccountMenuHandlers {
  const handlers: AccountMenuHandlers = {
    workspaceMenu: {
      onLogout: () => signOutAndLeave(deps.signOut, deps.goHome),
    },
    accountMenu: {
      onCopyDebugInfo: async () => {
        await deps.copyText(deps.debugInfo());
      },
    },
  };
  if (deps.signOutAll) {
    const signOutAll = deps.signOutAll;
    handlers.workspaceMenu.onLogoutAll = () =>
      signOutAndLeave(signOutAll, deps.goHome);
  }
  return handlers;
}

/**
 * What Copy debug info puts on the clipboard: enough to identify the build and
 * the surface without carrying a credential or another member's data.
 */
export function debugInfoText(input: {
  appId: string;
  buildSha?: string | null | undefined;
  email?: string | null | undefined;
  url: string;
  userAgent?: string | null | undefined;
  now?: Date | undefined;
}): string {
  const at = (input.now ?? new Date()).toISOString();
  return [
    `app: ${input.appId}`,
    `build: ${input.buildSha?.trim() || "unknown"}`,
    `account: ${input.email?.trim() || "unknown"}`,
    `url: ${input.url}`,
    `at: ${at}`,
    `user agent: ${input.userAgent?.trim() || "unknown"}`,
  ].join("\n");
}
