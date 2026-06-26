import assert from "node:assert/strict";
import { crc16CcittFalse } from "../docs/crc16.js";
import { ImageAssembler } from "../docs/image_assembler.js";
import {
  PACKET_TYPE_DATA,
  PACKET_TYPE_END,
  PACKET_TYPE_PARITY,
  PACKET_TYPE_START,
} from "../docs/packet.js";

const payloadSize = 4;
const image = new Uint8Array([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const data = [
  image.slice(0, 4),
  image.slice(4, 8),
  image.slice(8),
];
const total = data.length + 3;
const parity = new Uint8Array(payloadSize);
for (const payload of data) {
  payload.forEach((byte, index) => {
    parity[index] ^= byte;
  });
}

function startPacket() {
  const payload = new Uint8Array(11);
  const view = new DataView(payload.buffer);
  payload[0] = 1;
  view.setUint16(1, 7, true);
  view.setUint32(3, image.length, true);
  view.setUint16(7, crc16CcittFalse(image), true);
  view.setUint16(9, payloadSize, true);
  return { type: PACKET_TYPE_START, seq: 0, total, payload };
}

function packet(type, seq, payload = new Uint8Array(0)) {
  return { type, seq, total, payload };
}

const missingTwo = new ImageAssembler();
missingTwo.accept(startPacket());
missingTwo.accept(packet(PACKET_TYPE_DATA, 1, data[0]));
missingTwo.accept(packet(PACKET_TYPE_PARITY, data.length + 1, parity));
missingTwo.accept(packet(PACKET_TYPE_END, total - 1));

const partialTwo = missingTwo.finalizePartial();
assert.equal(partialTwo.image.length, image.length);
assert.equal(partialTwo.missingSeqs.length, 2);
assert.equal(partialTwo.crcOk, false);
assert.equal(partialTwo.receivedCount, 1);

let offset = 0;
for (let seq = 1; seq <= data.length; seq++) {
  const length = seq < data.length ? payloadSize : image.length - (data.length - 1) * payloadSize;
  if (partialTwo.missingSeqs.includes(seq)) {
    for (let i = 0; i < length; i++) {
      assert.equal(partialTwo.image[offset + i], 0);
    }
  }
  offset += length;
}

const recoveredOne = new ImageAssembler();
recoveredOne.accept(startPacket());
recoveredOne.accept(packet(PACKET_TYPE_DATA, 2, data[1]));
recoveredOne.accept(packet(PACKET_TYPE_DATA, 3, data[2]));
recoveredOne.accept(packet(PACKET_TYPE_PARITY, data.length + 1, parity));
recoveredOne.accept(packet(PACKET_TYPE_END, total - 1));

const partialOne = recoveredOne.finalizePartial();
assert.deepEqual(partialOne.image, image);
assert.deepEqual(partialOne.missingSeqs, []);
assert.equal(partialOne.recoveredSeq, 1);
assert.equal(partialOne.crcOk, true);
assert.deepEqual(recoveredOne.finalize().image, image);

const empty = new ImageAssembler();
empty.accept(startPacket());
empty.accept(packet(PACKET_TYPE_PARITY, data.length + 1, parity));
empty.accept(packet(PACKET_TYPE_END, total - 1));
const partialEmpty = empty.finalizePartial();
assert.equal(partialEmpty.receivedCount, 0);

const summary = recoveredOne.getReceptionSummary();
assert.equal(summary?.receivedCount, 2);
assert.equal(summary?.dataPacketCount, 3);
assert.deepEqual(summary?.missingSeqs, [1]);

console.log("PASS: partial image assembler");
