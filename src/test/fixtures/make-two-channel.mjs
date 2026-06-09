/**
 * Generates src/test/fixtures/two-channel.blf  +  two-channel.dbc
 *
 * Demo fixture for screenshots and integration tests. 204 messages across a
 * 2-second simulated drive on two channels:
 *
 *  ch0 (file ch=1):
 *    0x100  EngineStatus        40 msgs  @  50 ms  RX STD
 *    0x200  TransmissionData    10 msgs  @ 200 ms  RX STD
 *    0x300  BrakeSystem        100 msgs  @  20 ms  RX STD
 *    0x600  BatteryStatus        4 msgs  @ 500 ms  RX FD   (DLC 9 → 12 bytes)
 *    0x7E0  Tester_ECU1_Req      5 msgs  (TX, UDS)
 *
 *  ch1 (file ch=2):
 *    0x100  EngineStatus        40 msgs  @  50 ms  RX STD
 *    0x7E8  ECU1_Response        5 msgs  (RX, UDS)
 *
 * Screenshot demos:
 *   • No filter      → "204 rows"
 *   • Filter ID=100  → "80 rows" (both channels)
 *   • Filter ID=7E   → "10 rows" (5 UDS req + 5 resp)
 *   • Search data "22 F1 90" → 3 hits, counter "1/3" → "2/3" → "3/3"
 *   • Load DBC → EngineSpeed (rpm), GearPosition (Park/Neutral/Drive), SoC (%)
 *
 * Run:  node src/test/fixtures/make-two-channel.mjs
 */

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── BLF layout constants ───────────────────────────────────────────────────────

const FILE_HEADER_SIZE     = 144;
const OBJ_HEADER_BASE_SIZE = 16;
// V1 extra: flags(4)+clientIndex(2)+objectVersion(2)+timestamp(8) = 16 bytes
const FULL_OBJ_HDR         = OBJ_HEADER_BASE_SIZE + 16; // = 32
const CONTAINER_INNER_HDR  = 16; // method(2)+reserved(6)+uncompSize(4)+reserved(4)

// CAN_MESSAGE payload: channel(2)+flags(1)+dlc(1)+canId(4)+data(8) = 16
const CAN_STD_PAYLOAD = 16;
const CAN_STD_OBJ_SIZE = FULL_OBJ_HDR + CAN_STD_PAYLOAD; // = 48

// CAN_FD_MESSAGE fixed fields before data:
// channel(2)+flags(1)+dlc(1)+id(4)+frameLen(4)+bitCount(4)+fdFlags(1)+validBytes(1)+pad(5) = 23
const CAN_FD_FIXED = 23;

function align4(n) { return Math.ceil(n / 4) * 4; }

// ── Object builders ────────────────────────────────────────────────────────────

/**
 * msg = { ch, id, tsNs, data[], tx?, ext? }
 * ch is 1-based (as stored in file). tx=false → RX (DIR bit 0 = 0).
 * DIR bit: const DIR = 0x1 in blf-parser.ts. REMOTE flag = 0x10.
 */
function makeCANMessage({ ch, id, tsNs, data, tx = false, ext = false }) {
  const buf = Buffer.alloc(CAN_STD_OBJ_SIZE, 0);
  // ── LOBJ base header (16 bytes) ──
  buf.write('LOBJ', 0, 'ascii');
  buf.writeUInt16LE(FULL_OBJ_HDR, 4);      // headerSize
  buf.writeUInt16LE(1, 6);                  // headerVersion = 1 (V1)
  buf.writeUInt32LE(CAN_STD_OBJ_SIZE, 8);  // objectSize
  buf.writeUInt32LE(1, 12);                 // objectType = CAN_MESSAGE
  // ── V1 header (16 bytes at offset 16) ──
  buf.writeUInt32LE(0, 16);                 // flags=0 → nanosecond resolution
  buf.writeUInt16LE(0, 20);                 // clientIndex
  buf.writeUInt16LE(0, 22);                 // objectVersion
  buf.writeBigUInt64LE(tsNs, 24);           // timestamp (ns from recording start)
  // ── CAN payload at offset 32 ──
  buf.writeUInt16LE(ch, 32);               // channel (1-based)
  buf.writeUInt8(tx ? 0x01 : 0x00, 34);   // msgFlags: bit0=DIR (1=TX, 0=RX)
  buf.writeUInt8(8, 35);                   // dlc
  buf.writeUInt32LE(ext ? (id | 0x80000000) : id, 36); // arb ID
  Buffer.from(data).copy(buf, 40);         // 8 data bytes
  return buf;
}

