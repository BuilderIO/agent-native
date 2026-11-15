"""Route a batch away from Claude until its batch wrapper is proven."""


def codex_fallback(pool, state):
    if state.get("paused_until", {}).get("codex", 0) > pool.now():
        return None, "provider paused"
    if not pool.lock_free("codex"):
        return None, "provider-gate:codex"
    if not pool.quota_allows("codex", 1):
        return None, "quota"
    return "codex", None
