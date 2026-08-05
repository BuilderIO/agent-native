# Clips Display-Name Prompt Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task. Each step is one
> action. Do not skip steps. Verify after each task. Commit after each task.

**Goal:** Capture a real display name from signed-in Clips users who don't have
one, via a friendly modal at two natural moments, instead of requiring them to
find the field in Settings.

**Architecture:** One shared shadcn `Dialog` component with two copy variants,
driven by one gate hook. The net-new variant mounts on the watch page while the
user's first recording is still processing; the returning variant mounts on the
library index. Both write through the existing core `update-user-profile`
action. A soft "skip" is remembered in `sessionStorage` only, so we ask again
next browser session.

**Tech Stack:** React Router 7, TanStack Query, shadcn/ui, Tabler icons,
`@agent-native/core` actions + i18n, Vitest.

---

## Background the implementer needs

Read this before Task 1. Three non-obvious facts drive the whole design.

### 1. No user ever has an empty name

At signup, Better Auth is handed the email local part as the name:

- `packages/core/src/server/auth.ts:3332` — `name: email.split("@")[0]`
- `packages/core/src/server/auth.ts:3568` — same

And the read path substitutes the full email when nothing is stored:

- `packages/core/src/user-profile/store.ts:19-29` — `getUserProfile()` returns
  `normalizeUserProfileName(storedName ?? authName, email)`
- `packages/core/src/user-profile/shared.ts:8-14` — that helper returns `email`
  when the name is blank

So `get-user-profile` **always** returns a non-empty `name`. A check like
`if (!profile.name)` matches zero users and the modal would never appear.

The only workable predicate is "the name still looks auto-derived":

```
name === email  ||  name === email.split("@")[0]
```

This has a known false positive: a user genuinely named `tim` at `tim@…` looks
identical to one who never set a name.

**That ambiguity only applies to returning users.** A brand-new signup's name is
the local part *by construction* — core auth wires no social/OAuth provider, so
`auth.ts:3332` and `:3568` are the only ways a user row is created. So the two
surfaces use different predicates:

| Surface | Predicate | Why |
| --- | --- | --- |
| Net-new (watch page) | `isAutoDerivedName()` — local part, full email, or blank | They cannot have chosen a name yet. Ask openly. |
| Returning (library) | `matchesEmailLocalPart()` — exactly the local part | Narrower on purpose. Frame it as a confirmation, and never bother anyone whose name differs. |

### 2. There are two display-name stores, and one is dead

| Store | Written by | Read by |
| --- | --- | --- |
| Core `user-profile` (Better Auth `user.name`) | `AccountSettingsCard` on the **Account** tab, `_app.settings._index.tsx:840` | `server/jobs/transactional-emails.ts:410` — the sender name on notification emails share recipients receive |
| `clips-user-prefs.displayName` | Hand-rolled Profile card on the **General** tab, `_app.settings._index.tsx:1480-1503` | **Nothing.** Grep confirms zero consumers. |

The core store is the real one. Task 6 deletes the dead card and its key.

### 3. `application_state` is per-user forever, not per-session

Despite the column name, `getSessionId()` returns the user's email:

- `packages/core/src/application-state/handlers.ts:24-33`

So `application_state` cannot express "ask again next session". Use
`sessionStorage` for the soft skip. This matches how Clips already stores
dismissals (`app/lib/capture-install-options.ts:12-64` uses `localStorage`);
we want the shorter lifetime.

### Product decisions already made

- **One store.** Modal writes to core `update-user-profile`; the dead Clips
  Profile card is deleted.
- **Returning users are prompted on the library index**, not the watch page,
  and only when their name is exactly the email local part. The dialog is a
  confirmation pre-filled with that value, not an empty ask.
- **Skip is soft** — we ask again next browser session.

---

## Task 1: Shared prompt dialog component

**Files:**

- Create: `templates/clips/app/components/profile/name-prompt-dialog.tsx`

**Step 1: Create the directory**

```bash
mkdir -p code/templates/clips/app/components/profile
```

**Step 2: Create the file with this exact content**