/**
 * CAN FD message (objectType=100). Uses CAN_FD_MESSAGE struct.
 * DLC 9 → 12 data bytes (per canFdDlcToLength table).
 * fdFlags: bit0=isFd(1), bit1=BRS, bit2=ESI.
 */
function makeCANFDMessage({ ch, id, tsNs, data, brs = true, ext = false }) {
  const dataLen  = data.length;
  const objSize  = FULL_OBJ_HDR + CAN_FD_FIXED + dataLen;
  const bufSize  = align4(objSize);
  const buf      = Buffer.alloc(bufSize, 0);
  // ── LOBJ base header ──
  buf.write('LOBJ', 0, 'ascii');
  buf.writeUInt16LE(FULL_OBJ_HDR, 4);
  buf.writeUInt16LE(1, 6);
  buf.writeUInt32LE(objSize, 8);   // actual size (parser adds alignment)
  buf.writeUInt32LE(100, 12);      // objectType = CAN_FD_MESSAGE
  // ── V1 header ──
  buf.writeUInt32LE(0, 16);
  buf.writeUInt16LE(0, 20);
  buf.writeUInt16LE(0, 22);
  buf.writeBigUInt64LE(tsNs, 24);
  // ── FD payload at offset 32 ──
  buf.writeUInt16LE(ch, 32);                                     // channel
  buf.writeUInt8(0x00, 34);                                      // msgFlags (RX)
  buf.writeUInt8(9, 35);                                         // dlc=9 → 12 bytes
  buf.writeUInt32LE(ext ? (id | 0x80000000) : id, 36);          // arb id
  buf.writeUInt32LE(0, 40);                                      // frameLen (unused)
  buf.writeUInt32LE(0, 44);                                      // bitCount  (unused)
  buf.writeUInt8(0x01 | (brs ? 0x02 : 0), 48);                  // fdFlags: FD + BRS
  buf.writeUInt8(dataLen, 49);                                   // validBytes
  // pad(5) at 50..54 already zero
  Buffer.from(data).copy(buf, 55);                               // data
  return buf;
}

function makeLogContainer(bufs) {
  const payload = Buffer.concat(bufs);
  const innerHdr = Buffer.alloc(CONTAINER_INNER_HDR, 0);
  innerHdr.writeUInt16LE(0, 0);               // method = NO_COMPRESSION
  innerHdr.writeUInt32LE(payload.length, 8);  // uncompressedSize

  const objSize = FULL_OBJ_HDR + CONTAINER_INNER_HDR + payload.length;
  const hdr = Buffer.alloc(FULL_OBJ_HDR, 0);
  hdr.write('LOBJ', 0, 'ascii');
  hdr.writeUInt16LE(FULL_OBJ_HDR, 4);
  hdr.writeUInt16LE(1, 6);
  hdr.writeUInt32LE(objSize, 8);
  hdr.writeUInt32LE(10, 12);                  // objectType = LOG_CONTAINER
  hdr.writeBigUInt64LE(0n, 24);
  return Buffer.concat([hdr, innerHdr, payload]);
}

/**
 * Windows SYSTEMTIME: [year, month, dayOfWeek, day, hour, min, sec, ms]
 * Recording start: 2024-06-10 08:00:00 UTC (Monday)
 */
function makeFileHeader(fileSize, objCount) {
  const buf = Buffer.alloc(FILE_HEADER_SIZE, 0);
  buf.write('LOGG', 0, 'ascii');
  buf.writeUInt32LE(FILE_HEADER_SIZE, 4);
  buf.writeBigUInt64LE(BigInt(fileSize), 16);
  buf.writeBigUInt64LE(BigInt(fileSize), 24);
  buf.writeUInt32LE(objCount, 28);
  // startTime 2024-06-10 08:00:00 UTC (Monday = dayOfWeek 1)
  [2024, 6, 1, 10, 8, 0, 0, 0].forEach((v, i) => buf.writeUInt16LE(v, 40 + i * 2));
  // stopTime  2024-06-10 08:00:02 UTC
  [2024, 6, 1, 10, 8, 0, 2, 0].forEach((v, i) => buf.writeUInt16LE(v, 56 + i * 2));
  return buf;
}

// ── Signal helpers ─────────────────────────────────────────────────────────────

/** LE uint16 → 2-byte array */
function u16le(v) { return [v & 0xFF, (v >> 8) & 0xFF]; }

