import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Webclaw,
  WebclawError,
  AuthenticationError,
  CreditLimitError,
  ScopeError,
  RateLimitError,
  NotFoundError,
  TimeoutError,
} from "../src/index.js";
import type {
  ScrapeResponse,
  CrawlStatusResponse,
  MapResponse,
  EndpointsResponse,
  BatchResponse,
  ExtractResponse,
  LeadResponse,
  LeadBatchStartResponse,
  LeadBatchResponse,
  SummarizeResponse,
  WatchResponse,
  ResearchResponse,
  XMonitor,
  ListXMonitorsResponse,
  ExportXAudienceResponse,
} from "../src/index.js";

// -- Helpers --

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function client(overrides?: { baseUrl?: string; timeout?: number }) {
  return new Webclaw({ apiKey: "wc_test_key", ...overrides });
}

// -- Setup --

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- Construction ----

describe("Webclaw constructor", () => {
  it("throws when apiKey is empty", () => {
    expect(() => new Webclaw({ apiKey: "" })).toThrow("apiKey is required");
  });

  it("strips trailing slash from custom baseUrl", () => {
    const wc = client({ baseUrl: "https://custom.io///" });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ urls: [], count: 0 }));
    wc.map({ url: "https://example.com" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://custom.io/v1/map",
      expect.anything(),
    );
  });
});

// ---- Auth header ----

describe("Authorization", () => {
  it("sends Bearer token on POST", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ urls: [], count: 0 }));
    await client().map({ url: "https://example.com" });
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer wc_test_key");
  });

  it("sends Bearer token on GET", async () => {
    const status: CrawlStatusResponse = {
      id: "abc",
      status: "completed",
      pages: [],
      total: 0,
      completed: 0,
      errors: 0,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(status));
    await client().getCrawlStatus("abc");
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer wc_test_key");
  });
});

// ---- POST /v1/scrape ----

describe("scrape", () => {
  const scrapeRes: ScrapeResponse = {
    url: "https://example.com",
    metadata: { title: "Example" },
    markdown: "# Hello",
    cache: { status: "miss" },
  };

  it("returns scraped content", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(scrapeRes));
    const res = await client().scrape({ url: "https://example.com" });
    expect(res.markdown).toBe("# Hello");
    expect(res.cache.status).toBe("miss");
  });

  it("sends all optional params", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(scrapeRes));
    await client().scrape({
      url: "https://example.com",
      formats: ["markdown", "text"],
      include_selectors: [".main"],
      exclude_selectors: [".ad"],
      only_main_content: true,
      no_cache: true,
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.formats).toEqual(["markdown", "text"]);
    expect(body.only_main_content).toBe(true);
    expect(body.no_cache).toBe(true);
    expect(body.include_selectors).toEqual([".main"]);
    expect(body.exclude_selectors).toEqual([".ad"]);
  });
});

// ---- POST /v1/crawl + polling ----

describe("crawl", () => {
  it("returns a CrawlJob with the job id", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "job-1", status: "running" }),
    );
    const job = await client().crawl({ url: "https://example.com" });
    expect(job.id).toBe("job-1");
  });

  it("getStatus calls GET /v1/crawl/{id}", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "job-2", status: "running" }),
    );
    const job = await client().crawl({ url: "https://example.com" });

    const statusRes: CrawlStatusResponse = {
      id: "job-2",
      status: "completed",
      pages: [{ url: "https://example.com", metadata: {} }],
      total: 1,
      completed: 1,
      errors: 0,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(statusRes));
    const status = await job.getStatus();
    expect(status.status).toBe("completed");
    expect(fetchSpy.mock.calls[1][0]).toBe(
      "https://api.webclaw.io/v1/crawl/job-2",
    );
    expect(fetchSpy.mock.calls[1][1].method).toBe("GET");
  });

  it("waitForCompletion polls until completed", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "job-3", status: "running" }),
    );
    const job = await client().crawl({ url: "https://example.com" });

    // First poll: still running. Second poll: completed.
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({
          id: "job-3",
          status: "running",
          pages: [],
          total: 2,
          completed: 1,
          errors: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "job-3",
          status: "completed",
          pages: [
            { url: "https://example.com", metadata: {} },
            { url: "https://example.com/about", metadata: {} },
          ],
          total: 2,
          completed: 2,
          errors: 0,
        }),
      );

    const result = await job.waitForCompletion({ interval: 10 });
    expect(result.status).toBe("completed");
    expect(result.pages).toHaveLength(2);
    // 1 crawl start + 2 polls = 3 total fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("waitForCompletion returns on failed status", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "job-4", status: "running" }),
    );
    const job = await client().crawl({ url: "https://example.com" });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        id: "job-4",
        status: "failed",
        pages: [],
        total: 0,
        completed: 0,
        errors: 1,
      }),
    );

    const result = await job.waitForCompletion({ interval: 10 });
    expect(result.status).toBe("failed");
  });

  it("waitForCompletion throws on timeout", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "job-5", status: "running" }),
    );
    const job = await client().crawl({ url: "https://example.com" });

    // Return a fresh Response on every call so the body is never reused
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          id: "job-5",
          status: "running",
          pages: [],
          total: 0,
          completed: 0,
          errors: 0,
        }),
      ),
    );

    await expect(
      job.waitForCompletion({ interval: 10, maxWait: 50 }),
    ).rejects.toThrow("Polling timed out");
  });
});

