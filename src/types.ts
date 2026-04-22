/**
 * Request and response types for every Webclaw API endpoint.
 */

// -- Shared --

export type Format = "markdown" | "text" | "llm" | "json";

export interface PageMetadata {
  title?: string;
  description?: string;
  language?: string;
  [key: string]: unknown;
}

// -- POST /v1/scrape --

export interface ScrapeRequest {
  url: string;
  formats?: Format[];
  include_selectors?: string[];
  exclude_selectors?: string[];
  only_main_content?: boolean;
  no_cache?: boolean;
}

export interface ScrapeResponse {
  url: string;
  metadata: PageMetadata;
  markdown?: string;
  text?: string;
  llm?: string;
  json?: unknown;
  cache: { status: "hit" | "miss" | "bypass" };
  warning?: string;
}

// -- POST /v1/crawl --

export interface CrawlRequest {
  url: string;
  max_depth?: number;
  max_pages?: number;
  use_sitemap?: boolean;
}

export interface CrawlStartResponse {
  id: string;
  status: "running";
}

export type CrawlStatus = "running" | "completed" | "failed";

export interface CrawlPage {
  url: string;
  markdown?: string;
  metadata: PageMetadata;
  error?: string;
}

export interface CrawlStatusResponse {
  id: string;
  status: CrawlStatus;
  pages: CrawlPage[];
  total: number;
  completed: number;
  errors: number;
}

// -- POST /v1/map --

export interface MapRequest {
  url: string;
}

export interface MapResponse {
  urls: string[];
  count: number;
}

// -- POST /v1/batch --

export interface BatchRequest {
  urls: string[];
  formats?: Format[];
  concurrency?: number;
}

export interface BatchResultSuccess {
  url: string;
  markdown?: string;
  text?: string;
  llm?: string;
  json?: unknown;
  metadata: PageMetadata;
}

export interface BatchResultError {
  url: string;
  error: string;
}

export type BatchResultItem = BatchResultSuccess | BatchResultError;

export interface BatchResponse {
  results: BatchResultItem[];
}

// -- POST /v1/extract --

export interface ExtractRequest {
  url: string;
  schema?: Record<string, unknown>;
  prompt?: string;
}

export interface ExtractResponse {
  data: Record<string, unknown>;
}

// -- POST /v1/summarize --

export interface SummarizeRequest {
  url: string;
  max_sentences?: number;
}

export interface SummarizeResponse {
  summary: string;
}

// -- POST /v1/brand --

export interface BrandRequest {
  url: string;
}

export interface BrandResponse {
  [key: string]: unknown;
}

// -- POST /v1/search --

export interface SearchRequest {
  query: string;
  num_results?: number;
  topic?: string;
  scrape?: boolean;
  formats?: string[];
  country?: string;
  lang?: string;
}

export interface SearchResponse {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    position: number;
    markdown?: string;
    metadata?: Record<string, unknown>;
  }>;
  scrape: boolean;
}

// -- POST /v1/diff --

export interface DiffRequest {
  url: string;
  previous?: Record<string, unknown>;
}

export interface DiffResponse {
  url: string;
  changes: Record<string, unknown>;
}

// -- POST /v1/research --

export interface ResearchRequest {
  query: string;
  deep?: boolean;
  max_sources?: number;
  max_iterations?: number;
  topic?: string;
  /** @deprecated Use max_iterations */
  maxIterations?: number;
  /** @deprecated Use max_sources */
  maxSources?: number;
}

export interface ResearchStartResponse {
  id: string;
  status: string;
}

export interface ResearchFinding {
  fact: string;
  source_url: string;
  confidence: string;
  /** @deprecated Use fact */
  claim?: string;
  /** @deprecated Use source_url */
  source?: string;
  /** @deprecated Use confidence */
  relevance?: number;
}

export interface ResearchSource {
  url: string;
  title: string;
  words: number;
  /** @deprecated Server may return summary instead of words */
  summary?: string;
}

export interface ResearchResponse {
  id: string;
  query: string;
  status: string;
  report?: string;
  sources?: ResearchSource[];
  findings?: ResearchFinding[];
  sources_count?: number;
  findings_count?: number;
  iterations?: number;
  elapsed_ms?: number;
  deep?: boolean;
}

/** @deprecated Use ResearchResponse */
export type ResearchStatusResponse = ResearchResponse;

// -- Watch endpoints --

export interface WatchCreateRequest {
  url: string;
  name?: string;
  interval_minutes?: number;
  webhook_url?: string;
}

export interface WatchResponse {
  id: string;
  url: string;
  name?: string;
  interval_minutes: number;
  active: boolean;
  webhook_url?: string;
  last_checked_at?: string;
  last_changed_at?: string;
  created_at: string;
  snapshots?: Array<Record<string, unknown>>;
}

// -- Client config --

export interface WebclawConfig {
  apiKey: string;
  baseUrl?: string;
  /** Request timeout in milliseconds. Default 30_000. */
  timeout?: number;
}

export interface CrawlPollOptions {
  /** Polling interval in ms. Default 2000. */
  interval?: number;
  /** Maximum time to wait in ms. Default 300_000 (5 min). */
  maxWait?: number;
}

export interface ResearchPollOptions {
  /** Polling interval in ms. Default 2000. */
  interval?: number;
  /** Maximum time to wait in ms. Default 600_000 (10 min), 1_200_000 for deep. */
  maxWait?: number;
}

// -- Vertical extractor types --

/** One catalog entry from `GET /v1/extractors`. */
export interface ExtractorInfo {
  /** URL-safe identifier, e.g. "reddit", "github_repo". */
  name: string;
  /** Human-friendly display label, e.g. "Reddit thread". */
  label: string;
  /** One-line description of what the extractor returns. */
  description: string;
  /** Glob-ish URL patterns the extractor claims (for documentation). */
  url_patterns: string[];
}

/** Response shape of `GET /v1/extractors`. */
export interface ListExtractorsResponse {
  extractors: ExtractorInfo[];
}

/**
 * Response shape of `POST /v1/scrape/{vertical}`.
 *
 * `data` is extractor-specific: the fields depend on which vertical
 * ran. Narrow to your own type at the call site rather than shipping
 * 28 exhaustive definitions. Keeps the SDK current with the server
 * as new extractors land without requiring a new SDK release.
 */
export interface VerticalScrapeResponse {
  /** The extractor name that ran. */
  vertical: string;
  /** The URL that was requested. */
  url: string;
  /** Extractor-specific typed JSON. Shape depends on `vertical`. */
  data: Record<string, unknown>;
}
