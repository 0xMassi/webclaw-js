/**
 * Error hierarchy for the Webclaw SDK.
 * All errors extend WebclawError so callers can catch broadly or narrowly.
 */

export class WebclawError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "WebclawError";
  }
}

export class AuthenticationError extends WebclawError {
  constructor(message = "Invalid or missing API key") {
    super(message, 401);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends WebclawError {
  public readonly retryAfter: number | null;

  constructor(retryAfterSeconds: number | null = null) {
    super("Rate limit exceeded", 429);
    this.name = "RateLimitError";
    this.retryAfter = retryAfterSeconds;
  }
}

export class NotFoundError extends WebclawError {
  constructor(message = "Resource not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class TimeoutError extends WebclawError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}
