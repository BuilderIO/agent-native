---
"@agent-native/core": patch
---

Make the Personal/Workspace secret scope consequence visible before it bites.

The scope picker in Settings → API Keys & Connections now carries inline
helper text explaining that a Personal key is only used by that person's own
signed-in sessions, and that integration, webhook, scheduled job, automation,
and agent-to-agent runs sign in as their owner and cannot read it.

When the trap is hit anyway, the provider API "credential not configured"
error now explains it: if a key of that name is saved in the caller's own
organization under Personal scope, the error names the scope it was found in
and the scope the run needed. The probe is bounded to the caller's own org and
reports only the scope kind — never the value, the owning account, or anything
about another tenant.
