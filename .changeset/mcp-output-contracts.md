---
"@agent-native/core": minor
---

Add opt-in MCP output contracts. An action with `outputErrorStrategy: "strict"` and `mcpOutputSchema: true` advertises its `outputSchema` to MCP clients in the shape they receive (array roots wrapped as `{ items }`, open-link fields for linked actions, embed redaction allowed for), and each `structuredContent`, including its formats, is validated against it. Actions without the opt-in advertise no output schema, as before. A strict output mismatch, or an output validator that throws, now raises `ActionOutputContractError` (`errorCode: "output_contract_violation"`). The error carries `effect: "none"` for read-only calls and `effect: "committed"` for writes that already applied, classified from the validated arguments, and its message never includes returned values. Committed failures still refresh other sessions over MCP, HTTP, and the in-app agent.
