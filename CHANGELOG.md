# Changelog

## 0.7.0 - 2026-11-23

- `WebclawError` (and every subclass) now has `requestId?: string`, read from the `x-request-id` response header or the error body's `request_id`. When present it is appended to the message as `(request id: <id>)`. This changes the error text: code that compares error messages exactly, or snapshot tests of them, needs updating.
- **Breaking (type):** `ScrapeResponse.actions_performed` is now `ActionResult[]` (`{ action, success, error? }`), matching what the API returns. It was typed as a number, which never matched a real response.
- **Breaking:** Lead enrichment retired. `lead`, `leadBatch`, `getLeadBatch`, `waitForLeadBatch` and the `Lead*` request/response types are removed. Use `extract` with your own schema for structured page extraction.
