import * as assert from 'assert';
import * as path from 'path';
import { BLFReader, CANMessage } from '../blf-parser';

const FIXTURE = path.resolve(__dirname, '../../src/test/fixtures/two-channel.blf');

suite('BLFReader integration (two-channel.blf)', () => {
  let messages: CANMessage[];
  let reader: BLFReader;

  suiteSetup(async () => {
    reader = new BLFReader(FIXTURE);
    messages = await reader.parse();
  });

  test('parses all 204 messages without errors', () => {
    assert.strictEqual(messages.length, 204);
    assert.deepStrictEqual(reader.getErrors(), []);
  });

  test('reads the LOGG file header with UTC timestamps', () => {
    const header = reader.getHeader();
    assert.ok(header);
    assert.strictEqual(header.signature, 'LOGG');
    assert.ok(isFinite(header.startTimestamp) && header.startTimestamp > 0);
  });

  test('converts 1-based file channels to 0-based', () => {
    const channels = [...new Set(messages.map(m => m.channel))].sort();
    assert.deepStrictEqual(channels, [0, 1]);
  });

  test('parses CAN FD messages with DLC 9 → 12 data bytes', () => {
    const fd = messages.filter(m => m.isFd);
    assert.strictEqual(fd.length, 4);
    for (const m of fd) {
      assert.strictEqual(m.dlc, 9);
      assert.strictEqual(m.data.length, 12);
      assert.strictEqual(m.bitrateSwitch, true);
    }
  });

  test('parses UDS request frames as TX', () => {
    const reqs = messages.filter(m => m.arbitrationId === 0x7e0);
    assert.strictEqual(reqs.length, 5);
    for (const m of reqs) {
      assert.strictEqual(m.isRx, false);
    }
  });

  test('relative timestamps grow with absolute timestamps', () => {
    const first = messages[0];
    const header = reader.getHeader()!;
    assert.ok(Math.abs(first.absoluteTimestamp - (header.startTimestamp + first.relativeTimestamp)) < 1e-9);
  });
});

suite('parseCANMessage flags', () => {
  test('masks extended-id bit and sets isExtendedId', () => {
    const m = parseCanMessage({ canId: 0x18fedcba | 0x80000000 });
    assert.strictEqual(m.arbitrationId, 0x18fedcba);
    assert.strictEqual(m.isExtendedId, true);
  });

  test('standard id has no extended flag', () => {
    const m = parseCanMessage({ canId: 0x100 });
    assert.strictEqual(m.arbitrationId, 0x100);
    assert.strictEqual(m.isExtendedId, false);
  });

  test('DIR bit 0 set means TX', () => {
    assert.strictEqual(parseCanMessage({ flags: 0x01 }).isRx, false);
    assert.strictEqual(parseCanMessage({ flags: 0x00 }).isRx, true);
  });

  test('remote frame flag 0x10', () => {
    assert.strictEqual(parseCanMessage({ flags: 0x10 }).isRemoteFrame, true);
  });

  test('channel converts 1-based to 0-based', () => {
    assert.strictEqual(parseCanMessage({ channel: 2 }).channel, 1);
    assert.strictEqual(parseCanMessage({ channel: 0 }).channel, 0); // defensive: never negative
  });
});

suite('parseObjectTimestamp resolution flag', () => {
  test('nanosecond resolution by default, 10 µs with flag', () => {
    // flags=0 → ns: 1.5e9 ns = 1.5 s
    assert.strictEqual(parseTimestamp(0, 1_500_000_000n), 1.5);
    // flags=1 (TEN_MICS) → 123456 * 10 µs = 1.23456 s
    assert.ok(Math.abs(parseTimestamp(1, 123_456n) - 1.23456) < 1e-12);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCanMessage(opts: { canId?: number; flags?: number; channel?: number }): CANMessage {
  const headerSize = 32;
  const buffer = Buffer.alloc(headerSize + 16, 0);
  let pos = headerSize;
  buffer.writeUInt16LE(opts.channel ?? 1, pos); pos += 2;
  buffer.writeUInt8(opts.flags ?? 0, pos); pos += 1;
  buffer.writeUInt8(8, pos); pos += 1;
  buffer.writeUInt32LE((opts.canId ?? 0x100) >>> 0, pos); pos += 4;

  const reader = new BLFReader('');
  const parser = (reader as unknown as {
    parseCANMessage(buffer: Buffer, header: object, relTs: number, absTs: number): CANMessage | null;
  }).parseCANMessage.bind(reader);
  const msg = parser(buffer, {
    signature: 'LOBJ',
    headerSize,
    headerVersion: 1,
    objectSize: buffer.length,
    objectType: 1,
  }, 0, 0);

  assert.ok(msg);
  return msg;
}

function parseTimestamp(flags: number, tsRaw: bigint): number {
  // OBJ_HEADER_BASE(16) + flags(4) + clientIndex(2) + objectVersion(2) + timestamp(8)
  const buffer = Buffer.alloc(32, 0);
  buffer.writeUInt32LE(flags, 16);
  buffer.writeBigUInt64LE(tsRaw, 24);

  const reader = new BLFReader('');
  return (reader as unknown as {
    parseObjectTimestamp(buffer: Buffer, offset: number): number;
  }).parseObjectTimestamp.call(reader, buffer, 0);
}
