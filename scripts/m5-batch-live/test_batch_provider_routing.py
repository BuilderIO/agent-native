import unittest

from batch_provider_routing import codex_fallback


class Pool:
    def __init__(self, *, lock=True, quota=True, now=100):
        self.lock = lock
        self.quota = quota
        self.time = now

    def now(self):
        return self.time

    def lock_free(self, provider):
        return self.lock

    def quota_allows(self, provider, count):
        return self.quota


class BatchProviderRoutingTest(unittest.TestCase):
    def test_routes_to_codex_when_admissible(self):
        self.assertEqual(codex_fallback(Pool(), {"paused_until": {}}), ("codex", None))

    def test_refuses_codex_when_quota_is_unavailable(self):
        self.assertEqual(
            codex_fallback(Pool(quota=False), {"paused_until": {}}),
            (None, "quota"),
        )

    def test_refuses_codex_when_paused(self):
        self.assertEqual(
            codex_fallback(Pool(), {"paused_until": {"codex": 101}}),
            (None, "provider paused"),
        )

    def test_refuses_codex_when_its_lock_is_taken(self):
        self.assertEqual(
            codex_fallback(Pool(lock=False), {"paused_until": {}}),
            (None, "provider-gate:codex"),
        )


if __name__ == "__main__":
    unittest.main()