// ---- POST /v1/map ----

describe("map", () => {
  it("returns discovered URLs", async () => {
    const mapRes: MapResponse = {
      urls: ["https://example.com", "https://example.com/about"],
      count: 2,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mapRes));
    const res = await client().map({ url: "https://example.com" });
    expect(res.count).toBe(2);
    expect(res.urls).toHaveLength(2);
  });
});

// ---- POST /v1/endpoints ----

describe("endpoints", () => {
  const endpointsRes: EndpointsResponse = {
    url: "https://example.com",
    bundles_scanned: 3,
    endpoint_count: 2,
    endpoints: [
      {
        value: "/api/v1/users",
        kind: "relative_path",
        first_party: true,
        source: "inline",
      },
      {
        value: "wss://example.com/socket",
        kind: "web_socket",
        first_party: true,
        source: "https://example.com/app.js",
      },
    ],
    hosts: ["example.com"],
    truncated: false,
  };

  it("returns discovered endpoints", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(endpointsRes));
    const res = await client().endpoints({ url: "https://example.com" });
    expect(res.endpoint_count).toBe(2);
    expect(res.endpoints).toHaveLength(2);
    expect(res.endpoints[0].kind).toBe("relative_path");
    expect(res.endpoints[1].kind).toBe("web_socket");
    expect(res.hosts).toEqual(["example.com"]);
    expect(res.truncated).toBe(false);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/endpoints",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("requires url", async () => {
    await expect(
      // @ts-expect-error testing runtime guard
      client().endpoints({ include_third_party: true }),
    ).rejects.toThrow("url is required");
  });

  it("passes include_third_party and max_bundles through", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(endpointsRes));
    await client().endpoints({
      url: "https://example.com",
      include_third_party: true,
      max_bundles: 10,
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.url).toBe("https://example.com");
    expect(body.include_third_party).toBe(true);
    expect(body.max_bundles).toBe(10);
  });

  it("throws WebclawError with the server error on 400", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "invalid url" }, 400));
    try {
      await client().endpoints({ url: "not-a-url" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WebclawError);
      expect((err as WebclawError).status).toBe(400);
      expect((err as WebclawError).message).toBe("invalid url");
    }
  });
});

// ---- POST /v1/batch ----

describe("batch", () => {
  it("returns mixed success and error results", async () => {
    const batchRes: BatchResponse = {
      results: [
        {
          url: "https://example.com",
          markdown: "# OK",
          metadata: { title: "OK" },
        },
        { url: "https://bad.example.com", error: "DNS resolution failed" },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(batchRes));
    const res = await client().batch({
      urls: ["https://example.com", "https://bad.example.com"],
      formats: ["markdown"],
      concurrency: 3,
    });
    expect(res.results).toHaveLength(2);
    expect(res.results[1]).toHaveProperty("error");
  });
});

// ---- POST /v1/extract ----

describe("extract", () => {
  it("returns extracted data", async () => {
    const extractRes: ExtractResponse = {
      data: { name: "Webclaw", founded: 2025 },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(extractRes));
    const res = await client().extract({
      url: "https://example.com",
      prompt: "Extract the company info",
    });
    expect(res.data.name).toBe("Webclaw");
  });

  it("sends schema when provided", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: {} }));
    await client().extract({
      url: "https://example.com",
      schema: { type: "object", properties: { name: { type: "string" } } },
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.schema).toHaveProperty("type", "object");
  });
});

