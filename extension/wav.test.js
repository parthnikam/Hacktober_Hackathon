import assert from "node:assert/strict";
import { downsample, encodeWav, mixToMono } from "./lib/wav.js";

const mixed = mixToMono([new Float32Array([0, 0]), new Float32Array([1, 1])]);
assert.deepEqual([...downsample(mixed, 4, 2)], [0, 1]);

const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
const view = new DataView(wav.buffer);
assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
assert.equal(view.getUint16(22, true), 1);
assert.equal(view.getUint32(24, true), 16000);
assert.equal(view.getInt16(44, true), 0);
assert.equal(view.getInt16(46, true), 32767);
assert.equal(view.getInt16(48, true), -32768);

console.log("wav checks passed");
