/**
 * Generates src/test/fixtures/two-channel.blf
 *
 * Contains 6 CAN messages on two channels:
 *   ch0 (file stores as 1): IDs 0x100, 0x200, 0x300
 *   ch1 (file stores as 2): IDs 0x100, 0x400, 0x500
 *
 * ID 0x100 is intentionally present on both channels to exercise id@channel filtering.
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Layout constants ──────────────────────────────────────────────────────────

const FILE_HEADER_SIZE     = 144;
const OBJ_HEADER_BASE_SIZE = 16;
const V1_HEADER_SIZE       = 16; // flags(4)+clientIndex(2)+objectVersion(2)+timestamp(8)
const FULL_OBJ_HDR         = OBJ_HEADER_BASE_SIZE + V1_HEADER_SIZE; // 32
const CAN_PAYLOAD_SIZE     = 16; // channel(2)+flags(1)+dlc(1)+canId(4)+data(8)
const CAN_MSG_OBJ_SIZE     = FULL_OBJ_HDR + CAN_PAYLOAD_SIZE;       // 48
const CONTAINER_INNER_HDR  = 16; // method(2)+reserved(6)+uncompSize(4)+reserved(4)

// ── Messages ──────────────────────────────────────────────────────────────────
// ch is 1-based (as stored in file); parser converts to 0-based on read.

const messages = [
  { ch: 1, id: 0x100, tsNs:  100_000_000n, data: [0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08] },
  { ch: 2, id: 0x100, tsNs:  200_000_000n, data: [0x11,0x12,0x13,0x14,0x15,0x16,0x17,0x18] },
  { ch: 1, id: 0x200, tsNs:  300_000_000n, data: [0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28] },
  { ch: 2, id: 0x400, tsNs:  400_000_000n, data: [0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48] },
  { ch: 1, id: 0x300, tsNs:  500_000_000n, data: [0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38] },
  { ch: 2, id: 0x500, tsNs:  600_000_000n, data: [0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58] },
];

// ── Builders ──────────────────────────────────────────────────────────────────

function makeCANMessage({ ch, id, tsNs, data }) {
  const buf = Buffer.alloc(CAN_MSG_OBJ_SIZE, 0);
  buf.write('LOBJ', 0, 'ascii');
  buf.writeUInt16LE(FULL_OBJ_HDR, 4);       // headerSize = 28
  buf.writeUInt16LE(1, 6);                   // headerVersion = 1 (V1)
  buf.writeUInt32LE(CAN_MSG_OBJ_SIZE, 8);   // objectSize = 44
  buf.writeUInt32LE(1, 12);                  // objectType = CAN_MESSAGE
  // V1 header: flags=0 (nanosecond resolution), clientIndex=0, objectVersion=0
  buf.writeUInt32LE(0, 16);
  buf.writeUInt16LE(0, 20);
  buf.writeUInt16LE(0, 22);
  buf.writeBigUInt64LE(tsNs, 24);            // timestamp in nanoseconds
  // CAN payload at offset 32 (= FULL_OBJ_HDR)
  buf.writeUInt16LE(ch, 32);                 // channel (1-based)
  buf.writeUInt8(0x00, 34);                  // msgFlags: bit0(DIR)=0 → RX
  buf.writeUInt8(8, 35);                     // dlc = 8
  buf.writeUInt32LE(id, 36);                 // arbitration ID (no ext bit)
  Buffer.from(data).copy(buf, 40);           // data
  return buf;
}

function makeLogContainer(canMsgBufs) {
  const payload = Buffer.concat(canMsgBufs);
  const innerHdr = Buffer.alloc(CONTAINER_INNER_HDR, 0);
  innerHdr.writeUInt16LE(0, 0);              // method = 0 (NO_COMPRESSION)
  innerHdr.writeUInt32LE(payload.length, 8); // uncompressedSize

  const objSize = FULL_OBJ_HDR + CONTAINER_INNER_HDR + payload.length;
  const hdr = Buffer.alloc(FULL_OBJ_HDR, 0);
  hdr.write('LOBJ', 0, 'ascii');
  hdr.writeUInt16LE(FULL_OBJ_HDR, 4);       // headerSize = 28
  hdr.writeUInt16LE(1, 6);                   // headerVersion = 1
  hdr.writeUInt32LE(objSize, 8);             // objectSize
  hdr.writeUInt32LE(10, 12);                 // objectType = LOG_CONTAINER
  // V1 header all zeros
  hdr.writeBigUInt64LE(0n, 24);
  return Buffer.concat([hdr, innerHdr, payload]);
}

function makeFileHeader(fileSize) {
  const buf = Buffer.alloc(FILE_HEADER_SIZE, 0);
  buf.write('LOGG', 0, 'ascii');
  buf.writeUInt32LE(FILE_HEADER_SIZE, 4);    // headerSize
  // app bytes (8) stay zero
  buf.writeBigUInt64LE(BigInt(fileSize), 16); // fileSize
  buf.writeBigUInt64LE(BigInt(fileSize), 24); // uncompressedSize
  buf.writeUInt32LE(1, 28);                   // objectCount (1 container)
  // startTime [year,month,dow,day,hour,min,sec,ms] at offset 40
  const st = [2024, 1, 1, 15, 8, 0, 0, 0];
  st.forEach((v, i) => buf.writeUInt16LE(v, 40 + i * 2));
  // stopTime at offset 56
  const et = [2024, 1, 1, 15, 8, 1, 0, 0];
  et.forEach((v, i) => buf.writeUInt16LE(v, 56 + i * 2));
  return buf;
}

// ── Assemble & write ──────────────────────────────────────────────────────────

const containerBuf = makeLogContainer(messages.map(makeCANMessage));
const fileSize = FILE_HEADER_SIZE + containerBuf.length;
const fileBuf  = Buffer.concat([makeFileHeader(fileSize), containerBuf]);

const outPath = join(__dir, 'two-channel.blf');
writeFileSync(outPath, fileBuf);

console.log(`two-channel.blf written (${fileBuf.length} bytes)`);
console.log('  ch0: IDs 0x100, 0x200, 0x300');
console.log('  ch1: IDs 0x100, 0x400, 0x500');
