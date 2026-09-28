import { afterEach, expect, test, vi } from "vitest";
import { api } from "../web/api.js";

afterEach(() => vi.unstubAllGlobals());

test.each(["null", "[]", '"unauthorized"', "<html>Unauthorized</html>"])(
  "an unexpected error body preserves the HTTP status: %s",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 401 })),
    );
    await expect(api("/me")).rejects.toMatchObject({
      status: 401,
      code: "HTTP_ERROR",
      message: "Request failed (401)",
    });
  },
);

test("structured API errors retain their application code and message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VERSION_CONFLICT",
          message: "Ticket changed",
        }),
        { status: 409 },
      ),
    ),
  );
  await expect(api("/tickets/example")).rejects.toMatchObject({
    status: 409,
    code: "VERSION_CONFLICT",
    message: "Ticket changed",
  });
});