// ---- POST /v1/lead ----

describe("lead", () => {
  const leadRes: LeadResponse = {
    url: "https://resend.com",
    domain: "resend.com",
    lead: {
      company_name: "Resend",
      summary: "Email API for developers.",
      socials: {
        linkedin: "https://linkedin.com/company/resend",
        x: "https://x.com/resend",
        github: "https://github.com/resend",
      },
      tech: ["Next.js", "React", "AWS"],
      pricing: [{ plan: "Free", price: "$0" }],
      emails: [{ type: "support", email: "support@resend.com" }],
      people: [
        {
          name: "Zeno Rocha",
          role: "CEO",
          linkedin: "https://linkedin.com/in/zenorocha",
          x: "https://x.com/zenorocha",
        },
      ],
    },
    people_source: "web_search",
    cache: "miss",
    credits: 100,
  };

  it("returns the enriched lead", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(leadRes));
    const res = await client().lead("https://resend.com");
    expect(res.lead.company_name).toBe("Resend");
    expect(res.lead.socials?.github).toBe("https://github.com/resend");
    expect(res.lead.pricing?.[0].plan).toBe("Free");
    expect(res.lead.emails?.[0].email).toBe("support@resend.com");
    expect(res.lead.people?.[0].name).toBe("Zeno Rocha");
    expect(res.lead.people?.[0].linkedin).toBe(
      "https://linkedin.com/in/zenorocha",
    );
    expect(res.lead.people?.[0].x).toBe("https://x.com/zenorocha");
    expect(res.people_source).toBe("web_search");
    expect(res.credits).toBe(100);
    expect(res.cache).toBe("miss");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.webclaw.io/v1/lead");
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("sends url and options in the request body", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(leadRes));
    await client().lead("https://resend.com", { no_cache: true });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.url).toBe("https://resend.com");
    expect(body.no_cache).toBe(true);
  });

  it("defaults to no options when only a url is given", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(leadRes));
    await client().lead("https://resend.com");
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.url).toBe("https://resend.com");
    expect(body.no_cache).toBeUndefined();
  });

  it("requires url", async () => {
    // @ts-expect-error testing runtime guard
    await expect(client().lead()).rejects.toThrow("url is required");
  });
});

// ---- POST /v1/lead/batch (async) ----

