---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

People can switch skills on or off for themselves, and organization admins can choose how each shared skill starts for people. Every skill in Settings → Skills has a switch that changes only the agent of the person who flips it. Admins mark each organization or Dispatch skill Recommended (on until someone switches it off, the default), Optional (off until someone switches it on) or Required (on for everyone, with a confirmation first). A Required skill wins over a same-named skill of anyone's own: their version is kept but unused, in the prompt and in explicit references. Admins see how many people switched each skill and how many keep their own version, never who. Switching or marking a Dispatch skill changes this app only. Nothing changes until someone acts. The new actions are `get-skill-choices`, `set-skill-switch`, `set-skill-mark` and `get-skill-choice-counts`; the client hook is `useSkillChoices` from `@agent-native/core/client/resources/use-skill-choices`.
