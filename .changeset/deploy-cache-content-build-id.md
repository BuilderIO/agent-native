---
"@agent-native/core": patch
---

Let the workspace deploy build cache hit across commits for apps whose inputs did not change. When a workspace sets `AGENT_NATIVE_BUILD_ID` to its commit and the cache is on, each app is built with a build id derived from its own cache key instead, so an unchanged app restores byte-identical output. The commit is still stamped on Netlify responses as `x-agent-native-build-sha`, next to a new `x-agent-native-app-build-id` header that carries the app's baked id. The deploy writes the expected ids to `.netlify/agent-native-served-builds.json`, and `@agent-native/core/deploy/served-build` exports `checkServedAppBuild` to verify a live response against them.
