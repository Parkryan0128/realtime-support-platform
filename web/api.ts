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
    const error = await response.json().catch(() => ({
      code: "UNAVAILABLE",
      message: "The server is unavailable",
    }));
    throw new HttpError(response.status, error.code, error.message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export type Request = <T>(path: string, options?: Options) => Promise<T>;
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";
export const aborted = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";
