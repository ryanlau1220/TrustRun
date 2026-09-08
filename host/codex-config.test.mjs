import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(
	new URL("./codex-config.toml", import.meta.url),
	"utf8",
);
assert.match(
	config,
	/^model_provider = "trustrun-gonka"\nmodel = "deepseek-ai\/DeepSeek-V4-Flash-0731"/,
);
assert.match(config, /wire_api = "responses"/);
assert.match(
	config,
	/\[mcp_servers\.trustrun\.env\]\nTRUSTRUN_SESSION_SOCKET = "\/run\/trustrun\/session\.sock"/,
);
assert.doesNotMatch(config, /enabled_tools/);
assert.match(config, /default_tools_approval_mode = "approve"/);
