import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

const socketPath = process.env.TRUSTRUN_SESSION_SOCKET;
if (!socketPath) throw new Error("TRUSTRUN_SESSION_SOCKET is required");

const mcpSource = readFileSync(new URL("../mcp/server.mjs", import.meta.url), "utf8");
const child = spawn(process.execPath, ["--input-type=module", "--eval", mcpSource], {
  cwd: process.cwd(),
  env: { PATH: process.env.PATH, T3N_API_KEY: process.env.T3N_API_KEY },
  stdio: ["pipe", "pipe", "ignore"],
});
let claimed = false;
const server = createServer({ allowHalfOpen: false }, (socket) => {
  if (claimed) return socket.destroy();
  claimed = true;
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
  const close = () => {
    socket.destroy();
    child.kill();
    server.close();
  };
  socket.once("close", close);
  child.once("exit", () => socket.destroy());
});
server.listen({ path: socketPath, readableAll: false, writableAll: false });
