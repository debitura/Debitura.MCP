import { spawn } from "node:child_process";
import { startStdioServer, ServerType } from "mcp-proxy";
import { PORT } from "./config.js";

/**
 * Stdio adapter used only by Glama's Docker build-and-introspect check, which
 * spawns the container's CMD and speaks MCP over its stdio. This server itself
 * only speaks streamable HTTP (see index.ts), so this process starts a local
 * instance of it as a child, then bridges that instance's HTTP endpoint to
 * stdio. Not used by the production hosted service or the repo's own
 * Dockerfile (`docker run -p 3000:3000`, which just runs index.js directly).
 */

const healthzUrl = `http://127.0.0.1:${PORT}/healthz`;
const mcpUrl = `http://127.0.0.1:${PORT}/mcp`;

const child = spawn(process.execPath, ["dist/index.js"], {
  stdio: ["ignore", "ignore", "inherit"],
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

async function waitUntilHealthy(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthzUrl);
      if (res.ok) return;
    } catch {
      // Server not accepting connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

await waitUntilHealthy(10_000);

await startStdioServer({
  serverType: ServerType.HTTPStream,
  url: mcpUrl,
});
