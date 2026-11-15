"""Keep one malformed lane row from invalidating its peers' metadata request."""

import re
from collections.abc import Mapping


_KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,240}")


def partition_metadata_rows(rows):
    requestable, skipped = [], []
    for row in rows:
        key = row.get("key") if isinstance(row, Mapping) else None
        if isinstance(key, str) and _KEY.fullmatch(key):
            requestable.append(row)
        else:
            skipped.append(row)
    return requestable, skipped
