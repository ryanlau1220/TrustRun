import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RestartState } from "./server.mjs";

const state = new RestartState(join(mkdtempSync(join(tmpdir(), "trustrun-")), "state.db"), 1_000);
assert.equal(state.reserve(10), "granted");
assert.equal(state.reserve(11), "in_flight");
state.complete();
assert.equal(state.reserve(12), "cooldown");
assert.equal(state.reserve(1_010), "granted");
state.close();
