import { createServer, createConnection } from "node:net";

const socketPath = process.env.TRUSTRUN_MODEL_SOCKET;
if (!socketPath) throw new Error("TRUSTRUN_MODEL_SOCKET is required");

const server = createServer({ allowHalfOpen: false }, (client) => {
  const gateway = createConnection({ path: socketPath });
  client.pipe(gateway).pipe(client);
  const close = () => {
    client.destroy();
    gateway.destroy();
  };
  client.once("error", close);
  gateway.once("error", close);
});

server.listen({ host: "127.0.0.1", port: 8787 });
