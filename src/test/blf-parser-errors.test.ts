import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { BLFReader } from '../blf-parser';

function writeTemp(name: string, buf: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blf-test-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
}

// 144-byte LOGG header. Caller patches fileSize AFTER the full file buffer is
// built (bytes 16..23); SYSTEMTIME start = 2024-01-01 00:00:00 UTC.
function fileHeader(): Buffer {
  const b = Buffer.alloc(144, 0);
  b.write('LOGG', 0, 'ascii');
  b.writeUInt32LE(144, 4);
  // start = 2024-01-01 00:00:00 UTC; stop = same, so no bounds warning fires.
  for (const at of [40, 56]) {
    b.writeUInt16LE(2024, at); b.writeUInt16LE(1, at + 2);
    b.writeUInt16LE(1, at + 4);    b.writeUInt16LE(1, at + 6);
  }
  return b;
}

function objHeader(objectSize: number, objectType: number, headerSize = 16): Buffer {
  const b = Buffer.alloc(16, 0);
  b.write('LOBJ', 0, 'ascii');
  b.writeUInt16LE(headerSize, 4);
  b.writeUInt16LE(1, 6);
  b.writeUInt32LE(objectSize, 8);
  b.writeUInt32LE(objectType, 12);
  return b;
}

// Uncompressed (method 0) LOG_CONTAINER wrapping one inner object.
function containerObj(inner: Buffer): Buffer {
  const body = Buffer.alloc(16, 0);
  body.writeUInt16LE(0, 0);                 // NO_COMPRESSION
  body.writeUInt32LE(inner.length, 8);      // uncompressed size
  return Buffer.concat([objHeader(16 + 16 + inner.length, 10), body, inner]);
}

// Classic CAN_MESSAGE body (16 bytes) inside a 32-byte-header object.
// The 16 zero bytes after the base header simulate the V1 object header
// (flags=0 → nanosecond resolution, timestamp 0); headerSize=32 tells
// parseCANMessage where the body starts.
function canMessageObj(objectType: number, canId = 0x100): Buffer {
  const body = Buffer.alloc(16, 0);
  body.writeUInt16LE(1, 0);                 // channel 1 → 0-based 0
  body.writeUInt8(8, 3);                    // dlc
  body.writeUInt32LE(canId, 4);
  return Buffer.concat([objHeader(16 + 16 + 16, objectType, 32), Buffer.alloc(16, 0), body]);
}

function fullFile(...parts: Buffer[]): Buffer {
  const buf = Buffer.concat([fileHeader(), ...parts]);
  buf.writeBigUInt64LE(BigInt(buf.length), 16);  // truthful fileSize
  return buf;
}

const FIXTURE = path.resolve(__dirname, '../../src/test/fixtures/two-channel.blf');

suite('BLFReader header and object bounds', () => {
  test('short file rejects', async () => {
    const p = writeTemp('short.blf', Buffer.alloc(10));
    const reader = new BLFReader(p);
    await assert.rejects(reader.parse(), /Invalid BLF file header/);
  });

  test('wrong signature rejects and records', async () => {
    const b = Buffer.alloc(144, 0);
    b.write('XXXX', 0, 'ascii');
    const p = writeTemp('bad-sig.blf', b);
    const reader = new BLFReader(p);
    await assert.rejects(reader.parse(), /Invalid BLF file header/);
    assert.match(reader.getErrors().join('\n'), /Invalid file signature/);
  });

  test('fileSize mismatch warns but still parses', async () => {
    const buf = fullFile(containerObj(canMessageObj(1)));
    buf.writeBigUInt64LE(BigInt(buf.length + 1000), 16);
    const p = writeTemp('size-mismatch.blf', buf);
    const reader = new BLFReader(p);
    const messages = await reader.parse();
    assert.strictEqual(messages.length, 1);
    assert.match(reader.getErrors().join('\n'), /File size mismatch/);
  });

  test('invalid start SYSTEMTIME warns', async () => {
    const buf = fullFile(containerObj(canMessageObj(1)));
    buf.writeUInt16LE(13, 42);
    buf.writeBigUInt64LE(BigInt(buf.length), 16);
    const p = writeTemp('bad-systime.blf', buf);
    const reader = new BLFReader(p);
    const messages = await reader.parse();
    assert.strictEqual(messages.length, 1);
    assert.match(reader.getErrors().join('\n'), /SYSTEMTIME/);
    // Month 13 must not roll over into January of the next year.
    assert.strictEqual(reader.getHeader()?.startTimestamp, 0);
    assert.strictEqual(messages[0].absoluteTimestamp, 0);
  });

  test('truncated tail object terminates', async () => {
    const buf = Buffer.concat([fileHeader(), objHeader(0xFFFFFF00, 10), Buffer.alloc(16, 0)]);
    const p = writeTemp('truncated.blf', buf);
    const reader = new BLFReader(p);
    const messages = await reader.parse();
    assert.deepStrictEqual(messages, []);
  });

  test('headerSize > objectSize rejected', () => {
    const b = Buffer.alloc(16, 0);
    b.write('LOBJ', 0, 'ascii');
    b.writeUInt16LE(64, 4);
    b.writeUInt16LE(1, 6);
    b.writeUInt32LE(32, 8);
    b.writeUInt32LE(1, 12);
    const reader = new BLFReader('dummy');
    const result = (reader as unknown as { parseObjectHeader(buffer: Buffer, offset: number): object | null }).parseObjectHeader.call(reader, b, 0);
    assert.strictEqual(result, null);
  });

  test('valid fixture parses 204 messages with zero errors', async () => {
    const reader = new BLFReader(FIXTURE);
    const messages = await reader.parse();
    assert.strictEqual(messages.length, 204);
    assert.deepStrictEqual(reader.getErrors(), []);
  });
});

// ZLIB_DEFLATE (method 2) LOG_CONTAINER whose compressed body is `compressed`
// and which reports `uncompressedSize` in its header.
function containerObjZlib(compressed: Buffer, uncompressedSize: number): Buffer {
  const body = Buffer.alloc(16, 0);
  body.writeUInt16LE(2, 0);                    // ZLIB_DEFLATE
  body.writeUInt32LE(uncompressedSize, 8);     // uncompressed size
  return Buffer.concat([objHeader(16 + 16 + compressed.length, 10), body, compressed]);
}

suite('decompression output cap', () => {
  // 64 KiB of zeros compresses to ~a hundred bytes and contains no LOBJ
  // markers, so a container holding it parses to zero messages.
  const bombPayload = zlib.deflateSync(Buffer.alloc(64 * 1024));

  test('container above the cap is rejected, not allocated', async () => {
    const buf = fullFile(containerObjZlib(bombPayload, 64 * 1024));
    const p = writeTemp('bomb.blf', buf);
    const reader = new BLFReader(p, { maxContainerBytes: 1024 });
    const messages = await reader.parse();
    assert.deepStrictEqual(messages, []);
    assert.match(reader.getErrors().join('\n'), /Container parse error/);
  });

  test('same payload under the default cap parses without errors', async () => {
    const buf = fullFile(containerObjZlib(bombPayload, 64 * 1024));
    const p = writeTemp('bomb-ok.blf', buf);
    const reader = new BLFReader(p);
    const messages = await reader.parse();
    assert.deepStrictEqual(messages, []);
    assert.deepStrictEqual(reader.getErrors(), []);
  });

  test('default cap does not affect the valid fixture', async () => {
    const reader = new BLFReader(FIXTURE);
    const messages = await reader.parse();
    assert.strictEqual(messages.length, 204);
  });
});