describe("lead batch", () => {
  const startRes: LeadBatchStartResponse = {
    id: "lb_1",
    status: "processing",
    total: 2,
    credits_per_url: 100,
  };

  const doneRes: LeadBatchResponse = {
    id: "lb_1",
    status: "completed",
    total: 2,
    completed: 2,
    succeeded: 1,
    credits_charged: 100,
    results: [
      {
        url: "https://resend.com",
        status: "success",
        domain: "resend.com",
        lead: {
          company_name: "Resend",
          summary: "Email API for developers.",
          socials: { linkedin: "https://linkedin.com/company/resend" },
          tech: ["Next.js"],
          pricing: [{ plan: "Free", price: "$0" }],
          emails: [{ type: "support", email: "support@resend.com" }],
          people: [
            {
              name: "Zeno Rocha",
              role: "CEO",
              linkedin: "https://linkedin.com/in/zenorocha",
              x: "https://x.com/zenorocha",
            },
          ],
        },
        cache: "miss",
      },
      {
        url: "https://bad.example.com",
        status: "error",
        error: "fetch failed",
      },
    ],
    error: null,
    created_at: "2026-01-01T00:00:00Z",
  };

  it("leadBatch POSTs to /v1/lead/batch and returns the start response", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(startRes));
    const res = await client().leadBatch([
      "https://resend.com",
      "https://bad.example.com",
    ]);
    expect(res.id).toBe("lb_1");
    expect(res.status).toBe("processing");
    expect(res.total).toBe(2);
    expect(res.credits_per_url).toBe(100);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/lead/batch",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("leadBatch sends urls and options in the request body", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(startRes));
    await client().leadBatch(["https://resend.com"], { no_cache: true });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.urls).toEqual(["https://resend.com"]);
    expect(body.no_cache).toBe(true);
  });

  it("leadBatch requires a non-empty urls array", async () => {
    await expect(client().leadBatch([])).rejects.toThrow(
      "urls must be a non-empty array",
    );
  });

  it("getLeadBatch GETs /v1/lead/batch/{id} by encoded id", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(doneRes));
    const res = await client().getLeadBatch("lb/1");
    expect(res.status).toBe("completed");
    expect(res.succeeded).toBe(1);
    expect(res.results).toHaveLength(2);
    const first = res.results[0];
    expect(first.status).toBe("success");
    // Narrow the discriminated union to read the enriched lead.
    if (first.status === "success") {
      expect(first.lead.company_name).toBe("Resend");
      expect(first.lead.people?.[0].name).toBe("Zeno Rocha");
      expect(first.cache).toBe("miss");
    }
    const second = res.results[1];
    if (second.status === "error") {
      expect(second.error).toBe("fetch failed");
    }
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/lead/batch/lb%2F1",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("GET");
  });

  it("waitForLeadBatch polls /v1/lead/batch/{id} until completed", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse({ ...doneRes, status: "processing", completed: 1 }),
      )
      .mockResolvedValueOnce(jsonResponse(doneRes));
    const res = await client().waitForLeadBatch("lb_1", { interval: 10 });
    expect(res.status).toBe("completed");
    expect(res.succeeded).toBe(1);
    expect(res.credits_charged).toBe(100);
    // 2 polls
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/lead/batch/lb_1",
    );
  });

  it("waitForLeadBatch returns on failed status", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ...doneRes, status: "failed", error: "batch failed" }),
    );
    const res = await client().waitForLeadBatch("lb_1", { interval: 10 });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("batch failed");
  });

  it("leadBatch start is not aborted by the client timeout", async () => {
    const wc = client({ timeout: 20 });
    // Resolve the start after the 20ms client timeout would have fired;
    // start calls disable the per-request deadline, so it still resolves.
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(jsonResponse(startRes)), 60),
        ),
    );
    const res = await wc.leadBatch(["https://resend.com"]);
    expect(res.id).toBe("lb_1");
  });
});

// ---- POST /v1/summarize ----

describe("summarize", () => {
  it("returns summary text", async () => {
    const sumRes: SummarizeResponse = { summary: "A short summary." };
    fetchSpy.mockResolvedValueOnce(jsonResponse(sumRes));
    const res = await client().summarize({
      url: "https://example.com",
      max_sentences: 3,
    });
    expect(res.summary).toBe("A short summary.");
  });
});

// ---- POST /v1/brand ----

describe("brand", () => {
  it("returns brand data", async () => {
    const brandRes = { name: "Acme", colors: ["#fff"] };
    fetchSpy.mockResolvedValueOnce(jsonResponse(brandRes));
    const res = await client().brand({ url: "https://acme.com" });
    expect(res.name).toBe("Acme");
  });
});

// ---- Error handling ----

describe("error handling", () => {
  it("throws AuthenticationError on 401", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "Unauthorized" }, 401),
    );
    await expect(
      client().scrape({ url: "https://example.com" }),
    ).rejects.toThrow(AuthenticationError);
  });

  it("throws CreditLimitError on 402", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "Credit limit reached" }, 402),
    );
    try {
      await client().scrape({ url: "https://example.com" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CreditLimitError);
      expect((err as CreditLimitError).status).toBe(402);
      expect((err as CreditLimitError).message).toBe("Credit limit reached");
    }
  });

  it("throws ScopeError on 403", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "scope 'crawl' denied" }, 403),
    );
    try {
      await client().scrape({ url: "https://example.com" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeError);
      expect((err as ScopeError).status).toBe(403);
      expect((err as ScopeError).message).toBe("scope 'crawl' denied");
    }
  });

  it("throws NotFoundError on 404", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "Not found" }, 404));
    await expect(client().getCrawlStatus("bad-id")).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws RateLimitError on 429 with retry-after", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );
    try {
      await client().scrape({ url: "https://example.com" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfter).toBe(30);
    }
  });

  it("throws WebclawError on other status codes", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "Internal error" }, 500),
    );
    try {
      await client().scrape({ url: "https://example.com" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WebclawError);
      expect((err as WebclawError).status).toBe(500);
    }
  });

  it("throws WebclawError on network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(
      client().scrape({ url: "https://example.com" }),
    ).rejects.toThrow(WebclawError);
  });

  it("throws TimeoutError when request exceeds timeout", async () => {
    fetchSpy.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const wc = client({ timeout: 50 });
    await expect(wc.scrape({ url: "https://example.com" })).rejects.toThrow(
      TimeoutError,
    );
  });

  it("error message uses JSON error field when available", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: "Custom server error" }, 502),
    );
    try {
      await client().scrape({ url: "https://example.com" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as WebclawError).message).toBe("Custom server error");
    }
  });

  it("returns undefined on a non-204 success with an empty body", async () => {
    // Some endpoints reply 200/202 with no content; an empty body must
    // not be parsed as JSON (which used to throw "Invalid JSON").
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 202 }));
    const res = await client().watchCheck("watch_1");
    expect(res).toBeUndefined();
  });
});

