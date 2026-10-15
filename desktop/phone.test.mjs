// Run with: node --test desktop/phone.test.mjs
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";

const { createPhoneBridge } = createRequire(import.meta.url)("./phone.js");

test("phone access is closed until the code is entered, then forwards to the server", async () => {
  const upstream = http.createServer((req, res) => res.end(`secret data for ${req.url}`));
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const bridge = createPhoneBridge({ targetPort: upstream.address().port, log: () => {} });

  assert.equal(bridge.state().enabled, false);
  const { address, code } = await bridge.enable().then((s) => s);
  const base = (address ?? `http://127.0.0.1:${bridge.state().address?.split(":").pop()}`);
  const root = base.replace(/^http:\/\/[^:]+/, "http://127.0.0.1");

  const blocked = await fetch(`${root}/api/anything`);
  assert.equal(blocked.status, 401);
  assert.ok(!(await blocked.text()).includes("secret"));

  const bad = await fetch(`${root}/__pair`, { method: "POST", body: "code=000000", headers: { "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
  assert.equal(bad.status, 401);

  const good = await fetch(`${root}/__pair`, { method: "POST", body: `code=${code}`, headers: { "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
  assert.equal(good.status, 303);
  const cookie = good.headers.get("set-cookie").split(";")[0];

  const ok = await fetch(`${root}/notes`, { headers: { cookie } });
  assert.equal(await ok.text(), "secret data for /notes");

  await bridge.disable();
  assert.equal(bridge.state().enabled, false);
  await assert.rejects(fetch(`${root}/notes`, { headers: { cookie } }));
  upstream.close();
});

test("five wrong codes pause further tries", async () => {
  const upstream = http.createServer((_req, res) => res.end("x"));
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const bridge = createPhoneBridge({ targetPort: upstream.address().port, log: () => {} });
  const { address } = await bridge.enable();
  const root = address.replace(/^http:\/\/[^:]+/, "http://127.0.0.1");
  let last;
  for (let i = 0; i < 6; i++) last = await fetch(`${root}/__pair`, { method: "POST", body: "code=111111", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(last.status, 429);
  await bridge.disable();
  upstream.close();
});
