/**
 * Webclaw SDK client. Wraps the webclaw REST API with typed methods,
 * timeout support, and a clean error hierarchy.
 */

import {
  AuthenticationError,
  CreditLimitError,
  NotFoundError,
  RateLimitError,
  ScopeError,
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
  EndpointsRequest,
  EndpointsResponse,
  ExtractRequest,
  ExtractResponse,
  LeadBatchOptions,
  LeadBatchPollOptions,
  LeadBatchResponse,
  LeadBatchStartResponse,
  LeadOptions,
  LeadResponse,
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
  CreateXMonitorRequest,
  UpdateXMonitorRequest,
  XMonitor,
  ListXMonitorsResponse,
  XMonitorMutationResponse,
  XMonitorCheckResponse,
  ExportXAudienceRequest,
  ExportXAudienceResponse,
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
    if (!params.url) throw new Error("url is required");
    // Async start: no per-request timeout. The job is awaited via
    // polling (which keeps its own deadline), not this call.
    const res = await this.post<CrawlStartResponse>("/v1/crawl", params, null);
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
    if (!params.url) throw new Error("url is required");
    return this.post<MapResponse>("/v1/map", params);
  }

  /**
   * Discover API endpoints embedded in a page's JavaScript.
   *
   * Scans the page's inline `<script>` bodies plus its `<script src>`
   * bundles for request paths, absolute URLs, GraphQL, and WebSocket
   * endpoints — the API surface that {@link map} (sitemap-based)
   * cannot see. Credit cost: 2.
   *
   * SECURITY: the returned `endpoints`/`hosts` are extracted from
   * attacker-influenced page content and are NOT sanitized by the SDK.
   * Do not feed any returned `value`/`source` into another fetch,
   * shell, eval, or SQL without your own validation. See
   * {@link DiscoveredEndpoint}.
   *
   * @param params - URL plus optional third-party / bundle-count opts.
   * @returns Discovered endpoints, hosts, and scan counters.
   * @throws {WebclawError} On network or API errors (400 if `url` is
   *   missing or invalid).
   */
  async endpoints(params: EndpointsRequest): Promise<EndpointsResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<EndpointsResponse>("/v1/endpoints", params);
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
   * Enrich a company lead from its website using an LLM.
   *
   * Fetches the URL and returns a structured company profile — name,
   * summary, socials, tech stack, pricing, and contact emails, plus
   * `people`: founders and team members, each with their LinkedIn and X
   * links where found (`people_source` records how they were sourced).
   *
   * Pricing: a flat 100 credits per successful lead.
   *
   * @param url - The company website to enrich.
   * @param options - Cache control (`no_cache`).
   * @returns The enriched lead plus its cache status and billing.
   */
  async lead(url: string, options: LeadOptions = {}): Promise<LeadResponse> {
    if (!url) throw new Error("url is required");
    return this.post<LeadResponse>("/v1/lead", { url, ...options });
  }

  /**
   * Start an async batch that enriches up to 25 company leads at once.
   *
   * Each URL is enriched into the same structured profile that
   * {@link lead} returns. The job runs in the background: this call
   * returns immediately with a job id and the number of URLs accepted
   * (the server validates and dedupes `urls`). Poll {@link getLeadBatch}
   * — or block via {@link waitForLeadBatch} — for results.
   *
   * Pricing: a flat 100 credits per *successful* lead; errored URLs are
   * not billed.
   *
   * @param urls - 1..25 company website URLs. Validated/deduped server-side.
   * @param options - Cache control (`no_cache`).
   * @returns The job id, accepted URL count, and per-URL credit cost.
   * @throws {CreditLimitError} On insufficient credits or an inactive plan (402).
   * @throws {WebclawError} If `urls` is empty or has more than 25 entries (400).
   */
  async leadBatch(
    urls: string[],
    options: LeadBatchOptions = {},
  ): Promise<LeadBatchStartResponse> {
    if (!urls?.length) throw new Error("urls must be a non-empty array");
    // Async start: no per-request timeout. Results are awaited via polling
    // ({@link getLeadBatch}/{@link waitForLeadBatch}), which keeps its own deadline.
    return this.post<LeadBatchStartResponse>(
      "/v1/lead/batch",
      { urls, ...options },
      null,
    );
  }

  /**
   * Get the current status and results of a lead-batch job without waiting.
   * @param id - Batch job id returned by {@link leadBatch}.
   * @returns Current status, counts, billing, and any per-URL results so far.
   * @throws {NotFoundError} If the batch job does not exist or isn't yours (404).
   */
  async getLeadBatch(id: string): Promise<LeadBatchResponse> {
    return this.get<LeadBatchResponse>(
      `/v1/lead/batch/${encodeURIComponent(id)}`,
    );
  }

  /**
   * Poll a lead-batch job by id until it's `completed` or `failed`.
   * Same ergonomics as {@link waitForCrawl} / {@link waitForResearch}.
   * @param id - Batch job id returned by {@link leadBatch}.
   * @param opts - Polling interval and max wait override.
   * @returns The finished job with all per-URL results and final billing.
   * @throws {WebclawError} If polling times out before the job finishes.
   */
  async waitForLeadBatch(
    id: string,
    opts: LeadBatchPollOptions = {},
  ): Promise<LeadBatchResponse> {
    const interval = opts.interval ?? 2_000;
    const maxWait = opts.maxWait ?? 600_000;
    return pollUntilDone(
      () => this.getLeadBatch(id),
      (r) => r.status === "completed" || r.status === "failed",
      { interval, timeout: maxWait },
    );
  }

  /**
   * Generate a concise summary of a page's content.
   * @param params - URL and optional max sentence count.
   * @returns The generated summary text.
   */
  async summarize(params: SummarizeRequest): Promise<SummarizeResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<SummarizeResponse>("/v1/summarize", params);
  }

  /**
   * Extract brand identity information (name, logo, colors) from a URL.
   * @param params - The URL to analyze.
   * @returns Brand data as a flexible object (shape depends on the site).
   */
  async brand(params: BrandRequest): Promise<BrandResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<BrandResponse>("/v1/brand", params);
  }

  /**
   * Perform a web search query, optionally scraping each result page.
   * @param params - Search query plus strict source filters and optional provider, pagination, and scrape hints.
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
    if (!params.url) throw new Error("url is required");
    return this.post<DiffResponse>("/v1/diff", params);
  }

  /**
   * Start a research job and poll until completion.
   * Every job runs in deep mode server-side, so the default poll timeout
   * is 20 minutes; pass `opts.maxWait` to override.
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
    // Async start: no per-request timeout. Completion is awaited via
    // polling below, which enforces its own (interval, maxWait) deadline.
    const start = await this.post<ResearchStartResponse>(
      "/v1/research",
      params,
      null,
    );

    const interval = opts.interval ?? 2_000;
    // The API runs every research job in deep mode (the deprecated
    // `params.deep` flag is ignored), so always default to the 20-minute
    // window. An explicit opts.maxWait still wins.
    const maxWait = opts.maxWait ?? 1_200_000;

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
    // Every research job runs in deep mode, so use the same 20-minute
    // default window as {@link research}.
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

  // -- X (Twitter) monitor methods --
  //
  // The X analog of the watch endpoints: poll X (profiles, searches,
  // lists, or replies) and fire a webhook on new matches. Paid-only —
  // the server returns 403 (ScopeError) for free/lapsed accounts.
  // Monitors cost 1 credit per check; audience export costs 1 credit
  // per page fetched. Max 50 monitors per user.

  /**
   * Create a monitor that polls X and fires a webhook on new matches.
   * @param params - `kind` + `target` (required) plus poll interval and
   *   match filters.
   * @returns The created monitor (core fields only).
   * @throws {ScopeError} On free/lapsed accounts (403).
   */
  async createXMonitor(params: CreateXMonitorRequest): Promise<XMonitor> {
    if (!params.kind) throw new Error("kind is required");
    if (!params.target) throw new Error("target is required");
    return this.post<XMonitor>("/v1/x/monitors", params);
  }

  /**
   * List X monitors.
   * @param limit - Page size, 1..100.
   * @param offset - Page offset, >= 0.
   * @returns `{ monitors }` — an array of full monitor objects.
   */
  async listXMonitors(
    limit?: number,
    offset?: number,
  ): Promise<ListXMonitorsResponse> {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set("limit", String(limit));
    if (offset !== undefined) query.set("offset", String(offset));
    const qs = query.toString();
    return this.get<ListXMonitorsResponse>(
      `/v1/x/monitors${qs ? `?${qs}` : ""}`,
    );
  }

  /** Get one X monitor (full object). */
  async getXMonitor(id: string): Promise<XMonitor> {
    return this.get<XMonitor>(`/v1/x/monitors/${encodeURIComponent(id)}`);
  }

  /**
   * Update an X monitor. Only the fields you pass are changed.
   * @returns `{ success: true }`.
   */
  async updateXMonitor(
    id: string,
    params: UpdateXMonitorRequest,
  ): Promise<XMonitorMutationResponse> {
    return this.patch<XMonitorMutationResponse>(
      `/v1/x/monitors/${encodeURIComponent(id)}`,
      params,
    );
  }

  /**
   * Delete an X monitor.
   * @returns `{ success: true }`.
   */
  async deleteXMonitor(id: string): Promise<XMonitorMutationResponse> {
    return this.request<XMonitorMutationResponse>(
      `/v1/x/monitors/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      },
    );
  }

  /**
   * Trigger an immediate check of an X monitor. Runs in the background.
   * @returns `{ status: "checking" }`.
   */
  async checkXMonitor(id: string): Promise<XMonitorCheckResponse> {
    return this.post<XMonitorCheckResponse>(
      `/v1/x/monitors/${encodeURIComponent(id)}/check`,
      {},
    );
  }

  /**
   * Export an X account's followers or following — cursor-paginated and
   * metered at 1 credit per page fetched.
   *
   * Provide `handle` OR `user_id`. To walk a full audience, call
   * repeatedly, passing the returned `user_id` and `next_cursor` back in,
   * until `next_cursor` is `null`.
   *
   * @param params - `handle`/`user_id`, direction, cursor, page count.
   * @returns A page of users plus paging + billing metadata.
   * @throws {ScopeError} On free/lapsed accounts (403).
   */
  async exportXAudience(
    params: ExportXAudienceRequest,
  ): Promise<ExportXAudienceResponse> {
    if (!params.handle && !params.user_id) {
      throw new Error("handle or user_id is required");
    }
    return this.post<ExportXAudienceResponse>("/v1/x/audience", params);
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

  /**
   * @param timeoutMs - Per-request abort deadline. Defaults to the
   *   client timeout. Pass `null` to disable the deadline entirely —
   *   used for async *start* calls (crawl/research start) which can
   *   legitimately take longer than the sync-call budget; their results
   *   are then awaited via polling, which keeps its own timeout.
   */
  private async request<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number | null = this.timeout,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer =
      timeoutMs === null
        ? null
        : setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw new TimeoutError(timeoutMs ?? this.timeout);
      }
      throw new WebclawError(
        err instanceof Error ? err.message : "Network request failed",
      );
    } finally {
      if (timer !== null) clearTimeout(timer);
    }

    if (res.ok) {
      // 204, or any other success with an empty body (some endpoints
      // reply 200/202 with no content). Don't try to parse "" as JSON.
      const text = await res.text();
      if (text.length === 0) {
        return undefined as T;
      }
      try {
        return JSON.parse(text) as T;
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
    if (res.status === 402) throw new CreditLimitError(message);
    if (res.status === 403) throw new ScopeError(message);
    if (res.status === 404) throw new NotFoundError(message);
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      throw new RateLimitError(retryAfter);
    }

    throw new WebclawError(message, res.status, parsed ?? body);
  }

  private post<T>(
    path: string,
    body: unknown,
    timeoutMs: number | null = this.timeout,
  ): Promise<T> {
    return this.request<T>(
      path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
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

/** Max consecutive transient poll failures (per-poll timeout or 429)
 *  tolerated before giving up. The outer deadline still bounds total
 *  wall time; this just stops a permanently-broken endpoint from
 *  spinning until the (possibly 20-minute) deadline. */
const MAX_TRANSIENT_POLL_FAILURES = 5;

/**
 * Polls checkFn until isDone returns true, or the outer timeout is
 * exceeded.
 *
 * A single status poll going over the per-request timeout, or a
 * transient 429, must NOT abort a long-running job (deep research can
 * legitimately take 20 min while each poll is sub-second). Such errors
 * are swallowed and the loop continues until the outer deadline, with
 * a bounded consecutive-failure cap so a persistently broken endpoint
 * still fails fast. On 429 we honour `retry-after` (capped to the time
 * left). Non-transient errors (404, 401, 5xx, network) propagate
 * immediately.
 */
async function pollUntilDone<T>(
  checkFn: () => Promise<T>,
  isDone: (result: T) => boolean,
  options: { interval: number; timeout: number },
): Promise<T> {
  const deadline = Date.now() + options.timeout;
  let transientFailures = 0;

  while (true) {
    let waitMs = options.interval;
    try {
      const result = await checkFn();
      transientFailures = 0;
      if (isDone(result)) return result;
    } catch (err: unknown) {
      if (!isTransientPollError(err)) throw err;
      if (++transientFailures > MAX_TRANSIENT_POLL_FAILURES) {
        throw new WebclawError(
          `Polling failed after ${MAX_TRANSIENT_POLL_FAILURES} consecutive transient errors: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
      }
      // On 429, back off for the server-advised window if present.
      if (err instanceof RateLimitError && err.retryAfter != null) {
        waitMs = Math.max(waitMs, err.retryAfter * 1_000);
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new WebclawError("Polling timed out");
    await sleep(Math.min(waitMs, remaining));
  }
}

/** A per-poll timeout or a 429 is transient: the job may still finish,
 *  so the poll loop should retry rather than abort. */
function isTransientPollError(err: unknown): boolean {
  return err instanceof TimeoutError || err instanceof RateLimitError;
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
