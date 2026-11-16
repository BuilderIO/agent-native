import importlib.machinery
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path.home() / ".config/replica-workers/bin/fleet-mail"
loader = importlib.machinery.SourceFileLoader("fleet_mail_tested", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
mail = importlib.util.module_from_spec(spec)
loader.exec_module(mail)


class FleetMailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.allow = self.root / "allow.json"
        self.allow.write_text(json.dumps(["steve" + "@" + "builder.io", "steve" + "@" + "agent-native.com"]))
        self.env_file = self.root / ".env"
        self.env_file.write_text("")

    def test_other_recipient_is_refused(self):
        status, result = mail.send(self.allow, self.env_file, "outsider" + "@" + "example.invalid", "s", "b", opener=None)
        self.assertNotEqual(status, 0)
        self.assertEqual(result["error"], "recipient_refused")

    def test_cc_and_bcc_are_refused_by_the_cli(self):
        for flag in ("--cc", "--bcc"):
            with self.subTest(flag=flag):
                with patch.object(mail.sys, "stdin"), patch.object(mail, "_json_line", return_value=2) as output:
                    status = mail.main(["--to", "steve" + "@" + "builder.io", "--subject", "s", flag])
                self.assertEqual(status, 2)
                self.assertEqual(output.call_args.args[1]["error"], "cc_bcc_refused")

    def test_missing_key_is_named_error(self):
        status, result = mail.send(self.allow, self.env_file, "steve" + "@" + "builder.io", "s", "b", opener=None)
        self.assertNotEqual(status, 0)
        self.assertEqual(result["error"], "missing_sendgrid_api_key")

    def test_allowed_recipient_builds_sendgrid_request(self):
        self.env_file.write_text("SENDGRID_API_KEY=mock-key\n")
        captured = {}
        class Response:
            status = 202
            headers = {"X-Message-Id": "mock-message-id"}
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b""
        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["method"] = request.method
            captured["headers"] = dict(request.header_items())
            captured["body"] = json.loads(request.data)
            captured["timeout"] = timeout
            return Response()
        status, result = mail.send(self.allow, self.env_file, "steve" + "@" + "builder.io", "subject", "body", opener=opener)
        self.assertEqual(status, 0)
        self.assertEqual(result["http_status"], 202)
        self.assertEqual(result["id"], "mock-message-id")
        self.assertEqual(captured["body"]["from"]["email"], "noreply" + "@" + "builder.io")
        self.assertEqual(captured["body"]["personalizations"][0]["to"][0]["email"], "steve" + "@" + "builder.io")
        self.assertEqual(captured["body"]["subject"], "subject")
        self.assertEqual(captured["body"]["content"][0]["value"], "body")
        self.assertNotIn("cc", captured["body"]["personalizations"][0])
        self.assertNotIn("bcc", captured["body"]["personalizations"][0])


if __name__ == "__main__":
    unittest.main()
