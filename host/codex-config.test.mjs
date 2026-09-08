import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("./codex-config.toml", import.meta.url), "utf8");
assert.match(config, /\[mcp_servers\.trustrun\.env\]\nTRUSTRUN_SESSION_SOCKET = "\/run\/trustrun\/session\.sock"/);