/** signed LE int16 → 2-byte array */
function i16le(v) {
  const u = v < 0 ? v + 65536 : v;
  return [u & 0xFF, (u >> 8) & 0xFF];
}

// ── Message data generators ────────────────────────────────────────────────────

/**
 * 0x100 EngineStatus (DBC: EngineSpeed@0|16, CoolantTemp@16|8, EngineLoad@24|8, ThrottlePos@32|8)
 * RPM profile: idle 750 → ramp to 3200 by t=800ms → hold → taper to 1000 by t=2000ms
 */
function engineStatusData(tMs) {
  let rpm;
  if (tMs < 100)       { rpm = 750; }
  else if (tMs < 800)  { rpm = 750  + (3200 - 750)  * ((tMs - 100) / 700); }
  else if (tMs < 1200) { rpm = 3200; }
  else                 { rpm = 3200 - (3200 - 1000) * ((tMs - 1200) / 800); }
  rpm = Math.round(rpm);
  const rpmRaw   = rpm * 10;                        // factor 0.1 → raw = rpm/0.1
  const tempRaw  = 90 + 40;                         // 90°C, offset -40 → raw 130
  const loadRaw  = Math.round(Math.min(100, rpm / 16) / 0.5); // ~% load, factor 0.5
  const throttle = tMs < 800 ? Math.round((tMs / 800) * 60) : Math.round(60 - (tMs - 800) / 1200 * 50);
  const thrRaw   = Math.round(Math.max(0, throttle) / 0.4);
  return [...u16le(rpmRaw), tempRaw, loadRaw, thrRaw, 0x00, 0x00, 0x00];
}

/**
 * 0x200 TransmissionData (DBC: GearPosition@0|4, TransTemp@8|8, TorqueReq@16|8)
 * Gear: Park(0) → Neutral(1) at 200ms → Drive(2) at 400ms
 */
function transmissionData(tMs) {
  const gear = tMs < 200 ? 0 : tMs < 400 ? 1 : 2;
  const tempRaw   = 75 + 40;                        // 75°C, offset -40 → 115
  const torqueRaw = Math.round(Math.min(100, Math.max(0, (tMs / 2000) * 80)) / 0.5);
  return [gear & 0x0F, tempRaw, torqueRaw, 0x00, 0x00, 0x00, 0x00, 0x00];
}

/**
 * 0x300 BrakeSystem (DBC: BrakePressure@0|8, WheelSpeedFL@8|16, WheelSpeedFR@24|16)
 * Speed: 0 → 80 km/h by t=1000ms. Braking at t=200-300ms, 800-900ms, 1600-1700ms.
 */
function brakeSystemData(tMs) {
  const baseSpeed = Math.min(80, (tMs / 1000) * 80);
  const braking   = (tMs >= 200 && tMs < 320) || (tMs >= 800 && tMs < 920) || (tMs >= 1600 && tMs < 1720);
  const brakePsi  = braking ? Math.round(25 + Math.sin((tMs % 120) / 120 * Math.PI) * 15) : 0;
  const speed     = braking ? baseSpeed * 0.85 : baseSpeed;
  const speedRaw  = Math.round(speed * 100);        // factor 0.01 → raw = km/h / 0.01
  return [Math.round(brakePsi / 0.5), ...u16le(speedRaw), ...u16le(speedRaw), 0x00, 0x00];
}

/**
 * 0x600 BatteryStatus (CAN FD, 12 bytes)
 * DBC: BattVoltage@0|16, BattCurrent@16|16, StateOfCharge@32|8, BattTemp@40|8
 * Simulates a mild-hybrid: SoC 72→85%, regen during braking events.
 */
