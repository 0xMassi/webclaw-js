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

/**
 * Structured YouTube metadata returned by `/v1/scrape` for any
 * `youtube.com/watch`, `youtube.com/shorts`, or `youtu.be/` URL.
 *
 * Populated via the server's yt-dlp short-circuit (preferred) or the
 * standard pipeline's vertical YouTube extractor (transcript will be
 * `null` on this fallback path).
 */
export interface YouTubeData {
  video_id: string | null;
  title: string | null;
  description: string | null;
  channel: string | null;
  channel_url: string | null;
  uploader: string | null;
  /** YYYYMMDD */
  upload_date: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  like_count: number | null;
  thumbnail: string | null;
  tags: string[];
  categories: string[];
  language: string | null;
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
  /** YouTube-only — set when the URL is youtube.com/watch, /shorts, or
   *  youtu.be. Carries channel, duration, view count, tags, etc. */
  youtube?: YouTubeData;
  /** Auto-caption transcript text (newline-joined). Only present when
   *  the yt-dlp short-circuit fired and the video has captions. */
  transcript?: string;
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

// -- POST /v1/endpoints --

export interface EndpointsRequest {
  /** Page URL to scan for embedded API endpoints. Required. */
  url: string;
  /**
   * Include endpoints whose host differs from the page's host
   * (third-party APIs, CDNs, analytics). Default `false`.
   */
  include_third_party?: boolean;
  /**
   * Max number of `<script src>` bundles to fetch and scan, on top
   * of the page's inline scripts. Default `20`, capped server-side
   * at `20`.
   */
  max_bundles?: number;
}

/**
 * What kind of reference a discovered endpoint is.
 *
 * - `relative_path` — a path-only reference (e.g. `/api/v1/users`).
 * - `absolute_url` — a fully-qualified `http(s)` URL.
 * - `graph_ql` — a GraphQL endpoint.
 * - `web_socket` — a `ws://` / `wss://` endpoint.
 */
export type EndpointKind =
  | "relative_path"
  | "absolute_url"
  | "graph_ql"
  | "web_socket";

/**
 * A single API endpoint discovered inside a page's JavaScript.
 *
 * SECURITY: every field here is derived from page content (inline
 * `<script>` bodies and fetched `<script src>` bundles), which is
 * attacker-influenced. `value`, `source`, and the entries in
 * {@link EndpointsResponse.hosts} are NOT validated or sanitized by
 * the SDK. Never feed `value`/`source` into another fetch, shell,
 * eval, or SQL without your own validation — treat them as untrusted
 * strings (SSRF / injection footgun).
 */
export interface DiscoveredEndpoint {
  /** The raw endpoint reference as found in the JS (path or URL). */
  value: string;
  /** Classification of {@link value}. */
  kind: EndpointKind;
  /**
   * `true` if the endpoint's host matches the scanned page's host.
   * `false` for third-party hosts (only present when the request set
   * `include_third_party: true`).
   */
  first_party: boolean;
  /**
   * Where the endpoint was found — e.g. `inline` for an inline
   * `<script>`, or the bundle URL for an external script. Also
   * page-derived and untrusted (see the type-level SECURITY note).
   */
  source: string;
}

/**
 * Response shape of `POST /v1/endpoints`.
 *
 * Discovers API endpoints embedded in a page's inline JS and
 * `<script src>` bundles — the request/GraphQL/WebSocket surface that
 * {@link MapResponse} (sitemap-based) cannot see. Credit cost: 2.
 *
 * SECURITY: `endpoints`, `hosts`, and their fields are extracted from
 * attacker-influenced page content and are not sanitized. See
 * {@link DiscoveredEndpoint} before using any value in a downstream
 * request, command, or query.
 */
export interface EndpointsResponse {
  /** The URL that was scanned. */
  url: string;
  /** Number of script bundles fetched and scanned. */
  bundles_scanned: number;
  /** Total number of endpoints in {@link endpoints}. */
  endpoint_count: number;
  /** The discovered endpoints. Page-derived and untrusted. */
  endpoints: DiscoveredEndpoint[];
  /** Distinct hosts seen across all endpoints. Page-derived. */
  hosts: string[];
  /** `true` if results were capped by `max_bundles`. */
  truncated: boolean;
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

// -- POST /v1/lead --

export interface LeadRequest {
  url: string;
  no_cache?: boolean;
}

/** Options accepted by {@link Webclaw#lead} (the request body minus `url`). */
export type LeadOptions = Omit<LeadRequest, "url">;

/** Social profile links found for a lead. */
export interface LeadSocials {
  linkedin?: string;
  x?: string;
  github?: string;
}

/** One pricing plan extracted from a company's pricing page. */
export interface LeadPricingPlan {
  plan: string;
  price: string;
}

/** A contact email discovered for the company, tagged by kind (e.g. "support", "sales"). */
export interface LeadEmail {
  type: string;
  email: string;
}

/**
 * A person (founder, exec, or team member) associated with the company.
 * Social links are `null` when none was found.
 */
export interface LeadPerson {
  name: string;
  role: string;
  linkedin: string | null;
  x: string | null;
}

/**
 * The enriched company profile. Every field is optional — the extractor
 * fills in whatever it can find on the target site.
 */
export interface LeadData {
  company_name?: string;
  summary?: string;
  socials?: LeadSocials;
  tech?: string[];
  pricing?: LeadPricingPlan[];
  emails?: LeadEmail[];
  people?: LeadPerson[];
}

export interface LeadResponse {
  url: string;
  domain: string;
  lead: LeadData;
  /** How `lead.people` were assembled. Currently always via web search. */
  people_source: "web_search";
  cache: "hit" | "miss";
  /** Credits billed. Flat 100 per successful lead. */
  credits: number;
}

// -- POST /v1/lead/batch (async) --

export interface LeadBatchRequest {
  /** 1..25 company website URLs. Validated and deduped server-side. */
  urls: string[];
  no_cache?: boolean;
}

/** Options accepted by {@link Webclaw#leadBatch} (the request body minus `urls`). */
export type LeadBatchOptions = Omit<LeadBatchRequest, "urls">;

/**
 * Immediate response of `POST /v1/lead/batch`. The job runs async — poll
 * `GET /v1/lead/batch/{id}` (via {@link Webclaw#getLeadBatch} /
 * {@link Webclaw#waitForLeadBatch}) for results.
 */
export interface LeadBatchStartResponse {
  id: string;
  status: "processing";
  /** Number of URLs accepted after validation + dedupe. */
  total: number;
  /** Credits charged per successful lead. Flat 100. */
  credits_per_url: number;
}

export type LeadBatchStatus = "processing" | "completed" | "failed";

/** A successfully enriched URL in a lead-batch job. */
export interface LeadBatchResultSuccess {
  url: string;
  status: "success";
  domain: string;
  /** The enriched profile — same shape as the single {@link LeadResponse}'s `lead`. */
  lead: LeadData;
  cache: "hit" | "miss";
}

/** A URL that failed enrichment in a lead-batch job. Not billed. */
export interface LeadBatchResultError {
  url: string;
  status: "error";
  error: string;
}

export type LeadBatchResultItem = LeadBatchResultSuccess | LeadBatchResultError;

/** Response shape of `GET /v1/lead/batch/{id}`. */
export interface LeadBatchResponse {
  id: string;
  status: LeadBatchStatus;
  /** URLs accepted for the job. */
  total: number;
  /** URLs processed so far (success + error). */
  completed: number;
  /** URLs that produced a lead (each billed 100 credits). */
  succeeded: number;
  /** Total credits billed so far (100 per successful lead). */
  credits_charged: number;
  results: LeadBatchResultItem[];
  /** Failure reason when `status` is `failed`, else `null`. */
  error: string | null;
  /** ISO-8601 timestamp. */
  created_at: string;
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
  /** @deprecated Research always runs in deep mode; this flag is ignored by the API. */
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
  /** @deprecated Research always runs in deep mode; this flag is ignored by the API. */
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

// -- X (Twitter) monitoring endpoints --

/**
 * What a monitor polls on X.
 *
 * - `profile` — a user's timeline (target is a handle, leading `@` stripped).
 * - `search` — a search query (target is the query string).
 * - `list` — a list's timeline (target is the numeric list id).
 * - `replies` — replies to a tweet (target is the tweet id).
 */
export type XMonitorKind = "profile" | "search" | "list" | "replies";

export interface CreateXMonitorRequest {
  /** What to poll. Determines how `target` is interpreted. */
  kind: XMonitorKind;
  /**
   * Handle (leading `@` is stripped), search query, list id, or tweet
   * id — interpreted per {@link kind}.
   */
  target: string;
  name?: string;
  /** Poll interval. Default 15, clamped server-side to 2..10080. */
  interval_minutes?: number;
  /** Discord/Slack/generic webhook fired on new matches. */
  webhook_url?: string;
  /** Match retweets. Default `true`. */
  include_retweets?: boolean;
  /** Match replies. Default `true`. */
  include_replies?: boolean;
  /** Match quote tweets. Default `true`. */
  include_quotes?: boolean;
  /** Minimum likes to match. Default `0`. */
  min_faves?: number;
  /** Only match tweets containing this substring. */
  keyword?: string;
  /** Only match tweets in this language code. */
  lang?: string;
}

/**
 * Fields accepted by {@link Webclaw#updateXMonitor}. All optional —
 * only the provided fields are changed.
 */
export interface UpdateXMonitorRequest {
  name?: string;
  interval_minutes?: number;
  webhook_url?: string;
  active?: boolean;
}

/**
 * A monitor object.
 *
 * `createXMonitor` returns only the core fields (`id`, `kind`, `target`,
 * `name`, `interval_minutes`, `webhook_url`, `active`); the list/get
 * endpoints return the full object including match filters and
 * timestamps. The extra fields are marked optional so both shapes fit
 * one type.
 */
export interface XMonitor {
  id: string;
  kind: XMonitorKind;
  target: string;
  name?: string;
  interval_minutes: number;
  webhook_url?: string;
  active: boolean;
  include_retweets?: boolean;
  include_replies?: boolean;
  include_quotes?: boolean;
  min_faves?: number;
  keyword?: string;
  lang?: string;
  last_checked_at?: string;
  last_matched_at?: string;
  created_at?: string;
}

/** Response shape of `GET /v1/x/monitors`. */
export interface ListXMonitorsResponse {
  monitors: XMonitor[];
}

/** Response shape of `PATCH` and `DELETE /v1/x/monitors/{id}`. */
export interface XMonitorMutationResponse {
  success: boolean;
}

/** Response shape of `POST /v1/x/monitors/{id}/check`. */
export interface XMonitorCheckResponse {
  status: "checking";
}

/** Which side of the follow graph {@link ExportXAudienceRequest} walks. */
export type XAudienceDirection = "followers" | "following";

export interface ExportXAudienceRequest {
  /**
   * `@handle` to export. Resolved once (unbilled). Provide `handle`
   * OR `user_id`.
   */
  handle?: string;
  /**
   * Pre-resolved numeric user id. Pass the `user_id` from a previous
   * response back on later pages to skip re-resolving.
   */
  user_id?: string;
  /** Which follow direction to walk. Default `"followers"`. */
  direction?: XAudienceDirection;
  /** Opaque cursor from a previous response's `next_cursor`. */
  cursor?: string;
  /** Pages to fetch this call. Default 2, clamped server-side to 1..10. */
  max_pages?: number;
}

/** One user in an audience export page. */
export interface XAudienceUser {
  id: string;
  screen_name: string;
  name: string;
  followers: number;
  description: string;
  url: string;
}

export interface ExportXAudienceResponse {
  user_id: string;
  direction: XAudienceDirection;
  count: number;
  users: XAudienceUser[];
  /**
   * Opaque cursor for the next page, or `null` when the audience is
   * fully walked. Pass it (with `user_id`) back into
   * {@link ExportXAudienceRequest} to page.
   */
  next_cursor: string | null;
  pages_fetched: number;
  credits_charged: number;
}

// -- Client config --

export interface WebclawConfig {
  apiKey: string;
  /**
   * API base URL. Default `https://api.webclaw.io`.
   *
   * SECURITY: your `apiKey` is sent as a Bearer token to whatever
   * origin you set here. Only point this at hosts you trust — never
   * at a value derived from untrusted input (SSRF / key-exfil footgun).
   */
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
  /** Maximum time to wait in ms. Default 1_200_000 (20 min) — research always runs in deep mode. */
  maxWait?: number;
}

export interface LeadBatchPollOptions {
  /** Polling interval in ms. Default 2000. */
  interval?: number;
  /** Maximum time to wait in ms. Default 600_000 (10 min). */
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
