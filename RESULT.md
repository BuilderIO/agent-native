PR: https://github.com/BuilderIO/agent-native/pull/9496
Merge sha: 4701235d7ef274e451a77eefa7ee2c308dbd8ab8
Root cause: personal memory was stored per-app/per-DB and the compact prompt omitted the memory index, so a fact saved in one chat/harness was not visible in a new chat; the prompt also did not force `save-memory` on "remember".