// ---- Input validation guards ----

describe("input validation", () => {
  it("map requires url", async () => {
    // @ts-expect-error testing runtime guard
    await expect(client().map({})).rejects.toThrow("url is required");
  });

  it("crawl requires url", async () => {
    // @ts-expect-error testing runtime guard
    await expect(client().crawl({})).rejects.toThrow("url is required");
  });

  it("summarize requires url", async () => {
    // @ts-expect-error testing runtime guard
    await expect(client().summarize({})).rejects.toThrow("url is required");
  });

  it("brand requires url", async () => {
    // @ts-expect-error testing runtime guard
    await expect(client().brand({})).rejects.toThrow("url is required");
  });

  it("diff requires url", async () => {
    // @ts-expect-error testing runtime guard
    await expect(client().diff({})).rejects.toThrow("url is required");
  });
});

// ---- URL construction ----

describe("URL construction", () => {
  it("uses default base URL", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ urls: [], count: 0 }));
    await client().map({ url: "https://example.com" });
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.webclaw.io/v1/map");
  });

  it("uses custom base URL", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ urls: [], count: 0 }));
    await client({ baseUrl: "http://localhost:3000" }).map({
      url: "https://example.com",
    });
    expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:3000/v1/map");
  });

  it("encodes crawl ID in path", async () => {
    const statusRes: CrawlStatusResponse = {
      id: "id/with/slashes",
      status: "completed",
      pages: [],
      total: 0,
      completed: 0,
      errors: 0,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(statusRes));
    await client().getCrawlStatus("id/with/slashes");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/crawl/id%2Fwith%2Fslashes",
    );
  });
});

// ---- YouTube fields on /v1/scrape ----

describe("scrape YouTube fields", () => {
  it("surfaces youtube block and transcript when present", async () => {
    const ytRes: ScrapeResponse = {
      url: "https://youtube.com/watch?v=abc12345678",
      metadata: { title: "Some video" },
      cache: { status: "miss" },
      youtube: {
        video_id: "abc12345678",
        title: "Some video",
        description: "desc",
        channel: "Chan",
        channel_url: "https://youtube.com/@chan",
        uploader: "Chan",
        upload_date: "20260101",
        duration_seconds: 123,
        view_count: 1000,
        like_count: 50,
        thumbnail: "https://i.ytimg.com/x.jpg",
        tags: ["a", "b"],
        categories: ["Education"],
        language: "en",
      },
      transcript: "line one\nline two",
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(ytRes));
    const res = await client().scrape({
      url: "https://youtube.com/watch?v=abc12345678",
    });
    expect(res.youtube?.video_id).toBe("abc12345678");
    expect(res.youtube?.duration_seconds).toBe(123);
    expect(res.youtube?.tags).toEqual(["a", "b"]);
    expect(res.transcript).toBe("line one\nline two");
  });

  it("youtube/transcript are optional and may be absent", async () => {
    const plain: ScrapeResponse = {
      url: "https://example.com",
      metadata: {},
      markdown: "# x",
      cache: { status: "miss" },
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(plain));
    const res = await client().scrape({ url: "https://example.com" });
    expect(res.youtube).toBeUndefined();
    expect(res.transcript).toBeUndefined();
  });
});

// ---- Watch endpoints ----

