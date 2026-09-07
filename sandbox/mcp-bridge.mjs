import { createConnection } from "node:net";

const socketPath = process.env.TRUSTRUN_SESSION_SOCKET;
if (!socketPath) process.exit(1);
const socket = createConnection(socketPath);
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.once("error", () => process.exit(1));
