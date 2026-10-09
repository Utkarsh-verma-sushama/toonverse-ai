# Secure Gemini project probe

The manual workflow `.github/workflows/gemini-project-probe.yml` runs only in the
protected `uvenaro-account-staging` environment.

It performs exactly two provider operations:

1. `GET /v1beta/models` to verify that the selected model is listed and advertises
   the required methods.
2. `POST /v1beta/models/{model}:countTokens` with a synthetic readiness sentence,
   never user content, to verify the non-generation token-count endpoint.

The workflow never calls `generateContent`, Interactions, Live API, background
execution or a paid endpoint. The API key is read only from the protected GitHub
Environment secret, is never printed or committed, and all error bodies are
sanitized. A failed probe exits non-zero and leaves provider activation disabled.

This probe is endpoint evidence only. It does not authorize generation, change billing,
enable a public endpoint or select a final production model.
