# Tamper-evident provider evidence

The live-operations review now requires a SHA-256 integrity envelope in addition to operator-observed timestamps. Evidence is canonicalized with sorted object keys before hashing, and any changed field produces a different digest.

A valid activation record must carry the Uvenaro evidence-integrity protocol, the SHA-256 algorithm, a verified 64-character digest, and the operator-observed source. The current ledger intentionally has `verified: false` and no digest, so it cannot authorize provider generation.

This check does not store prompts, answers, credentials, or raw provider responses. Runtime remains SAFE_OFF_PENDING until the operator review is actually performed and independently authorized.
