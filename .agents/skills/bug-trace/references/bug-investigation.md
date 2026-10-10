# Investigating one symptom

Use this as the brief for each symptom, whether you investigate yourself or
hand the symptom to a sub-agent. When delegating, paste the whole file plus
the symptom text. Describe the symptom and the entry point only; do not
hand over a theory or a short list of files to look at. A list of starting
files becomes the boundary of the search.

## 1. Trace the path, hop by hop

Write the path from the user's action to the visible result as numbered
hops. For each hop give the file:line, and the precondition it needs
at runtime: what must be mounted, running, authorized, configured, or
present for the hop to work.

Example for a queued background job:

1. Menu click calls the action (`route.tsx:2600`). Needs: editor access.
2. Action writes the request to app state (`queue.ts:42`). Needs: none.
3. A browser bridge relays it to a chat receiver (`use-bridge.ts:473`).
   Needs: a mounted chat receiver that confirms within 10 s.
4. The agent runs and reports status (`update-status.ts:36`). Needs: the
   status record still names this request.

Stop at the hop that produces the visible failure. If you can't name a
hop's precondition, read until you can. Bugs that "intermittently work"
are usually a precondition that is sometimes true: a panel that only
mounts on one tab, a tab that must stay open, a lease, a race.

## 2. Check every precondition against the code as it is today

For each hop, find the code that makes its precondition true, and confirm
it still does. A precondition no code satisfies, or one that holds only
in some UI state, is a lead.

## 3. List what changed on the path

Run system-history's `analyze.ts --focus` with every file on the traced path, not just
the file where the error shows. Read its "Regression candidates" section:
every commit of any kind that touched those files in the regression window.
Read each one with system-history's `pr.ts --pr N --file <path>` and ask: did this change
break a precondition from step 1? Words like "no longer", "got busted", or
"stopped" in a report mean a regression. Expect to find the change.

## 4. Hold at least two explanations

Before settling, write down at least two explanations that fit the
symptom, and a check that would tell them apart. Run the check. Record
the losers and why they lost. When the first explanation feels complete,
look for the second anyway: the first one found is usually the most
visible, not the most likely.

## 5. Reproduce when you can

If the failing path runs in the branch browser or a test, reproduce it.
Watch the status, the network, and the console at each hop. A reproduction
settles which explanation is right, and becomes step 1 of the plan. If you
can't, for example native desktop code, say so. The evidence is then
`traced` (you followed the code and found the broken precondition) or
`inferred` (it fits, but no hop is shown broken).

## 6. Check the framework before calling it local

Search `AGENTS.md`, `.agents/skills/`, and `packages/core` for a rule
or primitive that covers the mechanism. Examples:

- background agents must use the core run manager;
- client code calls actions, not raw state routes;
- an absent value must stay distinct from an unreadable one.

A template that hand-rolls something core already provides is a
parallel-implementation pattern, and the fix is usually to adopt the
primitive. Name it, with its file.

## Report

For the symptom:

- the hop list;
- the broken hop and its precondition;
- the trigger commit (or `none-found` and what you checked);
- the explanations you ruled out, and how;
- the evidence level;
- the framework rule or primitive involved;
- the sibling sites;
- if the caller asked for one, the verdict per its rubric (for example
  `investigate-bug`'s `references/bug-verdicts.md`).
