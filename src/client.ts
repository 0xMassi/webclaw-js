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
  AgentScrapeRequest,
  AgentScrapeResponse,
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

  async scrape(params: ScrapeRequest): Promise<ScrapeResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<ScrapeResponse>("/v1/scrape", params);
  }

  async crawl(params: CrawlRequest): Promise<CrawlJob> {
    const res = await this.post<CrawlStartResponse>("/v1/crawl", params);
    return new CrawlJob(res.id, this);
  }

  async getCrawlStatus(id: string): Promise<CrawlStatusResponse> {
    return this.get<CrawlStatusResponse>(`/v1/crawl/${encodeURIComponent(id)}`);
  }

  async map(params: MapRequest): Promise<MapResponse> {
    return this.post<MapResponse>("/v1/map", params);
  }

  async batch(params: BatchRequest): Promise<BatchResponse> {
    if (!params.urls?.length) throw new Error("urls must be a non-empty array");
    return this.post<BatchResponse>("/v1/batch", params);
  }

  async extract(params: ExtractRequest): Promise<ExtractResponse> {
    if (!params.url) throw new Error("url is required");
    return this.post<ExtractResponse>("/v1/extract", params);
  }

  async summarize(params: SummarizeRequest): Promise<SummarizeResponse> {
    return this.post<SummarizeResponse>("/v1/summarize", params);
  }

  async brand(params: BrandRequest): Promise<BrandResponse> {
    return this.post<BrandResponse>("/v1/brand", params);
  }

  async search(params: SearchRequest): Promise<SearchResponse> {
    if (!params.query) throw new Error("query is required");
    return this.post<SearchResponse>("/v1/search", params);
  }

  async diff(params: DiffRequest): Promise<DiffResponse> {
    return this.post<DiffResponse>("/v1/diff", params);
  }

  async agentScrape(params: AgentScrapeRequest): Promise<AgentScrapeResponse> {
    return this.post<AgentScrapeResponse>("/v1/agent-scrape", params);
  }

  /**
   * Start a research job and poll until completion.
   * Deep research uses a 20-minute timeout by default; normal uses 10 minutes.
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
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
      const status = await this.getResearchStatus(start.id);
      if (status.status === "completed" || status.status === "failed") {
        return status;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(interval, remaining));
    }

    throw new WebclawError("Research polling timed out", undefined, {
      id: start.id,
      maxWait,
    });
  }

  /** Low-level poll: get current status of a research job without waiting. */
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

  // -- Internal HTTP layer --

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new TimeoutError(this.timeout);
      }
      // Node 18 throws a plain Error with name "AbortError" on timeout
      if (err instanceof Error && err.name === "AbortError") {
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
    const deadline = Date.now() + maxWait;

    while (Date.now() < deadline) {
      const status = await this.getStatus();
      if (status.status === "completed" || status.status === "failed") {
        return status;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(interval, remaining));
    }

    throw new WebclawError("Crawl polling timed out", undefined, {
      id: this.id,
      maxWait,
    });
  }
}

// -- Helpers --

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
