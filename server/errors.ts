import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = () =>
  new ApiError(404, "NOT_FOUND", "Resource not found");
export const forbidden = () => new ApiError(403, "FORBIDDEN", "Access denied");

export const errors: ErrorRequestHandler = (
  error,
  _request,
  response,
  _next,
) => {
  if (error instanceof ZodError || error?.type === "entity.parse.failed") {
    response
      .status(400)
      .json({ code: "INVALID_REQUEST", message: "Invalid request data" });
  } else if (error instanceof ApiError) {
    response
      .status(error.status)
      .json({ code: error.code, message: error.message });
  } else if (error?.type === "entity.too.large") {
    response
      .status(413)
      .json({ code: "TOO_LARGE", message: "Request body is too large" });
  } else if (error?.code === "55P03" || error?.code === "40P01") {
    response.status(503).json({
      code: "RETRY_LATER",
      message: "Resource is busy; retry this request",
    });
  } else {
    console.error("Request failed", error);
    response
      .status(500)
      .json({ code: "INTERNAL_ERROR", message: "Request failed" });
  }
};