describe("watch endpoints", () => {
  const watch: WatchResponse = {
    id: "watch_1",
    url: "https://example.com",
    name: "Page",
    interval_minutes: 60,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
  };

  it("watchCreate POSTs to /v1/watch", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(watch));
    const res = await client().watchCreate({
      url: "https://example.com",
      name: "Page",
      interval_minutes: 60,
    });
    expect(res.id).toBe("watch_1");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.webclaw.io/v1/watch");
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("watchCreate requires url", async () => {
    await expect(
      // @ts-expect-error testing runtime guard
      client().watchCreate({ name: "no url" }),
    ).rejects.toThrow("url is required");
  });

  it("watchList builds limit/offset query string", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ watches: [watch], total: 1 }));
    const res = await client().watchList(10, 5);
    expect(res).toHaveLength(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/watch?limit=10&offset=5",
    );
  });

  it("watchList omits query string when no args", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ watches: [], total: 0 }));
    await client().watchList();
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.webclaw.io/v1/watch");
  });

  it("watchGet GETs a single watch by encoded id", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(watch));
    const res = await client().watchGet("watch/1");
    expect(res.id).toBe("watch_1");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/watch/watch%2F1",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("GET");
  });

  it("watchCheck POSTs to /v1/watch/{id}/check", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: "checking" }));
    const res = await client().watchCheck("watch_1");
    expect(res.status).toBe("checking");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/watch/watch_1/check",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("watchDelete handles 204 no-body and resolves void", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await client().watchDelete("watch_1");
    expect(res).toBeUndefined();
    expect(fetchSpy.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/watch/watch_1",
    );
  });
});

// ---- X (Twitter) monitor endpoints ----

describe("x monitor endpoints", () => {
  const monitor: XMonitor = {
    id: "xmon_1",
    kind: "profile",
    target: "webclaw",
    name: "Mentions",
    interval_minutes: 15,
    webhook_url: "https://discord.com/api/webhooks/x",
    active: true,
  };

  it("createXMonitor POSTs to /v1/x/monitors", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(monitor));
    const res = await client().createXMonitor({
      kind: "profile",
      target: "@webclaw",
      name: "Mentions",
    });
    expect(res.id).toBe("xmon_1");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/monitors",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("createXMonitor requires kind", async () => {
    await expect(
      // @ts-expect-error testing runtime guard
      client().createXMonitor({ target: "@webclaw" }),
    ).rejects.toThrow("kind is required");
  });

  it("createXMonitor requires target", async () => {
    await expect(
      // @ts-expect-error testing runtime guard
      client().createXMonitor({ kind: "profile" }),
    ).rejects.toThrow("target is required");
  });

  it("listXMonitors builds limit/offset query string", async () => {
    const body: ListXMonitorsResponse = { monitors: [monitor] };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));
    const res = await client().listXMonitors(10, 5);
    expect(res.monitors).toHaveLength(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/monitors?limit=10&offset=5",
    );
  });

  it("listXMonitors omits query string when no args", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ monitors: [] }));
    await client().listXMonitors();
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/monitors",
    );
  });

  it("getXMonitor GETs a single monitor by encoded id", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(monitor));
    const res = await client().getXMonitor("xmon/1");
    expect(res.id).toBe("xmon_1");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/monitors/xmon%2F1",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("GET");
  });

  it("updateXMonitor PATCHes and returns success", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    const res = await client().updateXMonitor("xmon_1", { active: false });
    expect(res.success).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/monitors/xmon_1",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("PATCH");
  });

  it("deleteXMonitor DELETEs and returns success", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ success: true }));
    const res = await client().deleteXMonitor("xmon_1");
    expect(res.success).toBe(true);
    expect(fetchSpy.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/monitors/xmon_1",
    );
  });

  it("checkXMonitor POSTs to /v1/x/monitors/{id}/check", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: "checking" }));
    const res = await client().checkXMonitor("xmon_1");
    expect(res.status).toBe("checking");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/monitors/xmon_1/check",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("exportXAudience POSTs to /v1/x/audience", async () => {
    const body: ExportXAudienceResponse = {
      user_id: "44196397",
      direction: "followers",
      count: 1,
      users: [
        {
          id: "1",
          screen_name: "someone",
          name: "Some One",
          followers: 10,
          description: "",
          url: "",
        },
      ],
      next_cursor: null,
      pages_fetched: 1,
      credits_charged: 1,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));
    const res = await client().exportXAudience({ handle: "@webclaw" });
    expect(res.next_cursor).toBeNull();
    expect(res.users).toHaveLength(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/x/audience",
    );
    expect(fetchSpy.mock.calls[0][1].method).toBe("POST");
  });

  it("exportXAudience requires handle or user_id", async () => {
    await expect(client().exportXAudience({})).rejects.toThrow(
      "handle or user_id is required",
    );
  });
});

