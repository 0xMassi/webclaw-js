/**
 * Webclaw SDK client. Wraps the webclaw REST API with typed methods,
 * timeout support, and a clean error hierarchy.
 */

import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
  WebclawError,
} from "./errors.js";
import type {
  BatchRequest,
  BatchResponse,
  BrandRequest,
  BrandResponse,
  CrawlPollOptions,
  CrawlRequest,
  CrawlStartResponse,
  CrawlStatusResponse,
  DiffRequest,
  DiffResponse,
  ExtractRequest,
  ExtractResponse,
  MapRequest,
  MapResponse,
  ResearchPollOptions,
  ResearchRequest,
  ResearchResponse,
  ResearchStartResponse,
  ScrapeRequest,
  ScrapeResponse,
  SearchRequest,
  SearchResponse,
  SummarizeRequest,
  SummarizeResponse,
  WatchCreateRequest,
  WatchResponse,
  WebclawConfig,
  ListExtractorsResponse,
  VerticalScrapeResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.webclaw.io";
const DEFAULT_TIMEOUT = 30_000;

export class Webclaw {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: WebclawConfig) {
    if (!config.apiKey) throw new Error("apiKey is required");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  // -- Public API methods --

  /**
   * Scrape a single URL and extract its content.
   * @param params - URL and extraction options (formats, selectors, caching).
   * @returns Extracted content in the requested formats.
   * @throws {WebclawError} On network or API errors.
   */
  async scrape(params: ScrapeRequest): Promise<ScrapeResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<ScrapeResponse>("/v1/scrape", params);
  }

  /**
   * Start an async crawl job that discovers and scrapes pages from a root URL.
   * @param params - Root URL and crawl limits (depth, max pages).
   * @returns A CrawlJob handle for polling or waiting.
   * @throws {WebclawError} On network or API errors.
   */
  async crawl(params: CrawlRequest): Promise<CrawlJob> {
    const res = await this.post<CrawlStartResponse>("/v1/crawl", params);
    return new CrawlJob(res.id, this);
  }

  /**
   * Get the current status and partial results of a crawl job.
   * @param id - Crawl job ID returned by {@link crawl}.
   * @returns Current status, page count, and any completed pages.
   * @throws {NotFoundError} If the crawl job does not exist.
   */
  async getCrawlStatus(id: string): Promise<CrawlStatusResponse> {
    return this.get<CrawlStatusResponse>(`/v1/crawl/${encodeURIComponent(id)}`);
  }

  /**
   * Discover URLs from a site's sitemap.
   * @param params - The root URL to map.
   * @returns List of discovered URLs and total count.
   */
  async map(params: MapRequest): Promise<MapResponse> {
    return this.post<MapResponse>("/v1/map", params);
  }

  /**
   * Scrape multiple URLs in parallel.
   * @param params - Array of URLs, optional formats and concurrency limit.
   * @returns Results for each URL (success or per-URL error).
   */
  async batch(params: BatchRequest): Promise<BatchResponse> {
    if (!params.urls?.length) throw new Error("urls must be a non-empty array");
    return this.post<BatchResponse>("/v1/batch", params);
  }

  /**
   * Extract structured data from a page using an LLM.
   * @param params - URL plus a JSON schema or natural-language prompt.
   * @returns Extracted data matching the requested schema.
   */
  async extract(params: ExtractRequest): Promise<ExtractResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<ExtractResponse>("/v1/extract", params);
  }

  /**
   * Generate a concise summary of a page's content.
   * @param params - URL and optional max sentence count.
   * @returns The generated summary text.
   */
  async summarize(params: SummarizeRequest): Promise<SummarizeResponse> {
    return this.post<SummarizeResponse>("/v1/summarize", params);
  }

  /**
   * Extract brand identity information (name, logo, colors) from a URL.
   * @param params - The URL to analyze.
   * @returns Brand data as a flexible object (shape depends on the site).
   */
  async brand(params: BrandRequest): Promise<BrandResponse> {
    return this.post<BrandResponse>("/v1/brand", params);
  }

  /**
   * Perform a web search query, optionally scraping each result page.
   * @param params - Search query, result count, and optional scrape/format options.
   * @returns Search results with optional scraped content per hit.
   */
  async search(params: SearchRequest): Promise<SearchResponse> {
    if (!params.query) throw new Error("query is required");
    return this.post<SearchResponse>("/v1/search", params);
  }

  /**
   * Detect content changes on a page since a previous snapshot.
   * @param params - URL and optional previous state to diff against.
   * @returns Detected changes between the two states.
   */
  async diff(params: DiffRequest): Promise<DiffResponse> {
    return this.post<DiffResponse>("/v1/diff", params);
  }

  /**
   * Start a research job and poll until completion.
   * Deep research uses a 20-minute timeout by default; normal uses 10 minutes.
   * @param params - Research query and depth options.
   * @param opts - Polling interval and max wait override.
   * @returns Completed research report, sources, and findings.
   * @throws {WebclawError} If polling times out before the job finishes.
   */
  async research(
    params: ResearchRequest,
    opts: ResearchPollOptions = {},
  ): Promise<ResearchResponse> {
    if (!params.query) throw new Error("query is required");
    const start = await this.post<ResearchStartResponse>(
      "/v1/research",
      params,
    );

    const interval = opts.interval ?? 2_000;
    const defaultMax = params.deep ? 1_200_000 : 600_000;
    const maxWait = opts.maxWait ?? defaultMax;

    return pollUntilDone(
      () => this.getResearchStatus(start.id),
      (r) => r.status === "completed" || r.status === "failed",
      { interval, timeout: maxWait },
    );
  }

  /**
   * Poll a research job by id until it's `completed` or `failed`.
   * Mirrors the ergonomics of `sdk-go.WaitForResearch` for callers who
   * already have an id (e.g. persisted from an earlier `/v1/research`
   * call on another process) and want to block-until-done without
   * restarting the job via {@link research}.
   *
   * @throws {WebclawError} If polling times out before the job finishes.
   */
  async waitForResearch(
    id: string,
    opts: ResearchPollOptions = {},
  ): Promise<ResearchResponse> {
    const interval = opts.interval ?? 2_000;
    // No `deep` hint here since we don't have the original request;
    // pick the longer window so shallow jobs finish comfortably.
    const maxWait = opts.maxWait ?? 1_200_000;
    return pollUntilDone(
      () => this.getResearchStatus(id),
      (r) => r.status === "completed" || r.status === "failed",
      { interval, timeout: maxWait },
    );
  }

  /**
   * Poll a crawl job by id until it's `completed` or `failed`.
   * Same semantics as {@link CrawlJob#waitForCompletion} but for callers
   * who have only the id (e.g. persisted or returned from another process).
   * Mirrors `sdk-go.WaitForCompletion`.
   */
  async waitForCrawl(
    id: string,
    opts: CrawlPollOptions = {},
  ): Promise<CrawlStatusResponse> {
    const interval = opts.interval ?? 2_000;
    const maxWait = opts.maxWait ?? 300_000;
    return pollUntilDone(
      () => this.getCrawlStatus(id),
      (s) => s.status === "completed" || s.status === "failed",
      { interval, timeout: maxWait },
    );
  }

  /**
   * Get the current status of a research job without waiting.
   * @param id - Research job ID returned when starting research.
   * @returns Current status and any partial/complete results.
   * @throws {NotFoundError} If the research job does not exist.
   */
  async getResearchStatus(id: string): Promise<ResearchResponse> {
    return this.get<ResearchResponse>(`/v1/research/${encodeURIComponent(id)}`);
  }

  // -- Watch methods --

  async watchCreate(params: WatchCreateRequest): Promise<WatchResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<WatchResponse>("/v1/watch", params);
  }

  async watchList(limit?: number, offset?: number): Promise<WatchResponse[]> {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set("limit", String(limit));
    if (offset !== undefined) query.set("offset", String(offset));
    const qs = query.toString();
    return this.get<WatchResponse[]>(`/v1/watch${qs ? `?${qs}` : ""}`);
  }

  async watchGet(id: string): Promise<WatchResponse> {
    return this.get<WatchResponse>(`/v1/watch/${encodeURIComponent(id)}`);
  }

  async watchDelete(id: string): Promise<void> {
    await this.del(`/v1/watch/${encodeURIComponent(id)}`);
  }

  async watchCheck(id: string): Promise<WatchResponse> {
    return this.post<WatchResponse>(
      `/v1/watch/${encodeURIComponent(id)}/check`,
      {},
    );
  }

  // -- Vertical extractor methods --

  /**
   * List all vertical extractors available on the server. Returns the
   * catalog as `{extractors: [{name, label, description, url_patterns}]}`.
   * Useful for building UIs that let users pick an extractor by name.
   *
   * Extractors return typed JSON specific to the target site (title,
   * price, stars, rating, etc.) rather than generic markdown.
   * See {@link scrapeVertical} to run one.
   */
  async listExtractors(): Promise<ListExtractorsResponse> {
    return this.get<ListExtractorsResponse>("/v1/extractors");
  }

  /**
   * Run a specific vertical extractor by name.
   *
   * The server picks the parser from the `name` path parameter and
   * runs it on `url`. The response envelope is
   * `{vertical, url, data}` where `data` is an extractor-specific
   * JSON object (its fields vary per site).
   *
   * @param name - Vertical extractor name. Call {@link listExtractors}
   *   to discover names. Examples: "reddit", "github_repo",
   *   "trustpilot_reviews", "youtube_video", "shopify_product".
   * @param url - URL to extract. Must match the URL patterns the
   *   extractor claims, or the server returns a 400.
   * @throws {WebclawError} On URL mismatch, unknown vertical, or
   *   upstream fetch failure.
   */
  async scrapeVertical(
    name: string,
    url: string,
  ): Promise<VerticalScrapeResponse> {
    if (!name) throw new Error("name is required");
    if (!url) throw new Error("url is required");
    return this.post<VerticalScrapeResponse>(
      `/v1/scrape/${encodeURIComponent(name)}`,
      { url },
    );
  }

  // -- Internal HTTP layer --

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw new TimeoutError(this.timeout);
      }
      throw new WebclawError(
        err instanceof Error ? err.message : "Network request failed",
      );
    } finally {
      clearTimeout(timer);
    }

    // DELETE with 204 has no body
    if (res.ok && res.status === 204) {
      return undefined as T;
    }

    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        throw new WebclawError("Invalid JSON in response body", res.status);
      }
    }

    const body = await res.text().catch(() => null);
    const parsed = tryParseJson(body);
    const message =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: string }).error)
        : null) ??
      body ??
      res.statusText;

    if (res.status === 401) throw new AuthenticationError(message);
    if (res.status === 404) throw new NotFoundError(message);
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      throw new RateLimitError(retryAfter);
    }

    throw new WebclawError(message, res.status, parsed ?? body);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  private del(path: string): Promise<void> {
    return this.request<void>(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }
}

