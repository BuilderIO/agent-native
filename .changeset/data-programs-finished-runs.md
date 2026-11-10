---
"@agent-native/core": patch
---

Data programs: the read that finalizes a background run serves its rows instead of queueing another run, a failed background run answers reads with its failure until its refresh window lapses instead of running the program again on each read, `get-data-program` reports the newest finished run (and the newest successful one when that run failed) instead of an empty queued row, and a program that throws reports its own message under a new `program_error` code instead of `emit_missing`.
