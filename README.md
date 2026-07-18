<p align="center">
  <a href="https://webclaw.io">
    <img src=".github/banner.png" alt="webclaw" width="600" />
  </a>
</p>

<p align="center">
  <strong>TypeScript SDK for the Webclaw web extraction API</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@webclaw/sdk"><img src="https://img.shields.io/npm/v/@webclaw/sdk?style=flat-square&color=212529" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@webclaw/sdk"><img src="https://img.shields.io/node/v/@webclaw/sdk?style=flat-square&color=212529" alt="Node" /></a>
  <a href="https://github.com/0xMassi/webclaw-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-212529?style=flat-square" alt="License" /></a>
</p>

---

## Installation

```bash
npm install @webclaw/sdk
```

```bash
pnpm add @webclaw/sdk
```

```bash
yarn add @webclaw/sdk
```

```bash
bun add @webclaw/sdk
```

## Quick Start

```typescript
import { Webclaw } from "@webclaw/sdk";

const client = new Webclaw({ apiKey: "wc-YOUR_API_KEY" });

const result = await client.scrape({ url: "https://example.com", formats: ["markdown"] });
console.log(result.markdown);
```

## Endpoints

### Scrape

Extract content from a single URL. Supports multiple output formats, CSS selectors for targeting specific elements, and cache control.

```typescript
const result = await client.scrape({
  url: "https://example.com",
  formats: ["markdown", "text", "llm", "json"],
  include_selectors: ["article", ".content"],
  exclude_selectors: ["nav", "footer"],
  only_main_content: true,
  no_cache: true,
});

result.url       // string
result.markdown  // string | undefined
result.text      // string | undefined
result.llm       // string | undefined
result.json      // unknown | undefined
result.metadata  // { title?, description?, language?, ... }
result.cache     // { status: "hit" | "miss" | "bypass" }
result.warning   // string | undefined
```

### Vertical extractors

