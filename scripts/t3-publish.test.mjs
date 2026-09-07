import assert from "node:assert/strict";
import { executorOrigin, isMapAlreadyExists } from "./t3-publish.mjs";

assert.equal(executorOrigin("https://executor.example"), "https://executor.example");
assert.throws(() => executorOrigin("http://executor.example"));
assert.throws(() => executorOrigin("https://executor.example/path"));
assert.equal(isMapAlreadyExists(new Error("RPC Error: map already exists")), true);
assert.equal(isMapAlreadyExists(new Error("RPC Error: unavailable")), false);
