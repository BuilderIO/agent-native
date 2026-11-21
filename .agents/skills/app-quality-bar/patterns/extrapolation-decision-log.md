# Extrapolation decision log

Record these decisions in `DESIGN.md` before writing UI code for a new workflow.

1. Name the user, their object, the task they repeat, and the signal that tells
   them it succeeded.
2. Derive host principles from actual screens: density, navigation hierarchy,
   semantic tokens, keyboard and focus behavior, and where errors appear.
   Name the closest shipped interaction and identify the conditions that differ.
   For a new app choose the closest pattern from this library.
3. Compare two or three concrete UX options. For each, describe where it lives,
   what the user clicks or types, how it behaves at 520 px, and what survives an
   error or reload. Name the chosen option and explicitly record why the
   weaker options were rejected.
4. Review the choice against the experience an experienced product team would
   ship: fast repetition, clear ownership, reachable controls, reversible edits,
   minimal chrome, and obvious recovery. Record how to verify the riskiest
   assumption using a real interaction.
5. Escalate when competing choices change the user's intent, access, or an
   irreversible outcome and the evidence cannot settle it. Use the decision
   log to resolve routine product choices.
