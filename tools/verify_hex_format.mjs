import assert from "node:assert/strict";
import {
  formatBinaryChunkPreview,
  formatHexDump,
  HexLineBuffer,
  HEX_BYTES_PER_LINE,
} from "../docs/hex_format.js";

const data = new Uint8Array([0x48, 0x50, 0x01, 0x0a, 0xff]);
assert.deepEqual(formatHexDump(data, 0), ["00000000  48 50 01 0A FF"]);
assert.deepEqual(formatHexDump(new Uint8Array(20).fill(0xab), 16), [
  "00000010  AB AB AB AB AB AB AB AB AB AB AB AB AB AB AB AB",
  "00000020  AB AB AB AB",
]);

const chunk = new Uint8Array(40);
chunk[0] = 0x48;
chunk[1] = 0x50;
const preview = formatBinaryChunkPreview(chunk, 8);
assert.match(preview, /^\[binary 40 B\] 48 50/);
assert.match(formatBinaryChunkPreview(chunk, 8), /… \(\+32 bytes\)$/);

const hexBuffer = new HexLineBuffer();
assert.deepEqual(hexBuffer.push(new Uint8Array([0x01, 0x02])), []);
assert.deepEqual(hexBuffer.push(new Uint8Array(13).fill(0xab)), []);
const line = hexBuffer.push(new Uint8Array([0xff]))[0];
assert.match(line, /^00000000  /);
const hexParts = line.split("  ")[1].trim().split(" ");
assert.equal(hexParts.length, HEX_BYTES_PER_LINE);
assert.equal(hexParts[0], "01");
assert.equal(hexParts[1], "02");
assert.equal(hexParts[15], "FF");

const flushed = hexBuffer.flush();
assert.equal(flushed.length, 0);

hexBuffer.push(new Uint8Array([0x10, 0x20, 0x30]));
const padded = hexBuffer.flush()[0];
assert.match(padded, /^00000010  10 20 30/);
assert.equal(padded.length, line.length);

console.log("PASS: hex format helpers");