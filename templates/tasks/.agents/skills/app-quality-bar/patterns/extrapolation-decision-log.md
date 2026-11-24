# Extrapolation decision log

Record decisions in `DESIGN.md` before implementing the workflow.

1. Cite the user report or observed task. Record the user's goal, current
   obstacle, and how they recognize success. Check shared actions, workspace
   connections, access controls, and sibling apps before designing anything
   new. Confirm which route and build users actually reach and who owns it.
2. Find the nearest shipped interaction. Compare its live behavior with
   its documentation. Record evidence or mark uncertainty for six axes:
   permissions, defaults, admin setup versus member use, discovery and
   empty states, recovery, and deliberate omissions. Check adjacent shipped
   patterns and identify constraints on data, access, and platform support.
3. Compare three concrete options for the same task. Include the simplest
   shortcut, a direct reuse of the nearest interaction, and an adaptation
   using existing workspace primitives. Describe the primary action, narrow
   layout, recovery, and persistence for each. Record the chosen design and
   the constraint or evidence that ruled out each other option.
4. Check whether a new member can tell what to do and who can see the data
   from the screen. Verify useful defaults, reused workspace primitives,
   denied access after revocation, a clear recovery path for each external
   constraint, and persistence after reload.
5. Resolve routine implementation choices from the evidence. Escalate
   unresolved access or privacy policy, external credentials or spend, live
   migrations, irreversible data removal, or competing ownership claims.
