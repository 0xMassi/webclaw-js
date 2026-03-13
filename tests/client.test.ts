import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Webclaw,
  WebclawError,
  AuthenticationError,
  RateLimitError,
  NotFoundError,
  TimeoutError,
} from "../src/index.js";
import type {
  ScrapeResponse,
  CrawlStatusResponse,
  MapResponse,
  BatchResponse,
  ExtractResponse,
  SummarizeResponse,
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
    ).rejects.toThrow("Crawl polling timed out");
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