28 site-specific extractors that return typed JSON (GitHub, Reddit, Amazon, YouTube, PyPI, HuggingFace, Trustpilot, etc.) instead of generic markdown. See the [catalog](https://webclaw.io/docs/api/vertical) for the full list.

```typescript
// Discover available extractors
const catalog = await client.listExtractors();
catalog.extractors.forEach((e) => console.log(e.name, "-", e.label));

// Run a specific extractor
const pr = await client.scrapeVertical(
  "github_pr",
  "https://github.com/rust-lang/rust/pull/123456",
);
console.log(pr.data); // { title, state, author, commits, reviews, ... }

// Amazon product as typed JSON
const product = await client.scrapeVertical(
  "amazon_product",
  "https://www.amazon.com/dp/B0C6KKQ7ND",
);
console.log(product.data.price, product.data.rating);
```

The `data` field is extractor-specific; call `listExtractors()` to discover what each returns.

### Search

Web search with optional parallel scraping of each result page.

```typescript
const result = await client.search({
  query: "web scraping tools 2026",
  num_results: 10,
  scrape: true,
  formats: ["markdown"],
  country: "us",
  lang: "en",
  topic: "technology",
});

for (const r of result.results) {
  console.log(r.title, r.url, r.snippet);
  console.log(r.markdown); // present when scrape: true
}
```

### Map

Discover URLs from a site's sitemap.

```typescript
const result = await client.map({ url: "https://example.com" });
console.log(`Found ${result.count} URLs`);
result.urls.forEach((url) => console.log(url));
```

### Endpoints

Discover API endpoints embedded in a page's JavaScript — scans inline `<script>` bodies plus `<script src>` bundles for request paths, absolute URLs, GraphQL, and WebSocket endpoints. This surfaces the request layer that `map` (sitemap-based) can't see.

```typescript
const result = await client.endpoints({
  url: "https://example.com",
  include_third_party: false, // default; set true to include other hosts
  max_bundles: 20,            // default & max; bundles fetched on top of inline JS
});

console.log(`${result.endpoint_count} endpoints across ${result.bundles_scanned} bundles`);
for (const ep of result.endpoints) {
  console.log(ep.kind, ep.value, ep.first_party ? "(1st-party)" : "(3rd-party)");
}
result.hosts      // distinct hosts seen, e.g. ["api.example.com"]
result.truncated  // true if results were capped by max_bundles
```

> **Security:** `endpoints`, `hosts`, and their fields are extracted from page content (inline scripts and fetched bundles), which is attacker-influenced. The SDK does not sanitize them. Never feed a returned `value` or `source` into another request, shell command, `eval`, or SQL query without your own validation.

### Batch

Scrape multiple URLs in parallel with configurable concurrency.

```typescript
const result = await client.batch({
  urls: ["https://a.com", "https://b.com", "https://c.com"],
  formats: ["markdown"],
  concurrency: 5,
});

for (const item of result.results) {
  if ("error" in item) console.error(item.url, item.error);
  else console.log(item.url, item.markdown?.length);
}
```

### Extract

LLM-powered structured data extraction. Provide a JSON schema for typed output, or a natural-language prompt for flexible extraction.

```typescript
// Schema-based extraction
const result = await client.extract({
  url: "https://example.com/pricing",
  schema: {
    type: "object",
    properties: {
      plans: { type: "array", items: { type: "object" } },
    },
  },
});
console.log(result.data);

// Prompt-based extraction
const result2 = await client.extract({
  url: "https://example.com",
  prompt: "Extract all pricing tiers with names and prices",
});
console.log(result2.data);
```

### Lead Enrichment API

Turn a company URL into a structured lead — name, summary, socials, tech stack, pricing, and contact emails, plus `people`: founders and team members, each with their LinkedIn and X links where found. The `people` list is assembled via web search.

> **Pricing:** a flat **100 credits** per successful lead.

```typescript
const result = await client.lead("https://resend.com");

result.url                     // "https://resend.com"
result.domain                  // "resend.com"
result.lead.company_name       // "Resend"
result.lead.summary            // "Email API for developers."
result.lead.socials            // { linkedin?, x?, github? }
result.lead.tech               // ["Next.js", "React", "AWS"]
result.lead.pricing            // [{ plan: "Free", price: "$0" }, ...]
result.lead.emails             // [{ type: "support", email: "support@resend.com" }, ...]
result.lead.people             // [{ name: "Zeno Rocha", role: "CEO", linkedin: "…", x: "…" }, ...]
result.people_source           // "web_search"
result.cache                   // "hit" | "miss"
result.credits                 // 100
```

Every field on `result.lead` is optional — the extractor fills in whatever it can find. Each person's `linkedin` and `x` are `null` when none was found. Pass `{ no_cache: true }` to force a fresh crawl.

### Summarize

Generate a concise summary of a page's content.

```typescript
const result = await client.summarize({
  url: "https://example.com/blog/long-article",
  max_sentences: 3,
});
console.log(result.summary);
```

### Diff

Detect content changes on a page. Optionally provide a previous state to diff against.

```typescript
const result = await client.diff({
  url: "https://example.com",
  previous: { title: "Old Title", body: "Old content..." },
});
console.log(result.changes);
```

### Brand

Extract brand identity information (name, colors, fonts, logos) from a URL.

```typescript
const result = await client.brand({ url: "https://example.com" });
console.log(result); // { name, colors, fonts, logos, ... }
```

### Research

Start an async deep research job. The SDK automatically polls until the job completes.

```typescript
const result = await client.research(
  {
    query: "How do modern web crawlers handle JavaScript rendering?",
    max_sources: 15,
    deep: true,
  },
  { interval: 3_000, maxWait: 600_000 },
);

console.log(result.report);
console.log("Sources:", result.sources?.length);
console.log("Findings:", result.findings?.length);
```

You can also poll manually using `getResearchStatus`:

```typescript
const job = await client.research({ query: "AI trends 2026" });
// ... or check status independently:
const status = await client.getResearchStatus(job.id);
```

### Crawl

Start an async crawl job that discovers and scrapes pages from a root URL.

```typescript
const job = await client.crawl({
  url: "https://example.com",
  max_depth: 3,
  max_pages: 100,
  use_sitemap: true,
});

console.log("Job ID:", job.id);
```

Poll with `waitForCompletion`, which resolves when the crawl finishes or fails:

```typescript
const result = await job.waitForCompletion({
  interval: 2_000,   // polling interval in ms
  maxWait: 300_000,  // max wait time in ms (5 min)
});

console.log(`Status: ${result.status}`);
console.log(`${result.completed}/${result.total} pages`);
for (const page of result.pages) {
  console.log(page.url, page.markdown?.length);
}
```

Or check status manually at any time:

```typescript
const status = await job.getStatus();
// or: const status = await client.getCrawlStatus(job.id);
```

### Watch

Monitor URLs for content changes. Create watchers, check them on demand, and receive webhook notifications when content changes.

**Create a watch**

```typescript
const watch = await client.watchCreate({
  url: "https://example.com/pricing",
  name: "Pricing page",
  interval_minutes: 60,
  webhook_url: "https://your-server.com/webhooks/webclaw",
});
console.log("Watch ID:", watch.id);
```

**List all watches**

```typescript
const watches = await client.watchList(10, 0); // limit, offset
for (const w of watches) {
  console.log(w.id, w.url, w.active);
}
```

**Get a single watch**

```typescript
const watch = await client.watchGet("watch_abc123");
console.log(watch.last_checked_at, watch.last_changed_at);
```

**Trigger an immediate check**

```typescript
const updated = await client.watchCheck("watch_abc123");
console.log(updated.last_checked_at);
```

**Delete a watch**

```typescript
await client.watchDelete("watch_abc123");
```

### X (Twitter) monitoring

Monitor X for new tweets — profiles, search queries, lists, or replies to a tweet — and receive webhook notifications when new matches appear. The X analog of Watch. You can also export an account's followers or following.

> **Paid feature.** These endpoints return `403` (`ScopeError`) on free or lapsed accounts. Monitors and audience export are billed per X request at your plan rate (Starter 5, Growth 3, Pro 2, Scale 1 credits). Max 50 monitors per account.

**Create a monitor**

```typescript
const monitor = await client.createXMonitor({
  kind: "profile",             // "profile" | "search" | "list" | "replies"
  target: "@webclaw",          // handle | search query | list id | tweet id (per kind)
  name: "Webclaw mentions",
  interval_minutes: 15,        // default 15, clamped 2..10080
  webhook_url: "https://discord.com/api/webhooks/...",
  include_retweets: true,      // default true
  include_replies: true,       // default true
  include_quotes: true,        // default true
  min_faves: 0,                // minimum likes to match
  keyword: "scraping",         // only match tweets containing this
  lang: "en",                  // only match this language
});
console.log("Monitor ID:", monitor.id);
```

**List monitors**

```typescript
const { monitors } = await client.listXMonitors(10, 0); // limit, offset
for (const m of monitors) {
  console.log(m.id, m.kind, m.target, m.active);
}
```

**Get a single monitor**

```typescript
const monitor = await client.getXMonitor("xmon_abc123");
console.log(monitor.last_checked_at, monitor.last_matched_at);
```

**Update a monitor**

```typescript
const res = await client.updateXMonitor("xmon_abc123", {
  name: "Renamed",
  interval_minutes: 30,
  webhook_url: "https://hooks.slack.com/services/...",
  active: false,       // pause it
});
console.log(res.success); // true
```

**Trigger an immediate check**

```typescript
const res = await client.checkXMonitor("xmon_abc123");
console.log(res.status); // "checking" — runs in the background
```

**Delete a monitor**

```typescript
const res = await client.deleteXMonitor("xmon_abc123");
console.log(res.success); // true
```

**Webhook payload**

When a monitor matches new tweets, `webhook_url` receives:

```json
{
  "event": "x.monitor.matched",
  "monitor_id": "xmon_abc123",
  "kind": "profile",
  "target": "webclaw",
  "new_count": 2,
  "tweets": [
    {
      "id": "1790000000000000000",
      "screen_name": "webclaw",
      "text": "…",
      "url": "https://x.com/webclaw/status/1790000000000000000",
      "created_at": "2026-06-12T10:00:00Z",
      "favorite_count": 42,
      "retweet_count": 7,
      "reply_count": 3,
      "lang": "en",
      "is_retweet": false,
      "is_reply": false,
      "is_quote": false
    }
  ],
  "checked_at": "2026-06-12T10:00:05Z"
}
```

Discord and Slack webhook URLs receive native embed/text formatting instead of this generic JSON.

**Export an audience**

Export an account's followers or following, cursor-paginated and metered per page at your plan rate (Starter 5, Growth 3, Pro 2, Scale 1 credits). To walk a full audience, call repeatedly — pass the returned `user_id` and `next_cursor` back in until `next_cursor` is `null`.

```typescript
let cursor: string | null | undefined;
let userId: string | undefined;

do {
  const page = await client.exportXAudience({
    handle: userId ? undefined : "@webclaw", // resolved once (unbilled)
    user_id: userId,                          // reuse to skip re-resolving
    direction: "followers",                   // "followers" (default) | "following"
    cursor: cursor ?? undefined,
    max_pages: 2,                             // default 2, clamped 1..10
  });

  for (const u of page.users) {
    console.log(u.screen_name, u.followers, u.description);
  }

  userId = page.user_id;
  cursor = page.next_cursor;
} while (cursor !== null);
```

### Firecrawl v2 compatibility

The API also exposes a Firecrawl-compatible surface at `/v2/scrape`, `/v2/crawl`, and `/v2/search`. These endpoints are not yet wrapped by this SDK (future work) — call them directly if you need Firecrawl drop-in compatibility today.

## Error Handling

All errors extend `WebclawError`, so you can catch broadly or handle specific cases.

```typescript
import {
  WebclawError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
} from "@webclaw/sdk";

try {
  await client.scrape({ url: "https://example.com" });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error("Rate limited, retry after:", err.retryAfter, "s");
  } else if (err instanceof AuthenticationError) {
    console.error("Bad API key");
  } else if (err instanceof NotFoundError) {
    console.error("Resource not found");
  } else if (err instanceof TimeoutError) {
    console.error("Request timed out");
  } else if (err instanceof WebclawError) {
    console.error("API error:", err.message, err.status, err.body);
  }
}
```

## Configuration

```typescript
const client = new Webclaw({
  apiKey: process.env.WEBCLAW_API_KEY!,
  baseUrl: "https://api.webclaw.io", // default
  timeout: 60_000,                    // ms, default 30_000
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Your Webclaw API key |
| `baseUrl` | `string` | `https://api.webclaw.io` | API base URL |
| `timeout` | `number` | `30000` | Request timeout in milliseconds |

## TypeScript

Full type definitions are included for every request and response. All types are exported from the package root:

```typescript
import type {
  ScrapeRequest,
  ScrapeResponse,
  CrawlRequest,
  CrawlStatusResponse,
  EndpointsRequest,
  EndpointsResponse,
  SearchRequest,
  SearchResponse,
  ExtractRequest,
  ExtractResponse,
  LeadRequest,
  LeadResponse,
  ResearchRequest,
  ResearchResponse,
  WatchCreateRequest,
  WatchResponse,
  CreateXMonitorRequest,
  UpdateXMonitorRequest,
  XMonitor,
  ListXMonitorsResponse,
  ExportXAudienceRequest,
  ExportXAudienceResponse,
  // ... and more
} from "@webclaw/sdk";
```

## Highlights

- Zero runtime dependencies. Uses native `fetch`.
- ESM + CJS dual output via tsup.
- Full TypeScript types for every request and response.
- Automatic polling for async jobs (crawl, research).
- Node.js 18+.

## License

MIT
