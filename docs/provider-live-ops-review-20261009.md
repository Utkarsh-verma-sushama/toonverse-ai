# Live operations activation review

Observed: 2026-10-09

Production activation now requires operator-observed evidence, not only static policy or a local fixture:

- alert delivery is observed with a dated record;
- kill-switch behavior is observed with a dated record;
- backup/restore is observed with a dated record;
- rollback is observed against a version-pinned release with a dated record;
- the evidence source is explicitly `operator-observed`.

The current ledger is intentionally pending. It contains no secrets, prompts, answers, or activation authorization. Until a real operator-observed review is recorded, the provider acceptance evaluator remains SAFE_OFF_PENDING and generation remains disabled.
