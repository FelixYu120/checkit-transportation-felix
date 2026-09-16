# Safe retention

Invariant:

> NO SUPABASE DETAIL DATA MAY BE DELETED UNTIL ITS R2 ARCHIVE HAS PASSED VERIFICATION.

## State machine

```text
building -> uploaded -> verified -> deleted_from_hot
    |          |          |
    +----------+----------+-> failed -> keep source data
```

`uploaded` means bytes reached R2; it is not deletion authority. `verified` requires source/local/downloaded row-count equality, byte-for-byte SHA-256 equality, identity-key equality, ended-at range equality, complete columns, valid `path_points` JSON, and optional sample equality.

## Rolling eligibility

The initial threshold is a rolling seven days (`now - interval`), not calendar midnight. A passage is only a candidate when it is older than the cutoff and covered by a verified manifest range with verification metadata. Reports separate eligible, covered, and unarchived counts.

Dry run is the only supported behavior in this release. The authorization helper requires both:

```text
--execute-delete
--i-understand-this-deletes-data I-UNDERSTAND-THIS-DELETES-DATA
```

Even with both, `execute_retention` refuses to proceed. The checkout did not include the authoritative migration history, and known `reference_measurements` plus views may depend on `traffic_passages`. Therefore FK safety cannot be proven, and no `DELETE` SQL is present. Restore the schema history, run `scripts/inspect_database.py` with a privileged read-only connection, design explicit dependency handling, review it, and test it on staging before adding a production deletion query. Never use `DROP CASCADE`.