```tsx
import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_NAME_LENGTH = 120;

export type NamePromptVariant = "welcome" | "welcome-back";

export interface NamePromptDialogProps {
  open: boolean;
  variant: NamePromptVariant;
  /**
   * Pre-filled field value. The `welcome-back` variant passes the email local
   * part so the user can confirm it with one click; `welcome` passes nothing.
   */
  initialName?: string;
  /** Called with `true` after a successful save, `false` on skip/dismiss. */
  onResolved: (saved: boolean) => void;
}

export function NamePromptDialog({
  open,
  variant,
  initialName = "",
  onResolved,
}: NamePromptDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [seededFor, setSeededFor] = useState(initialName);

  // `initialName` arrives after the profile query resolves, which is usually
  // after first render. Seed the field once it changes rather than stranding
  // the user with an empty confirm box.
  if (initialName !== seededFor) {
    setSeededFor(initialName);
    setName(initialName);
  }

  const updateProfile = useActionMutation<
    { email: string; name: string },
    { name: string }
  >("update-user-profile", {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["action", "get-user-profile"] }),
        queryClient.invalidateQueries({ queryKey: ["session"] }),
      ]);
      toast.success(t("namePrompt.saved"));
      onResolved(true);
    },
    onError: (err: any) =>
      toast.error(err?.message ?? t("namePrompt.saveFailed")),
  });

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !updateProfile.isPending;

  function handleSubmit() {
    if (!canSubmit) return;
    updateProfile.mutate({ name: trimmed.slice(0, MAX_NAME_LENGTH) });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !updateProfile.isPending) onResolved(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {variant === "welcome"
              ? t("namePrompt.welcomeTitle")
              : t("namePrompt.welcomeBackTitle")}
          </DialogTitle>
          <DialogDescription>
            {variant === "welcome"
              ? t("namePrompt.welcomeBody")
              : t("namePrompt.welcomeBackBody")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="profile-name-prompt">{t("namePrompt.label")}</Label>
          <Input
            id="profile-name-prompt"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={t("namePrompt.placeholder")}
            disabled={updateProfile.isPending}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t("namePrompt.visibilityDisclaimer")}
          </p>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            disabled={updateProfile.isPending}
            onClick={() => onResolved(false)}
          >
            {t("namePrompt.skip")}
          </Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {updateProfile.isPending
              ? t("namePrompt.saving")
              : variant === "welcome"
                ? t("namePrompt.save")
                : t("namePrompt.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Verify it compiles**

```bash
cd code/templates/clips && npx tsc --noEmit -p . 2>&1 | grep -v "actions-registry\|virtual:react-router"
```

Expected: no output (the two filtered lines are pre-existing generated-file
errors present on a clean tree).

**Step 4: Commit**

```bash
git add code/templates/clips/app/components/profile/name-prompt-dialog.tsx
git commit -m "Add shared display-name prompt dialog"
```

---

## Task 2: i18n strings

**Files:**

- Modify: `templates/clips/app/i18n/en-US.ts` and the 10 other locale catalogs

**Step 1: Add the `namePrompt` namespace to `en-US.ts`**

Insert as a new top-level key, alphabetically near `navigation`:

```ts
  namePrompt: {
    welcomeTitle: "Your first clip is on its way",
    welcomeBody:
      "While it finishes processing: you can share it with a link, and anyone you send it to can watch it and leave comments. First though — what should we call you?",
    welcomeBackTitle: "Welcome back to Clips",
    welcomeBackBody:
      "We've reconfigured how user profiles work since your last login. Is this the right username for you?",
    label: "Your name",
    placeholder: "e.g. Tim Milazzo",
    visibilityDisclaimer:
      "This name may be visible to anyone you share a clip with.",
    save: "Save",
    confirm: "Looks right",
    saving: "Saving...",
    skip: "Not now",
    saved: "Thanks — we'll call you that from now on",
    saveFailed: "Couldn't save your name",
  },
```

**Step 2: Add the same key set to the other 10 catalogs**

Files: `zh-CN.ts`, `zh-TW.ts`, `es-ES.ts`, `fr-FR.ts`, `de-DE.ts`, `ja-JP.ts`,
`ko-KR.ts`, `pt-BR.ts`, `hi-IN.ts`, `ar-SA.ts`. Same keys, translated values,
no placeholders to preserve in this set.

**Step 3: Verify**

```bash
cd code && pnpm guard:i18n-catalogs
```

Expected: `[guard:i18n-catalogs] checked 18 catalog directories` and exit 0.

**Step 4: Commit**

```bash
git add code/templates/clips/app/i18n
git commit -m "Add display-name prompt strings to all locales"
```

---

## Task 3: Gate hook

**Files:**

- Create: `templates/clips/app/hooks/use-profile-name-prompt.ts`

**Step 1: Create the file with this exact content**

```ts
import {
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useCallback, useState } from "react";

