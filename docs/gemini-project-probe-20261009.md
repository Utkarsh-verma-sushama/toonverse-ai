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

## Probe result

On 9 October 2026, protected workflow run
[37896363285](https://github.com/Utkarsh-verma-sushama/toonverse-ai/actions/runs/37896363285)
verified `gemini-3.8-flash` through `models.list` and `countTokens`.
The synthetic request returned a total token count of 13. No generation request was
made, and the result is recorded without the key or provider response body.
