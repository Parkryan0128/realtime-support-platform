export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface Options {
  method?: string;
  body?: unknown;
  csrf?: string;
  signal?: AbortSignal;
}
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = body && typeof body === "object" ? body : {};
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "HTTP_ERROR";
    const detail =
      "message" in error && typeof error.message === "string"
        ? error.message
        : `Request failed (${response.status})`;
    throw new HttpError(response.status, code, detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export type Request = <T>(path: string, options?: Options) => Promise<T>;
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";
export const aborted = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";
