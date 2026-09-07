import assert from "node:assert/strict";
import { executorOrigin } from "./t3-publish.mjs";

assert.equal(executorOrigin("https://executor.example"), "https://executor.example");
assert.throws(() => executorOrigin("http://executor.example"));
assert.throws(() => executorOrigin("https://executor.example/path"));
