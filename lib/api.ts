import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

/** Consistent JSON errors: { error: { code, message, details? } } */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function validate<T>(schema: ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      422,
      "validation_error",
      "Some fields are invalid",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
  return validate(schema, raw);
}

export function readQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return validate(schema, Object.fromEntries(req.nextUrl.searchParams));
}

function toResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    const headers: Record<string, string> = {};
    if (e.status === 429 && typeof e.details === "number") headers["Retry-After"] = String(e.details);
    return NextResponse.json(
      { error: { code: e.code, message: e.message, details: e.status === 429 ? undefined : e.details } },
      { status: e.status, headers },
    );
  }
  console.error("[slotly] unhandled error", e);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

/** Wrap a route handler so thrown ApiErrors become clean JSON responses. */
export function route(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      return await handler(req);
    } catch (e) {
      return toResponse(e);
    }
  };
}

/** Same, for dynamic segments (Next 15 passes `params` as a Promise). */
export function routeWithParams<P extends Record<string, string>>(
  handler: (req: NextRequest, params: P) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      return await handler(req, await ctx.params);
    } catch (e) {
      return toResponse(e);
    }
  };
}

export function rateLimited(retryAfterSec: number): ApiError {
  return new ApiError(429, "rate_limited", "Too many requests, please slow down", retryAfterSec);
}
