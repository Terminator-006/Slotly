export interface FieldIssue {
  path: string;
  message: string;
}

export class ClientApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: FieldIssue[],
  ) {
    super(message);
  }
}

/** Thin fetch wrapper for our own JSON API. Throws ClientApiError with the server's message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    cache: "no-store",
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: FieldIssue[] } } | null)?.error;
    throw new ClientApiError(res.status, err?.code ?? "unknown", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return json as T;
}

/** "name: Too short; slug: ..." style summary for field-level validation errors. */
export function describeError(e: unknown): string {
  if (e instanceof ClientApiError) {
    if (e.details?.length) return e.details.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join(" · ");
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
