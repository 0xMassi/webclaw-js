import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import * as esm from "../dist/index.mjs";

const cjs = createRequire(import.meta.url)("../dist/index.js");
const requests = [];
const response = { markdown: "# Package fixture", metadata: { title: null } };
const server = createServer(async (request, reply) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  requests.push({
    method: request.method,
    path: request.url,
    authorization: request.headers.authorization,
    body,
  });
  const denied = body.url.endsWith("/denied");
  reply.writeHead(denied ? 401 : 200, { "Content-Type": "application/json" });
  reply.end(JSON.stringify(denied ? { error: "Fixture denial" } : response));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");

try {
  for (const sdk of [esm, cjs]) {
    const client = new sdk.Webclaw({
      apiKey: "package-fixture",
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      timeout: 2000,
    });
    for (const method of ["lead", "leadBatch", "getLeadBatch", "waitForLeadBatch"]) {
      assert.equal(method in client, false, `${method} must not be exposed`);
    }
    const body = { url: "https://example.com", formats: ["markdown"] };
    assert.deepEqual(await client.scrape(body), response);
    assert.deepEqual(requests.at(-1), {
      method: "POST",
      path: "/v1/scrape",
      authorization: "Bearer package-fixture",
      body,
    });
    await assert.rejects(
      client.scrape({ url: "https://example.com/denied" }),
      sdk.AuthenticationError,
    );
  }
  assert.equal(requests.length, 4);
  console.log(`ESM and CommonJS HTTP/error checks passed on ${process.version}`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
