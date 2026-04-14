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

const client = new Webclaw({ apiKey: "fc-YOUR_API_KEY" });

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

### Agent Scrape

AI-guided scraping. Provide a goal in natural language, and the agent navigates the page to extract the data you need.

```typescript
const result = await client.agentScrape({
  url: "https://example.com/pricing",
  goal: "Extract all pricing tiers with plan names, monthly prices, and feature lists",
  max_steps: 5,
});

console.log(result.data);
console.log(`Completed in ${result.total_steps} steps`);
for (const step of result.steps) {
  console.log(`Step ${step.step}:`, step.action);
}
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
  SearchRequest,
  SearchResponse,
  ExtractRequest,
  ExtractResponse,
  ResearchRequest,
  ResearchResponse,
  WatchCreateRequest,
  WatchResponse,
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
