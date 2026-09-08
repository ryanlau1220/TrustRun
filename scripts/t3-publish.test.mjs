import assert from "node:assert/strict";
import { executorOrigin, isContractVersionAlreadyRegistered, isMapAlreadyExists } from "./t3-publish.mjs";

assert.equal(executorOrigin("https://executor.example"), "https://executor.example");
assert.throws(() => executorOrigin("http://executor.example"));
assert.throws(() => executorOrigin("https://executor.example/path"));
assert.equal(isMapAlreadyExists(new Error("RPC Error: map already exists")), true);
assert.equal(isMapAlreadyExists(new Error("RPC Error: unavailable")), false);
assert.equal(isContractVersionAlreadyRegistered(new Error("RPC Error: contract version invalid: version 0.1.5 is not higher than current version 0.1.5")), true);
assert.equal(isContractVersionAlreadyRegistered(new Error("RPC Error: unavailable")), false);
