---
type: fixed
date: 2026-11-02
---

The Builder-to-merge workflow now merges real pull requests: it takes its repository from the workflow's repository setting, treats skipped checks as fine and cancelled checks as a wait, reads pull requests with more than 100 checks, and says to refresh the GitHub token when GitHub rejects it.
