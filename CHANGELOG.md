# Changelog

## Unreleased

- **Breaking (type):** `ScrapeResponse.actions_performed` is now `ActionResult[]` (`{ action, success, error? }`), matching what the API returns. It was typed as a number, which never matched a real response.
- **Breaking:** Lead enrichment retired. `lead`, `leadBatch`, `getLeadBatch`, `waitForLeadBatch` and the `Lead*` request/response types are removed. Use `extract` with your own schema for structured page extraction.
