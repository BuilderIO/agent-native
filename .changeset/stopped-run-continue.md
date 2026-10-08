---
"@agent-native/core": patch
"@agent-native/toolkit": patch
"@agent-native/agentkit": patch
---

Continuing a stopped agent run no longer repeats the steps it already finished. A run the server ends after its worker died now saves its finished tool calls to the thread, a new message after an unfinished turn tells the agent what that turn already did, and the run failure card offers Continue, which resumes the stopped run's own turn so a finished send or charge is not run again. AgentKit transports can implement the new optional `continueRun`.
