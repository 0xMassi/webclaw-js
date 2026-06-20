# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Package-level notes for `sdk-js`. Cross-project context (other repos, deploy,
> infra) lives in the workspace-root `../CLAUDE.md`.

## What This Is

`@webclaw/sdk` — the TypeScript SDK for the Webclaw web-extraction REST API
(`https://api.webclaw.io`). A single `Webclaw` class that wraps each endpoint
with typed request/response shapes, a timeout, polling for async jobs, and a
clean error hierarchy. Zero runtime dependencies (native `fetch`), dual
ESM+CJS output, Node 18+.

## Commands

Package manager is **npm**. There is no lint step — `typecheck` (tsc strict) is the only static check.

```bash
npm run build        # tsup → dist/ (CJS .js + ESM .mjs + .d.ts/.d.mts), cleans first
npm run test         # vitest run (single file, all mocked — no network)
npm run typecheck    # tsc --noEmit

npx vitest run -t "swallows a transient 429"   # run one test by name
npx vitest                                      # watch mode
```

## Architecture

Everything substantive is in four files under `src/` (re-exported from `index.ts`):

| File | Role |
|------|------|
| `client.ts` | `Webclaw` class (all endpoint methods) + `CrawlJob` handle + private HTTP layer + `pollUntilDone` |
| `types.ts` | Request/response interfaces, one `// -- METHOD /v1/path --` block per endpoint |
| `errors.ts` | `WebclawError` base + typed subclasses |
| `index.ts` | Barrel: `export { Webclaw, CrawlJob }` + `export *` of types and errors |

**HTTP layer** — every method funnels through private `request<T>()`, which sets
the `Authorization: Bearer <apiKey>` header, applies an `AbortController`
timeout, and maps the HTTP status to an error class. `post`/`get`/`del` are thin
wrappers over it. To add an endpoint: add types to `types.ts`, add a guarded
method to `client.ts` calling `this.post`/`this.get`.

**Error mapping** (single source of truth in `request()`):

| Status | Error class | Notes |
|--------|-------------|-------|
| 401 | `AuthenticationError` | |
| 402 | `CreditLimitError` | |
| 403 | `ScopeError` | API key missing a scope |
| 404 | `NotFoundError` | |
| 429 | `RateLimitError` | carries `.retryAfter` (seconds, from header) |
| other non-2xx | `WebclawError` | `.status` + `.body` |
| abort/timeout | `TimeoutError` | |

Error message prefers the JSON `{ "error": ... }` field, falling back to raw body then `statusText`.

**Async jobs** — two shapes, intentionally asymmetric:
- `crawl()` returns a **`CrawlJob` handle** → `.waitForCompletion()` / `.getStatus()`.
- `research()` **auto-polls inline** and returns the final `ResearchResponse`.
- `waitForCrawl(id)` / `waitForResearch(id)` poll a job you already have an id for (mirrors sdk-go's `WaitFor*`).

Both run through `pollUntilDone`, which polls until status is `completed`/`failed`
or the outer deadline passes.

## Important Details

- **Async *start* calls disable the per-request timeout** (`crawl`/`research`
  pass `null` as the `timeoutMs` arg to `post`). The start can outlast the
  30s sync budget; completion is bounded by the poll loop's own
  `(interval, maxWait)` deadline instead. Don't "fix" this by adding a timeout.
- **`pollUntilDone` is resilience-tuned**: a per-poll `TimeoutError` or `429`
  is *transient* — swallowed, loop continues (deep research can take ~20 min
  with sub-second polls). 429 honors `retry-after`. Bails after
  `MAX_TRANSIENT_POLL_FAILURES` (5) consecutive transient errors so a broken
  endpoint fails fast. Any other error (404/401/5xx/network) propagates immediately.
- **Empty 2xx body → `undefined`**: `request()` reads `res.text()` and returns
  `undefined as T` for empty bodies (204, or 200/202 no-content like
  `watchCheck`/`watchDelete`). Never `JSON.parse("")`.
- **Every method has a runtime guard** (`if (!params.url) throw new Error("url is required")`)
  on top of the TS types. Tests exercise these with `// @ts-expect-error` — keep the pattern when adding methods.
- **Path params are `encodeURIComponent`'d** (ids can contain `/`).
- **Imports use `.js` extensions** on relative paths (`./errors.js`) even though
  source is `.ts` — required for the ESM build. Match it.
- **Vertical `data` is `Record<string, unknown>` by design** — not 28 exhaustive
  types — so the SDK stays current as the server adds extractors without a
  release. Callers narrow at the call site. Same for `BrandResponse`.
- **Deprecated fields are kept** with `@deprecated` JSDoc (e.g. `ResearchRequest.maxIterations`,
  `ResearchFinding.claim`) for back-compat. Don't delete them; add the snake_case successor alongside.
- **Cross-SDK parity**: sdk-js, sdk-python, and sdk-go expose identical endpoint
  coverage. A new endpoint or response field here should be mirrored in the other two.

## Security Notes

- **`baseUrl` SSRF/key-exfil**: the `apiKey` is sent as a Bearer token to whatever
  origin `baseUrl` is set to. Never point it at untrusted input. (Noted on `WebclawConfig.baseUrl`.)
- **`endpoints()` output is untrusted**: `endpoints`/`hosts`/`value`/`source` are
  extracted from attacker-influenced page JS and are **not** sanitized. Never feed
  them into another fetch, shell, eval, or SQL without your own validation.
