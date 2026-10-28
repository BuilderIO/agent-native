---
"@agent-native/core": patch
---

The turn-into-app skill now hands the app over when it finishes. On a local build, when you are at that machine, it restarts the app with `--open` after the final build, which opens it in your own browser and, on a new app, signs you in. The final report starts with "Your app is open at <URL>" (or the Builder link Dispatch returned), then how to change the app, what each control does, and what the app comes with; PIDs, screenshots and evidence labels follow under Details. The plan it shows before building is in plain words, without archetype codes or the direction tie-break.
