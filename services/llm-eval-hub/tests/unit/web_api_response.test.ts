import assert from "node:assert/strict";
import test from "node:test";

import { readResponseBody } from "../../apps/web/src/api/response.ts";

test("readResponseBody parses a JSON error response", async () => {
  const response = new Response(JSON.stringify({ detail: "invalid endpoint" }));

  assert.deepEqual(await readResponseBody(response), { detail: "invalid endpoint" });
  assert.equal(response.bodyUsed, true);
});

test("readResponseBody preserves a plain-text error response", async () => {
  const response = new Response("Endpoint upstream rejected the request");

  assert.equal(await readResponseBody(response), "Endpoint upstream rejected the request");
  assert.equal(response.bodyUsed, true);
});

test("readResponseBody handles an empty error response", async () => {
  const response = new Response(null);

  assert.equal(await readResponseBody(response), null);
  assert.equal(response.bodyUsed, false);
});
