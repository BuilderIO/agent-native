---
"@agent-native/core": patch
---

An error from a Builder API call that Builder refused (`runBuilderAgent`, `createBuilderProject`, `findBuilderProjectForRepo` and `requestBuilderBrowserConnection`) now carries Builder's HTTP status as `builderStatus` for every status. Before, only a 401 was typed, and the status of any other refusal was lost whenever Builder's own error text did not name it. Messages and error types are unchanged: a 401 is still the reconnectable `ActionContractError`, and every other status is still a plain `Error`.
