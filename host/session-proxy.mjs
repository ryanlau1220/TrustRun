import { spawn } from "node:child_process";
import { createServer } from "node:net";

const socketPath = process.env.TRUSTRUN_SESSION_SOCKET;
if (!socketPath) throw new Error("TRUSTRUN_SESSION_SOCKET is required");

let connected = false;
const server = createServer({ allowHalfOpen: false }, (socket) => {
  if (connected) return socket.destroy();
  connected = true;
  const child = spawn(process.execPath, [new URL("../mcp/server.mjs", import.meta.url)], {
    env: { PATH: process.env.PATH, T3N_API_KEY: process.env.T3N_API_KEY },
    stdio: ["pipe", "pipe", "ignore"],
  });
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
  const close = () => {
    socket.destroy();
    child.kill();
    connected = false;
  };
  socket.once("close", close);
  child.once("exit", () => socket.destroy());
});
server.listen({ path: socketPath, readableAll: false, writableAll: false });
