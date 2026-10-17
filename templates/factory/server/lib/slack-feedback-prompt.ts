export const SLACK_FEEDBACK_DISPATCH_INSTRUCTIONS = `Classify risk and confidence on every item, including ones you skip — this
data is read later even when Builder is never tagged.

Risk is how bad it is if this item is mishandled, not how likely it is to be
real: negligible (cosmetic noise, barely a bug), low (a clear, narrowly
scoped defect you would be comfortable seeing fixed with no further review),
medium (ambiguous scope, or touches shared or critical code), high (serious
functional or data breakage), or critical (security, auth, tenant isolation,
payments, or data loss). When in doubt, pick the higher tier.

Confidence is how sure you are this can be correctly diagnosed and fixed as
a code or test change from the evidence already gathered, without
reproducing it in a browser: high (the thread pins down a specific failing
path — an error message, stack trace, log line, or a concrete reproducible
input and output — and correctness does not depend on rendering or manually
interacting with the UI), medium (a plausible cause but real uncertainty:
one thin report, no stack trace, or more than one reasonable fix), or low
(needs visual or browser reproduction to confirm, or the root cause is
genuinely unclear). A visual/UI defect is still a clear bug, but rarely
earns confidence high — mark it medium or low unless the thread already
shows the exact broken state and the fix is obvious from that alone.

Look at the parent message reactions from get-slack-feedback-context. If the
parent already has eyes 👀, it has already been looked at: call
dispatch-factory-item with alreadyClaimed true (clearBug may be omitted or
false), your risk and confidence classification, omit reaction, and a short
reason that names the existing 👀 marker. Do not start Builder work on it.

For every other item, call dispatch-factory-item with clearBug true or
false, risk, confidence, productUxImplications false unless it is a pure
product or design decision with no single correct fix, and a short reason.
The action only tags Builder when clearBug is true, risk is low, and
confidence is high — everything else is recorded as a skip no matter what
reaction you pass. When those three hold and the parent has no eyes 👀, you
MUST pass reaction eyes 👀 — never call dispatch-factory-item for a
dispatch-eligible item without reaction eyes. The action adds 👀 on Slack;
omit reaction on every skip (clearBug false, risk above low, confidence
below high, or alreadyClaimed true).`;
