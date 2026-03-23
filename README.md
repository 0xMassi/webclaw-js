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

> **Note**: The webclaw Cloud API is currently in closed beta. [Request early access](https://webclaw.io) or use the [open-source CLI/MCP](https://github.com/0xMassi/webclaw) for local extraction.

---

## Installation

```bash
npm install @webclaw/sdk
```

## Quick Start

```typescript
import { Webclaw } from "@webclaw/sdk";

const client = new Webclaw({ apiKey: "wc_your_api_key" });

const result = await client.scrape({ url: "https://example.com", formats: ["markdown"] });
console.log(result.markdown);
```

## Endpoints

### Scrape

Extract content from a single URL.

```typescript
const result = await client.scrape({
  url: "https://example.com",
  formats: ["markdown", "text", "llm"],
  include_selectors: ["article", ".content"],
  exclude_selectors: ["nav", "footer"],
  only_main_content: true,
  no_cache: true,
});

result.url       // string
result.markdown  // string | undefined
result.text      // string | undefined
result.llm       // string | undefined
result.metadata  // PageMetadata
result.cache     // { status: "hit" | "miss" | "bypass" }
```

### Crawl

Start an async crawl and poll for results.

```typescript
const job = await client.crawl({
  url: "https://example.com",
  max_depth: 3,
  max_pages: 100,
  use_sitemap: true,
});

const status = await job.waitForCompletion({
  interval: 2_000,   // ms
  maxWait: 300_000,  // ms
});

for (const page of status.pages) {
  console.log(page.url, page.markdown?.length);
}
```

### Map

Discover URLs via sitemap.

```typescript
const result = await client.map({ url: "https://example.com" });
console.log(result.count);
result.urls.forEach((url) => console.log(url));
```

### Batch

Scrape multiple URLs in parallel.

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

LLM-powered structured data extraction.

```typescript
// Schema-based
const result = await client.extract({
  url: "https://example.com/pricing",
  schema: { type: "object", properties: { plans: { type: "array" } } },
});

// Prompt-based
const result2 = await client.extract({
  url: "https://example.com",
  prompt: "Extract all pricing tiers with names and prices",
});
```

### Summarize

```typescript
const result = await client.summarize({ url: "https://example.com", max_sentences: 3 });
console.log(result.summary);
```

### Brand

Extract brand identity (colors, fonts, logos).

```typescript
const result = await client.brand({ url: "https://example.com" });
console.log(result);
```

### Search

Web search + parallel scrape of results.

```typescript
const results = await client.search({ query: "web scraping tools 2026" });
for (const r of results.results) {
  console.log(r.title, r.url);
}
```

### Research

Start an async deep research job and poll for results.

```typescript
// Start a research job
const job = await client.research({
  query: "How do modern web crawlers handle JavaScript rendering?",
  maxSources: 15,
  deep: true,
});
console.log("Job started:", job.id);

// Poll for results
const result = await client.getResearchStatus(job.id);
console.log(result.report);
console.log("Sources:", result.sources.length);
```

### Diff

Content change detection.

```typescript
const result = await client.diff({ url: "https://example.com" });
console.log(result.changes);
```

### Agent Scrape

AI-powered agentic extraction -- give a goal, get structured data.

```typescript
const result = await client.agentScrape({
  url: "https://example.com/pricing",
  goal: "Extract all pricing tiers with names and prices",
  max_steps: 5,
});

console.log(result.data);
console.log(`Completed in ${result.total_steps} steps`);
```

## Error Handling

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
  } else if (err instanceof WebclawError) {
    console.error("API error:", err.message, err.status);
  }
}
```

## Configuration

```typescript
const client = new Webclaw({
  apiKey: "wc_your_api_key",
  baseUrl: "https://api.webclaw.io", // default
  timeout: 60_000,                    // ms, default 30_000
});
```

## Highlights

- Zero runtime dependencies -- uses native `fetch`
- ESM + CJS dual output via tsup
- Full TypeScript types for every request and response
- Node.js 18+

## License

MIT
