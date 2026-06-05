import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);

  if (pathname === "/api/groups" || pathname === "/api/games") {
    const upstream = pathname.endsWith("groups")
      ? "https://worldcup26.ir/get/groups"
      : "https://worldcup26.ir/get/games";
    try {
      const apiResponse = await fetch(upstream);
      const body = await apiResponse.text();
      response.writeHead(apiResponse.status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(body);
    } catch (error) {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  const filePath = normalize(join(root, pathname === "/" ? "index.html" : pathname));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "text/plain" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Draft Dojo running at http://127.0.0.1:${port}`);
});
