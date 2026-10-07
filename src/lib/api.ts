import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ApiError } from "./errors";
import { rateLimit } from "./ratelimit";
import { headers } from "next/headers";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/** Rate limit by client IP; throws 429. */
export async function limit(bucket: string, max: number, windowMs = 60_000) {
  if (!rateLimit(`${bucket}:${await clientIp()}`, max, windowMs)) throw new ApiError(429, "Too many requests. Please slow down.");
}

export async function body<T extends ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
  return schema.parse(raw);
}

/** Wraps a handler: maps ApiError/ZodError/unknown to the JSON error contract {error:{code,message}}. */
export function route<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A): Promise<Response> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: { code: e.code ?? String(e.status), message: e.message } }, e.status);
      if (e instanceof ZodError)
        return json({ error: { code: "400", message: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, 400);
      console.error("unhandled", e);
      return json({ error: { code: "500", message: "Something went wrong. Please try again." } }, 500);
    }
  };
}
