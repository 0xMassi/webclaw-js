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