/**
 * Handle for an in-progress crawl job.
 * Call `.waitForCompletion()` to poll until the crawl finishes.
 */
export class CrawlJob {
  constructor(
    public readonly id: string,
    private readonly client: Webclaw,
  ) {}

  async getStatus(): Promise<CrawlStatusResponse> {
    return this.client.getCrawlStatus(this.id);
  }

  async waitForCompletion(
    opts: CrawlPollOptions = {},
  ): Promise<CrawlStatusResponse> {
    const interval = opts.interval ?? 2_000;
    const maxWait = opts.maxWait ?? 300_000;

    return pollUntilDone(
      () => this.getStatus(),
      (s) => s.status === "completed" || s.status === "failed",
      { interval, timeout: maxWait },
    );
  }
}

// -- Helpers --

/** Polls checkFn until isDone returns true, or timeout is exceeded. */
async function pollUntilDone<T>(
  checkFn: () => Promise<T>,
  isDone: (result: T) => boolean,
  options: { interval: number; timeout: number },
): Promise<T> {
  const deadline = Date.now() + options.timeout;
  while (true) {
    const result = await checkFn();
    if (isDone(result)) return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new WebclawError("Polling timed out");
    await sleep(Math.min(options.interval, remaining));
  }
}

/** Detect abort errors across runtimes (browser DOMException vs Node 18 plain Error). */
function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : null;
}