// ---- Research polling ----

describe("research polling", () => {
  it("polls /v1/research/{id} until completed", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "r1", status: "running" }),
    );

    const done: ResearchResponse = {
      id: "r1",
      query: "q",
      status: "completed",
      report: "the report",
      sources_count: 3,
      findings_count: 2,
    };
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ id: "r1", status: "running" }))
      .mockResolvedValueOnce(jsonResponse(done));

    const res = await client().research({ query: "q" }, { interval: 10 });
    expect(res.status).toBe("completed");
    expect(res.report).toBe("the report");
    // 1 start + 2 polls
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("research returns on failed status", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "r2", status: "running" }),
    );
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "r2", query: "q", status: "failed" }),
    );
    const res = await client().research({ query: "q" }, { interval: 10 });
    expect(res.status).toBe("failed");
  });

  it("waitForResearch polls an existing id to completion", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "r3", query: "q", status: "completed", report: "ok" }),
    );
    const res = await client().waitForResearch("r3", { interval: 10 });
    expect(res.report).toBe("ok");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.webclaw.io/v1/research/r3",
    );
  });
});

// ---- Async start calls ignore the per-request timeout ----

describe("async start timeout", () => {
  it("crawl start is not aborted by the client timeout", async () => {
    const wc = client({ timeout: 20 });
    // Resolve the start well after the 20ms client timeout would have
    // fired; with the timeout disabled for start calls it still works.
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () => resolve(jsonResponse({ id: "slow-job", status: "running" })),
            60,
          ),
        ),
    );
    const job = await wc.crawl({ url: "https://example.com" });
    expect(job.id).toBe("slow-job");
  });

  it("research start is not aborted by the client timeout", async () => {
    const wc = client({ timeout: 20 });
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () => resolve(jsonResponse({ id: "r-slow", status: "running" })),
            60,
          ),
        ),
    );
    // Status poll completes immediately.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "r-slow", query: "q", status: "completed" }),
    );
    const res = await wc.research({ query: "q" }, { interval: 5 });
    expect(res.status).toBe("completed");
  });
});

// ---- Resilient polling (per-poll timeout + 429) ----

// Mimics a slow request: never resolves, only rejects when the
// client's per-request AbortController fires (-> client TimeoutError).
function abortableFetch(_url: string, init: RequestInit): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
  });
}

describe("resilient polling", () => {
  it("swallows a per-poll TimeoutError and keeps polling until done", async () => {
    // Crawl start succeeds.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "c1", status: "running" }),
    );
    // First poll times out (slow request -> client abort -> TimeoutError).
    fetchSpy.mockImplementationOnce(abortableFetch);
    // Second poll completes.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        id: "c1",
        status: "completed",
        pages: [],
        total: 0,
        completed: 0,
        errors: 0,
      }),
    );

    const wc = client({ timeout: 30 });
    const job = await wc.crawl({ url: "https://example.com" });
    const res = await job.waitForCompletion({ interval: 5, maxWait: 5_000 });
    expect(res.status).toBe("completed");
    // start + timed-out poll + successful poll
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("swallows a transient 429 on a poll and continues", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "c2", status: "running" }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "retry-after": "0" },
      }),
    );
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        id: "c2",
        status: "completed",
        pages: [],
        total: 0,
        completed: 0,
        errors: 0,
      }),
    );

    const job = await client().crawl({ url: "https://example.com" });
    const res = await job.waitForCompletion({ interval: 5, maxWait: 5_000 });
    expect(res.status).toBe("completed");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("propagates a non-transient error (404) from a poll immediately", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "c3", status: "running" }),
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: "gone" }, 404));

    const job = await client().crawl({ url: "https://example.com" });
    await expect(
      job.waitForCompletion({ interval: 5, maxWait: 5_000 }),
    ).rejects.toThrow(NotFoundError);
  });

  it("gives up after too many consecutive transient failures", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ id: "c4", status: "running" }),
    );
    // Every poll 429s forever.
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "nope" }), {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      ),
    );

    const job = await client().crawl({ url: "https://example.com" });
    await expect(
      job.waitForCompletion({ interval: 1, maxWait: 5_000 }),
    ).rejects.toThrow(/consecutive transient errors/);
  });
});
