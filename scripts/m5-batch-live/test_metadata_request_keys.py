import unittest

from metadata_request_keys import partition_metadata_rows


class MetadataRequestKeysTest(unittest.TestCase):
    def test_skips_live_invalid_queue_key_and_keeps_valid_peer(self):
        invalid = {"key": "@shared-shared-core-38", "app": "@shared"}
        valid = {"key": "analytics-2-146", "app": "analytics-2"}

        requestable, skipped = partition_metadata_rows([invalid, valid])

        self.assertEqual(requestable, [valid])
        self.assertEqual(skipped, [invalid])

    def test_skips_non_string_key_and_names_it(self):
        invalid = {"key": 145, "app": "analytics-2"}
        valid = {"key": "calendar-2-7", "app": "calendar-2"}

        requestable, skipped = partition_metadata_rows([invalid, valid])

        self.assertEqual(requestable, [valid])
        self.assertEqual(skipped, [invalid])


if __name__ == "__main__":
    unittest.main()