function batteryStatusData(idx) {
  const soc     = 72 + idx * 3;          // 72, 75, 78, 81 %
  const voltage = 400 + idx * 2;         // 400, 402, 404, 406 V
  const current = -150 + idx * 50;       // -150, -100, -50, 0 A (regen then idle)
  const temp    = 28 + idx;              // 28, 29, 30, 31 °C
  const voltRaw = Math.round(voltage / 0.01);
  const currRaw = Math.round(current / 0.1);
  const socRaw  = Math.round(soc / 0.4);
  const tempRaw = temp + 40;
  return [...u16le(voltRaw), ...i16le(currRaw), socRaw, tempRaw, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
}

// ── Message schedule ───────────────────────────────────────────────────────────

const allMsgs = [];

// 0x100 EngineStatus — ch0 and ch1, every 50ms (40 msgs each)
for (let t = 0; t < 2000; t += 50) {
  const tsBase = BigInt(t) * 1_000_000n;
  allMsgs.push({ ch: 1, id: 0x100, tsNs: tsBase,          data: engineStatusData(t)      });
  allMsgs.push({ ch: 2, id: 0x100, tsNs: tsBase + 2_000n, data: engineStatusData(t + 1)  }); // 2µs offset
}

// 0x200 TransmissionData — ch0, every 200ms (10 msgs)
for (let t = 0; t < 2000; t += 200) {
  allMsgs.push({ ch: 1, id: 0x200, tsNs: BigInt(t) * 1_000_000n + 5_000n, data: transmissionData(t) });
}

// 0x300 BrakeSystem — ch0, every 20ms (100 msgs)
for (let t = 0; t < 2000; t += 20) {
  allMsgs.push({ ch: 1, id: 0x300, tsNs: BigInt(t) * 1_000_000n + 10_000n, data: brakeSystemData(t) });
}

// 0x7E0 Tester_ECU1_Req — ch0, TX, 5 UDS requests
// Service 0x22 = ReadDataByIdentifier; DIDs: F190 (ECU serial ×3), F191 (SW ver), F186 (active session)
const udsRequests = [
  { tMs:  500, data: [0x22, 0xF1, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00] },
  { tMs:  700, data: [0x22, 0xF1, 0x91, 0x00, 0x00, 0x00, 0x00, 0x00] },
  { tMs:  900, data: [0x22, 0xF1, 0x86, 0x00, 0x00, 0x00, 0x00, 0x00] },
  { tMs: 1200, data: [0x22, 0xF1, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00] },
  { tMs: 1500, data: [0x22, 0xF1, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00] },
];
udsRequests.forEach(({ tMs, data }) => {
  allMsgs.push({ ch: 1, id: 0x7E0, tsNs: BigInt(tMs) * 1_000_000n, data, tx: true });
});

// 0x7E8 ECU1_Response — ch1, RX, responses 10ms after each request
// Service 0x62 = positive response to 0x22
const udsResponses = [
  { tMs:  510, data: [0x62, 0xF1, 0x90, 0x01, 0x23, 0x45, 0xAB, 0xCD] }, // serial: 0x012345ABCD
  { tMs:  710, data: [0x62, 0xF1, 0x91, 0x02, 0x00, 0x01, 0x00, 0x00] }, // SW 2.0.1
  { tMs:  910, data: [0x62, 0xF1, 0x86, 0x01, 0x00, 0x00, 0x00, 0x00] }, // session = Default (0x01)
  { tMs: 1210, data: [0x62, 0xF1, 0x90, 0x01, 0x23, 0x45, 0xAB, 0xCD] }, // serial again
  { tMs: 1510, data: [0x62, 0xF1, 0x90, 0x01, 0x23, 0x45, 0xAB, 0xCD] }, // serial again
];
udsResponses.forEach(({ tMs, data }) => {
  allMsgs.push({ ch: 2, id: 0x7E8, tsNs: BigInt(tMs) * 1_000_000n, data });
});

// 0x600 BatteryStatus — ch0, CAN FD (12 bytes), every 500ms (4 msgs)
const fdMsgs = [];
[300, 800, 1300, 1800].forEach((tMs, idx) => {
  fdMsgs.push(makeCANFDMessage({
    ch: 1, id: 0x600,
    tsNs: BigInt(tMs) * 1_000_000n + 15_000n,
    data: batteryStatusData(idx),
    brs: true,
  }));
});

// Sort all standard CAN messages by timestamp, then build buffers
allMsgs.sort((a, b) => (a.tsNs < b.tsNs ? -1 : a.tsNs > b.tsNs ? 1 : 0));
const stdBufs = allMsgs.map(makeCANMessage);

// Interleave FD messages into sorted order (insert at correct timestamp positions)
// Simple approach: concatenate std + fd then let parser handle by LOBJ scan
const containerPayload = Buffer.concat([...stdBufs, ...fdMsgs]);

const containerBuf = makeLogContainer([containerPayload]);
const fileSize = FILE_HEADER_SIZE + containerBuf.length;
const fileBuf  = Buffer.concat([makeFileHeader(fileSize, 1), containerBuf]);

const blfPath = join(__dir, 'two-channel.blf');
writeFileSync(blfPath, fileBuf);
console.log(`two-channel.blf written (${fileBuf.length} bytes, ${allMsgs.length + fdMsgs.length} messages)`);

// ── DBC ───────────────────────────────────────────────────────────────────────

const DBC = `\
VERSION ""

NS_ :

BS_:

BU_: ECU1 TCU BRK BMS TESTER

BO_ 256 EngineStatus: 8 ECU1
 SG_ EngineSpeed  : 0|16@1+ (0.1,0)    [0|6553.5]  "rpm"  TESTER
 SG_ CoolantTemp  : 16|8@1+  (1,-40)   [-40|215]   "degC" TESTER
 SG_ EngineLoad   : 24|8@1+  (0.5,0)   [0|127.5]   "%"    TESTER
 SG_ ThrottlePos  : 32|8@1+  (0.4,0)   [0|100]     "%"    TESTER

BO_ 512 TransmissionData: 8 TCU
 SG_ GearPosition : 0|4@1+   (1,0)     [0|15]      ""     TESTER
 SG_ TransTemp    : 8|8@1+   (1,-40)   [-40|215]   "degC" TESTER
 SG_ TorqueReq    : 16|8@1+  (0.5,0)   [0|127.5]   "%"    TESTER

BO_ 768 BrakeSystem: 8 BRK
 SG_ BrakePressure : 0|8@1+  (0.5,0)   [0|127.5]   "bar"  TESTER
 SG_ WheelSpeedFL  : 8|16@1+ (0.01,0)  [0|655.35]  "km/h" TESTER
 SG_ WheelSpeedFR  : 24|16@1+(0.01,0)  [0|655.35]  "km/h" TESTER

BO_ 1536 BatteryStatus: 8 BMS
 SG_ BattVoltage   : 0|16@1+ (0.01,0)  [0|655.35]  "V"    TESTER
 SG_ BattCurrent   : 16|16@1-(0.1,0)   [-3276.8|3276.7] "A" TESTER
 SG_ StateOfCharge : 32|8@1+ (0.4,0)   [0|100]     "%"    TESTER
 SG_ BattTemp      : 40|8@1+ (1,-40)   [-40|215]   "degC" TESTER

BO_ 2016 Tester_ECU1_Req: 8 TESTER
 SG_ ServiceID    : 0|8@1+   (1,0)     [0|255]     ""     ECU1
 SG_ DataIdentHi  : 8|8@1+   (1,0)     [0|255]     ""     ECU1
 SG_ DataIdentLo  : 16|8@1+  (1,0)     [0|255]     ""     ECU1

BO_ 2024 ECU1_Response: 8 ECU1
 SG_ ResponseSID  : 0|8@1+   (1,0)     [0|255]     ""     TESTER
 SG_ RespIdentHi  : 8|8@1+   (1,0)     [0|255]     ""     TESTER
 SG_ RespIdentLo  : 16|8@1+  (1,0)     [0|255]     ""     TESTER

VAL_ 512 GearPosition
  0 "Park"
  1 "Neutral"
  2 "Drive"
  3 "Reverse"
  4 "1st"
  5 "2nd"
  6 "3rd"
  7 "4th" ;

CM_ BO_ 256  "Engine management ECU — 50 ms broadcast";
CM_ BO_ 512  "Transmission control unit — 200 ms broadcast";
CM_ BO_ 768  "Brake control module — 20 ms broadcast";
CM_ BO_ 1536 "Battery management system — 500 ms CAN FD broadcast";
CM_ BO_ 2016 "Tester to ECU1 UDS request (ISO 14229 service 0x22 ReadDataByIdentifier)";
CM_ BO_ 2024 "ECU1 to tester UDS positive response (service 0x62)";
CM_ SG_ 256 EngineSpeed  "Crankshaft speed in revolutions per minute";
CM_ SG_ 512 GearPosition "Current selected gear; see VAL_ for enum labels";
CM_ SG_ 1536 StateOfCharge "High-voltage battery state of charge";

`;

const dbcPath = join(__dir, 'two-channel.dbc');
writeFileSync(dbcPath, DBC);
console.log('two-channel.dbc written');
console.log();
console.log('Screenshot demos:');
console.log('  Filter ID = 100            → 80 rows (ch0 + ch1 EngineStatus)');
console.log('  Filter ID = 7E             → 10 rows (UDS req + resp)');
console.log('  Search data = "22 F1 90"   → 3 hits ("1 / 3" → "2 / 3" → "3 / 3")');
console.log('  Load two-channel.dbc       → EngineSpeed, GearPosition (Park/Drive), SoC %');
