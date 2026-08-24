---
"@agent-native/core": patch
---

Stop shipping unreachable browser and SSR modules in scheduled-sweep function clones, and deny-list puppeteer. `pruneBrowserRuntimeFromNonAgentClone` drops `@sparticuz/chromium` and `playwright-core` from a clone whose entry rewrites the pathname to a route that cannot reach an agent turn — it throws rather than guessing when the entry names an agent-capable path, because the browser is loaded through a non-literal dynamic import that no static walk can prove dead. Analytics' six cron sweep clones each shed 87.5MB. Separately, `puppeteer`, `puppeteer-core` and `chromium-bidi` join the serverless package denylist: Nitro traced them from officeparser's PDF-output branch, which nothing in this repo reaches.
