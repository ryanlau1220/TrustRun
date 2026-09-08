import { createServer } from "node:net";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.mjs";

const socketPath = process.env.TRUSTRUN_SESSION_SOCKET;
if (!socketPath) throw new Error("TRUSTRUN_SESSION_SOCKET is required");

let claimed = false;
const server = createServer({ allowHalfOpen: false }, async (socket) => {
  socket.on("error", () => {});
  if (claimed) return socket.destroy();
  claimed = true;
  try {
    const mcp = createMcpServer();
    socket.once("close", () => {
      claimed = false;
      void mcp.close();
    });
    await mcp.connect(new StdioServerTransport(socket, socket));
  } catch {
    socket.destroy();
  }
});
server.listen({ path: socketPath, readableAll: false, writableAll: false });