const SKIP_SESSION_KEY = "clips:profile-name-prompt-skipped";

export function emailLocalPart(email: string): string {
  return email.split("@")[0] ?? "";
}

/**
 * Signup writes `email.split("@")[0]` into the auth user's name
 * (packages/core/src/server/auth.ts:3332), and the profile reader substitutes
 * the full email when nothing is stored. So "no name" is never null — it is
 * one of those two derived values.
 *
 * Used for the net-new surface, where the user cannot yet have chosen a name.
 */
export function isAutoDerivedName(
  name: string | null | undefined,
  email: string,
): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return true;
  return trimmed === email || trimmed === emailLocalPart(email);
}

/**
 * Narrower predicate for returning users. Only the exact email local part
 * qualifies, because that is the value signup wrote and the only one the
 * confirmation dialog can sensibly pre-fill. Anyone whose name differs —
 * including the rare full-email fallback — is left alone.
 */
export function matchesEmailLocalPart(
  name: string | null | undefined,
  email: string,
): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return false;
  return trimmed === emailLocalPart(email);
}

function readSkipped(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SKIP_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export interface ProfileNamePromptGate {
  /** True when this user should be asked for a display name right now. */
  shouldPrompt: boolean;
  /** Value to pre-fill the field with. Empty for the net-new surface. */
  initialName: string;
  /** Call with the dialog's `saved` result to close and remember the outcome. */
  resolve: (saved: boolean) => void;
}

/**
 * @param enabled Caller-supplied condition for the surface (e.g. "this is
 *   their first recording"). The hook still runs its queries when false so
 *   hook order stays stable; it just never reports `shouldPrompt`.
 * @param surface Picks the predicate and whether the field is pre-filled.
 */
export function useProfileNamePrompt(
  enabled: boolean,
  surface: "new" | "returning",
): ProfileNamePromptGate {
  const { session } = useSession();
  const email = session?.email ?? "";
  const [skipped, setSkipped] = useState(readSkipped);
  const [savedThisMount, setSavedThisMount] = useState(false);

  const profileQ = useActionQuery<{ email: string; name: string }>(
    "get-user-profile",
    undefined,
    { enabled: Boolean(email), retry: false, throwOnError: false },
  );

  const resolve = useCallback((saved: boolean) => {
    if (saved) {
      setSavedThisMount(true);
      return;
    }
    setSkipped(true);
    try {
      window.sessionStorage.setItem(SKIP_SESSION_KEY, "1");
    } catch {
      // Private-mode / storage-disabled: fall back to in-memory skip only.
    }
  }, []);

  const nameQualifies =
    surface === "new"
      ? isAutoDerivedName(profileQ.data?.name, email)
      : matchesEmailLocalPart(profileQ.data?.name, email);

  const shouldPrompt =
    enabled &&
    !skipped &&
    !savedThisMount &&
    Boolean(email) &&
    profileQ.isSuccess &&
    nameQualifies;

  return {
    shouldPrompt,
    initialName: surface === "returning" ? emailLocalPart(email) : "",
    resolve,
  };
}
```

**Step 2: Verify it compiles**

```bash
cd code/templates/clips && npx tsc --noEmit -p . 2>&1 | grep -v "actions-registry\|virtual:react-router"
```

Expected: no output.

**Step 3: Commit**

```bash
git add code/templates/clips/app/hooks/use-profile-name-prompt.ts
git commit -m "Add display-name prompt gate hook"
```

---

## Task 4: Net-new branch on the watch page

The watch page renders a dedicated "still processing" shell when
`recording.status !== "ready" || !recording.videoUrl`
(`app/routes/r.$recordingId.tsx:952-1040`). Mount the prompt there so it
overlays while the first clip finishes, exactly as specified.

"First recording" comes from `useRecordingsCount({ view: "library" })`
(`app/hooks/use-library.ts:88-100`), which calls `list-recordings` with
`countOnly` so it skips the row payload.

**Files:**

- Modify: `templates/clips/app/routes/r.$recordingId.tsx`

**Step 1: Add the imports**

Next to the existing `@/components/...` imports:

```ts
import { NamePromptDialog } from "@/components/profile/name-prompt-dialog";
import { useProfileNamePrompt } from "@/hooks/use-profile-name-prompt";
import { useRecordingsCount } from "@/hooks/use-library";
```

**Step 2: Add the gate near the other derived flags**

Place immediately after `const canArchiveRecording = canEdit;` (currently
`r.$recordingId.tsx:531`). It must sit above the early `return` for the
processing shell so hook order is unconditional:

```ts
const recordingsCountQ = useRecordingsCount({ view: "library" });
const isFirstRecording =
  recordingsCountQ.isSuccess && (recordingsCountQ.data ?? 0) <= 1;
const namePrompt = useProfileNamePrompt(
  isFirstRecording && role === "owner" && recording?.status !== "ready",
  "new",
);
```

**Step 3: Render it inside the processing shell**

Inside the `if (recording.status !== "ready" || !recording.videoUrl)` block,
just before that branch's closing `</div>`:

```tsx
<NamePromptDialog
  open={namePrompt.shouldPrompt}
  variant="welcome"
  onResolved={namePrompt.resolve}
/>
```

**Step 4: Format**

```bash
cd code/templates/clips && npx oxfmt 'app/routes/r.$recordingId.tsx'
```

**Step 5: Verify**

```bash
cd code/templates/clips && npx tsc --noEmit -p . 2>&1 | grep -v "actions-registry\|virtual:react-router"
```

Expected: no output.

**Step 6: Commit**

```bash
git add code/templates/clips/app/routes/r.\$recordingId.tsx
git commit -m "Prompt first-time users for a display name while their clip processes"
```

---

## Task 5: Returning branch on the library index

**Files:**

- Modify: `templates/clips/app/routes/_app.library._index.tsx`

**Step 1: Add the imports**

```ts
import { NamePromptDialog } from "@/components/profile/name-prompt-dialog";
import { useProfileNamePrompt } from "@/hooks/use-profile-name-prompt";
```

**Step 2: Add the gate inside `LibraryIndexRoute`**

```ts
const namePrompt = useProfileNamePrompt(true, "returning");
```

No recording-count condition here. Someone with zero recordings who lands on
the library is still a returning user by every signal we have, and the net-new
path only fires on the watch page — so the two surfaces cannot double-prompt.

The `"returning"` surface narrows the predicate to an exact email-local-part
match and supplies that value as the pre-filled field, turning the dialog into
a one-click confirmation. Anyone whose stored name differs never sees it.

**Step 3: Wrap the returned JSX**

Change the `return <LibraryGrid ... />` into a fragment:

```tsx
return (
  <>
    <LibraryGrid ... />
    <NamePromptDialog
      open={namePrompt.shouldPrompt}
      variant="welcome-back"
      initialName={namePrompt.initialName}
      onResolved={namePrompt.resolve}
    />
  </>
);
```

**Step 4: Format and verify**

```bash
cd code/templates/clips && npx oxfmt app/routes/_app.library._index.tsx && npx tsc --noEmit -p . 2>&1 | grep -v "actions-registry\|virtual:react-router"
```

Expected: no output from tsc.

**Step 5: Commit**

```bash
git add code/templates/clips/app/routes/_app.library._index.tsx
git commit -m "Prompt returning users without a display name on the library"
```

---

## Task 6: Delete the dead Clips profile field

`clips-user-prefs.displayName` is written by the General-tab Profile card and
read by nothing. The Account tab already has a working display-name field
backed by the core profile store, so no capability is lost.

**Files:**

- Modify: `templates/clips/app/routes/_app.settings._index.tsx`
- Modify: `templates/clips/shared/clips-ai-prefs.ts`

**Step 1: Delete the Profile card**

Remove the whole `<Card id="profile" ...>` block,
`_app.settings._index.tsx:1480-1503`.

**Step 2: Delete its state and wiring**

- `:433` — `const [displayName, setDisplayName] = useState("");`
- `:499` — `setDisplayName(v.displayName ?? "");`
- `:534` — `displayName: displayName.trim() || undefined,` in `handleSave`
- `:169` — `displayName?: string;` from the local `ClipsUserSettings` interface

**Step 3: Delete the settings-search entry**

Remove the `clips-profile` entry at `_app.settings._index.tsx:804-809`.

**Step 4: Remove the field from the shared type**

In `shared/clips-ai-prefs.ts:28-33`, delete `displayName?: string;` from
`ClipsUserPrefs`.

Leave any already-persisted `displayName` values in the settings blob alone.
The PUT route merges partial updates
(`server/routes/_agent-native/clips/user-prefs.put.ts`), so stale keys are inert
and removing them is not worth a migration.

**Step 5: Check for stragglers**

```bash
cd code/templates/clips && grep -rn "displayName" app/ shared/ server/routes/_agent-native/clips/ | grep -v "calendar\|meetings\|feature-flags\|comments-panel\|db/index"
```

Expected: no output.

**Step 6: Verify**

```bash
cd code/templates/clips && npx oxfmt app/routes/_app.settings._index.tsx shared/clips-ai-prefs.ts && npx tsc --noEmit -p . 2>&1 | grep -v "actions-registry\|virtual:react-router"
```

Expected: no output from tsc.

The `settings.profile`, `settings.displayName`, and
`settings.displayNamePlaceholder` i18n keys (`en-US.ts:648-651`) are still used
by other surfaces — leave them.

**Step 7: Commit**

```bash
git add code/templates/clips/app/routes/_app.settings._index.tsx code/templates/clips/shared/clips-ai-prefs.ts
git commit -m "Remove duplicate Clips profile field that wrote to an unread key"
```

---

## Task 7: Unit test the predicate

The predicate is the one piece of logic that silently disables the whole
feature if it drifts. Test it directly.

**Files:**

- Create: `templates/clips/app/hooks/use-profile-name-prompt.test.ts`

**Step 1: Create the file with this exact content**

```ts
import { describe, expect, it } from "vitest";

import {
  isAutoDerivedName,
  matchesEmailLocalPart,
} from "./use-profile-name-prompt";

describe("isAutoDerivedName (net-new surface)", () => {
  it("treats the signup-derived local part as no name", () => {
    // packages/core/src/server/auth.ts:3332 seeds name with the local part.
    expect(isAutoDerivedName("tim", "tim@builder.io")).toBe(true);
  });

  it("treats the full-email fallback as no name", () => {
    // normalizeUserProfileName() substitutes the email when nothing is stored.
    expect(isAutoDerivedName("tim@builder.io", "tim@builder.io")).toBe(true);
  });

  it("treats blank and missing as no name", () => {
    expect(isAutoDerivedName("", "tim@builder.io")).toBe(true);
    expect(isAutoDerivedName(null, "tim@builder.io")).toBe(true);
    expect(isAutoDerivedName("   ", "tim@builder.io")).toBe(true);
  });

  it("accepts a real name", () => {
    expect(isAutoDerivedName("Tim Milazzo", "tim@builder.io")).toBe(false);
  });
});

describe("matchesEmailLocalPart (returning surface)", () => {
  it("matches the exact local part", () => {
    expect(matchesEmailLocalPart("tim", "tim@builder.io")).toBe(true);
  });

  it("does not match the full-email fallback", () => {
    // Deliberately out of scope: the confirm dialog would pre-fill a whole
    // email address, which is not a username anyone would accept.
    expect(matchesEmailLocalPart("tim@builder.io", "tim@builder.io")).toBe(
      false,
    );
  });

  it("does not match blank or missing", () => {
    expect(matchesEmailLocalPart("", "tim@builder.io")).toBe(false);
    expect(matchesEmailLocalPart(null, "tim@builder.io")).toBe(false);
  });

  it("leaves a real name alone", () => {
    expect(matchesEmailLocalPart("Tim Milazzo", "tim@builder.io")).toBe(false);
  });
});
```

**Step 2: Run it**

```bash
cd code/templates/clips && npx vitest run app/hooks/use-profile-name-prompt.test.ts
```

Expected: `Test Files 1 passed`, `Tests 8 passed`.

**Step 3: Commit**

```bash
git add code/templates/clips/app/hooks/use-profile-name-prompt.test.ts
git commit -m "Test display-name detection predicate"
```

---

## Task 8: Browser verification

Type checks prove nothing about whether the modal appears. Drive it for real.

Chromium for Playwright is already installed in this environment. The launcher
lives at
`node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs` —
import it by path, because `playwright` is not resolvable from the repo root.

**Step 1: Force a test user into the no-name state**

```bash
cd code/templates/clips && node --input-type=module -e "
import {neon} from '@neondatabase/serverless';
const sql=neon(process.env.CLIPS_DATABASE_URL);
console.log(await sql\`select id, email, name from \\\"user\\\" where email='dev@local.test'\`);
"
```

If `name` is anything other than `dev` or `dev@local.test`, set it to `dev` so
the predicate matches, and record the original value to restore in Step 4.

**Step 2: Verify the returning-user path**

Script (run from `code/`, delete the file afterwards):

```js
import { chromium } from "./node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://127.0.0.1:8080/clips/library", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
console.log("dialog:", await p.getByRole("dialog").innerText().catch(() => "NONE"));
await p.getByRole("button", { name: /not now/i }).click();
await p.waitForTimeout(500);
console.log("after skip:", await p.getByRole("dialog").count());
await p.reload({ waitUntil: "networkidle" });
await p.waitForTimeout(1500);
console.log("after reload (same session, expect 0):", await p.getByRole("dialog").count());
await b.close();
```

Expected: the welcome-back copy on first load, **with the field pre-filled to
`dev`**; `0` dialogs after skip; `0` after reload within the same browser
session.

**Step 2b: Verify a real name suppresses the returning prompt**

```bash
cd code/templates/clips && node --input-type=module -e "
import {neon} from '@neondatabase/serverless';
const sql=neon(process.env.CLIPS_DATABASE_URL);
await sql\`update \\"user\\" set name='Tim Milazzo' where email='dev@local.test'\`;
"
```

Reload `/clips/library` in a fresh context. Expected: `0` dialogs. Set the name
back to `dev` before continuing.

**Step 3: Verify save persists**

Re-run with a fresh browser context, type a name, click Save, then confirm:

```bash
cd code/templates/clips && node --input-type=module -e "
import {neon} from '@neondatabase/serverless';
const sql=neon(process.env.CLIPS_DATABASE_URL);
console.log(await sql\`select email, name from \\\"user\\\" where email='dev@local.test'\`);
"
```

Expected: `name` is the string that was typed.

**Step 4: Restore the test user's original name**

Do not leave modified fixture state behind.

**Step 5: Commit nothing**

This task produces no source changes.

---

## Task 9: Changelog

**Step 1: Record the user-facing change**

```bash
cd code/templates/clips && npx agent-native changelog add "Clips now asks for your display name when it doesn't have one, instead of hiding it in Settings." --type added
```

**Step 2: Commit**

```bash
git add code/templates/clips/changelog
git commit -m "Add changelog entry for display-name prompt"
```

---

## Final verification checklist

```bash
cd code && pnpm guard:i18n-catalogs
cd code/templates/clips && npx tsc --noEmit -p . 2>&1 | grep -v "actions-registry\|virtual:react-router"
cd code/templates/clips && npx vitest run app/ actions/
```

- [ ] `pnpm guard:i18n-catalogs` exits 0
- [ ] `tsc` reports only the two pre-existing generated-file errors
- [ ] Clips test suite passes
- [ ] Welcome-back modal appears on `/clips/library` when the name is the email
      local part, pre-filled with that value
- [ ] It does **not** appear once the name differs from the local part
- [ ] Skip suppresses it for the rest of the browser session
- [ ] Saving writes the name to the auth user row
- [ ] Settings General tab no longer has a Profile card; Account tab still does

---

## Known limitations

Call these out in the PR description; do not try to solve them here.

1. **False positives on the returning surface only.** A user genuinely named
   `tim` at `tim@…` is indistinguishable from one who never set a name — signup
   writes exactly that value, so no marker exists to tell them apart. The
   confirmation framing ("Is this the right username for you?", pre-filled with
   `tim`) is written so that person can answer in one click rather than being
   accused of having no name. The net-new surface has no such ambiguity: core
   auth wires no social provider, so a fresh account's name is always the
   derived local part.
2. **Returning users whose profile resolves to the full email are never
   prompted.** `matchesEmailLocalPart` deliberately excludes them, because a
   confirm dialog pre-filled with `tim@builder.io` is not a username anyone
   would accept. This only occurs when both the stored setting and the auth
   user's name are blank — not reachable through the normal signup path. They
   can still set a name in Settings.
3. **The disclaimer is currently true only for email.** The name reaches share
   recipients as the sender name on notification emails
   (`server/jobs/transactional-emails.ts:410`). It does **not** yet appear on
   comments — `app/components/player/comments-panel.tsx:153` sends
   `authorName: null`, so comments fall back to the email local part. The copy
   in Task 2 says "may be visible", which is accurate today. Wiring the profile
   name into comment authorship is a separate change.
4. **Net-new detection is a proxy.** `list-recordings --countOnly` with
   `view: "library"` scopes to the current user's personal recordings in the
   active org (`actions/list-recordings.ts:159-171`). Someone who imports two
   Looms before their first native recording will get the returning-user copy.
   Acceptable; the alternative needs a new server field for account age.
