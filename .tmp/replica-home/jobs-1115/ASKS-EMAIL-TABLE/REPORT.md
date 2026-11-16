DONE: The 08:00 Fleet asks email now includes an overnight section with labeled hourly measurements and changes, followed by QUEUE.md content; emails and common secret values are redacted. All requested inputs were readable. Tests passed 26/26. The rendered body is saved at `/Users/steve/Projects/builder/agent-native/.tmp/replica-home/jobs-1115/ASKS-EMAIL-TABLE/rendered.txt`; no email was sent.

Implementation: `asks.py` reads `coordinator-hourly.tsv` and `QUEUE.md` independently, preserves hourly row order, and names any unreadable source explicitly. Tests cover order, queue inclusion, redaction, and both unreadable inputs. The live script was replaced using a temporary file and `mv`; rollback is `cp asks.py.prev-emailtable-1116 asks.py`.

Verification: `cd .tmp/replica-home/lane-deadman && python3 -I -m unittest discover -s tests -v` — 26 passed. Render verification called the script's report builder directly (render-only; no daily/send path), confirmed both subsections, no unreadable marker, and no email address.

00:07 DONE asks-email-table section=yes tests=26/26 rendered=/Users/steve/Projects/builder/agent-native/.tmp/replica-home/jobs-1115/ASKS-EMAIL-TABLE/rendered.txt rollback=cp asks.py.prev-emailtable-1116 asks.py
