import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../dist/server/index.js";
import { browserFixture } from "./fixture.mjs";

// Browser regression/preview server: mock all APIs in memory, never use portable
// local-data handlers or call academic providers. Restart to reset the fixture.
const root = fileURLToPath(new URL("../../dist/client/", import.meta.url));
const types = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
let data = browserFixture();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:4173");
    if (url.pathname.startsWith("/api/")) {
      let value;
      if (url.pathname === "/api/runtime-status") value = { sessionToken: "synthetic-test-session" };
      else if (url.pathname === "/api/local-data") {
        if (req.method === "PATCH") {
          let body = "";
          for await (const chunk of req) body += chunk;
          data = { ...data, ...JSON.parse(body).patch, revision: data.revision + 1 };
        }
        value = data;
      } else if (url.pathname === "/api/local-settings") value = { version: 3, openAlexConfigured: false };
      else if (url.pathname === "/api/reminders/status") value = { config: { enabled: false }, credentialConfigured: false, tested: false };
      else if (url.pathname === "/api/feed") {
        let body = "";
        for await (const chunk of req) body += chunk;
        value = { ...data.feed, scholars: JSON.parse(body).subscriptions.scholar };
      }
      else { res.writeHead(404); res.end("Unmocked API"); return; }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(value));
    } else if (url.pathname === "/") {
      const response = await worker.fetch(new Request(url));
      res.writeHead(response.status, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(await response.text());
    } else {
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) { res.writeHead(403); res.end(); return; }
      const content = await readFile(path);
      res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
      res.end(content);
    }
  } catch { res.writeHead(404); res.end("Preview resource unavailable"); }
});
server.listen(4173, "127.0.0.1", () => console.log("Synthetic preview: http://127.0.0.1:4173"));
