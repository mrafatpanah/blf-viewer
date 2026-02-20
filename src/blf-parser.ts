// Core BLF parsing structures and types
import * as zlib from 'zlib';
import * as fs from 'fs';

// Type definitions
type TSystemTime = [number, number, number, number, number, number, number, number];

// Constants
const FILE_HEADER_SIZE = 144;
const OBJ_HEADER_BASE_SIZE = 16;

// Object type constants
const CAN_MESSAGE = 1;
const LOG_CONTAINER = 10;
const CAN_ERROR_EXT = 73;
const CAN_MESSAGE2 = 86;
const GLOBAL_MARKER = 96;
const CAN_FD_MESSAGE = 100;
const CAN_FD_MESSAGE_64 = 101;

// Compression methods
const NO_COMPRESSION = 0;
const ZLIB_DEFLATE = 2;

// Flags
const CAN_MSG_EXT = 0x80000000;
const REMOTE_FLAG = 0x10;
const EDL = 0x1000;
const BRS = 0x2000;
const ESI = 0x4000;
const DIR = 0x1;

// OBJ header flags for time resolution
const TIMESTAMP_FLAG_TEN_MICS = 0x1; // if set: 10 microseconds, else: nanoseconds

// Interfaces
export interface FileHeader {
  signature: string;
  headerSize: number;
  fileSize: number;
  uncompressedSize: number;
  objectCount: number;
  startTimestamp: number;  // Unix epoch seconds (UTC)
  stopTimestamp: number;
}

interface ObjHeaderBase {
  signature: string;
  headerSize: number;
  headerVersion: number;
  objectSize: number;
  objectType: number;
}

export interface CANMessage {
  // Relative timestamp from start of recording in seconds
  relativeTimestamp: number;
  // Absolute UTC timestamp (Unix epoch seconds)
  absoluteTimestamp: number;
  arbitrationId: number;
  isExtendedId: boolean;
  isRemoteFrame: boolean;
  isRx: boolean;
  dlc: number;
  isErrorFrame?: boolean;
  data: Buffer;
  channel: number;
  isFd?: boolean;
  bitrateSwitch?: boolean;
  errorStateIndicator?: boolean;
}

// Binary parsing utilities
class BinaryReader {
  private buffer: Buffer;
  private offset: number = 0;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  readBytes(count: number): Buffer {
    const result = this.buffer.slice(this.offset, this.offset + count);
    this.offset += count;
    return result;
  }

  readUInt8(): number {
    const result = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return result;
  }

  readUInt16LE(): number {
    const result = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return result;
  }

  readUInt32LE(): number {
    const result = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return result;
  }

  readUInt64LE(): bigint {
    const result = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return result;
  }

  readInt64LE(): bigint {
    const result = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return result;
  }

  skip(count: number): void {
    this.offset += count;
  }

  seek(position: number): void {
    this.offset = position;
  }

  getOffset(): number {
    return this.offset;
  }

  remaining(): number {
    return this.buffer.length - this.offset;
  }
}

/**
 * Convert a SYSTEMTIME structure (Windows format) to a Unix epoch seconds timestamp.
 * BLF files store times in UTC (Windows SYSTEMTIME is UTC).
 * [year, month, dayOfWeek, day, hour, minute, second, milliseconds]
 */
function systemTimeToTimestamp(st: TSystemTime): number {
  const [year, month, , day, hour, minute, second, millisecond] = st;
  // Use Date.UTC to avoid local timezone offset issues
  try {
    const ms = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    return ms / 1000;
  } catch {
    return 0;
  }
}

// BLF Reader class
export class BLFReader {
  private filePath: string;
  private header: FileHeader | null = null;
  private messages: CANMessage[] = [];
  private parseErrors: string[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async parse(): Promise<CANMessage[]> {
    try {
      const fileBuffer = fs.readFileSync(this.filePath);

      // Parse file header
      this.header = this.parseFileHeader(fileBuffer);
      if (!this.header) {
        throw new Error('Invalid BLF file header');
      }

      // Parse containers and objects starting after the file header
      let offset = this.header.headerSize;

      while (offset < fileBuffer.length) {
        const remaining = fileBuffer.length - offset;
        if (remaining < OBJ_HEADER_BASE_SIZE) break;

        const container = this.parseObjectHeader(fileBuffer, offset);
        if (!container) {
          // Try to advance and find next LOBJ
          const nextLobj = fileBuffer.indexOf(Buffer.from('LOBJ'), offset + 1);
          if (nextLobj === -1) break;
          offset = nextLobj;
          continue;
        }

        if (container.objectType === LOG_CONTAINER) {
          const containerData = fileBuffer.slice(
            offset + container.headerSize,
            offset + container.objectSize
          );
          const messages = await this.parseContainer(containerData);
          this.messages.push(...messages);
        }

        // Advance by object size, aligned to 4 bytes
        let nextOffset = offset + container.objectSize;
        const pad = (4 - (nextOffset % 4)) % 4;
        nextOffset += pad;

        if (nextOffset <= offset) {
          // Safety: avoid infinite loop
          nextOffset = offset + 4;
        }
        offset = nextOffset;
      }

      return this.messages;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.parseErrors.push(`Parse error: ${errorMsg}`);
      throw error;
    }
  }

  private parseFileHeader(buffer: Buffer): FileHeader | null {
    if (buffer.length < FILE_HEADER_SIZE) return null;

    const reader = new BinaryReader(buffer);
    const signature = reader.readBytes(4).toString('ascii');

    if (signature !== 'LOGG') {
      this.parseErrors.push('Invalid file signature, expected "LOGG"');
      return null;
    }

    const headerSize = reader.readUInt32LE();
    reader.skip(4); // app info (4 bytes: appId, major, minor, build are single bytes — skip as uint32)
    reader.skip(4); // more app bytes
    reader.skip(4); // binlog info
    // Actually the struct is: 4s L B B B B B B B B Q Q L L 8H 8H
    // After signature(4) + headerSize(4) = 8 bytes
    // Then 4 bytes app (appId + appMaj + appMin + appBuild) + 4 bytes binlog (maj+min+build+patch) = 8 bytes
    // Total so far = 16 bytes
    // Then fileSize(8) + uncompressedSize(8) + objectCount(4) + objectsRead(4) = 24 bytes
    // Total = 40 bytes before timestamps

    // Let's re-read from scratch to be precise:
    const r2 = new BinaryReader(buffer);
    r2.skip(4); // signature
    const hdrSize = r2.readUInt32LE(); // header size
    r2.skip(8); // app id + versions (8 bytes)
    const fileSize = Number(r2.readUInt64LE());
    const uncompressedSize = Number(r2.readUInt64LE());
    const objectCount = r2.readUInt32LE();
    r2.skip(4); // objects read

    // Parse start time (SYSTEMTIME: 8 x uint16 = 16 bytes)
    const startTime: TSystemTime = [
      r2.readUInt16LE(), // year
      r2.readUInt16LE(), // month
      r2.readUInt16LE(), // day of week
      r2.readUInt16LE(), // day
      r2.readUInt16LE(), // hour
      r2.readUInt16LE(), // minute
      r2.readUInt16LE(), // second
      r2.readUInt16LE(), // millisecond
    ];

    // Parse stop time
    const stopTime: TSystemTime = [
      r2.readUInt16LE(),
      r2.readUInt16LE(),
      r2.readUInt16LE(),
      r2.readUInt16LE(),
      r2.readUInt16LE(),
      r2.readUInt16LE(),
      r2.readUInt16LE(),
      r2.readUInt16LE(),
    ];

    return {
      signature,
      headerSize: hdrSize,
      fileSize,
      uncompressedSize,
      objectCount,
      startTimestamp: systemTimeToTimestamp(startTime),
      stopTimestamp: systemTimeToTimestamp(stopTime),
    };
  }

  private parseObjectHeader(buffer: Buffer, offset: number = 0): ObjHeaderBase | null {
    if (buffer.length - offset < OBJ_HEADER_BASE_SIZE) return null;

    const sig = buffer.slice(offset, offset + 4).toString('ascii');
    if (sig !== 'LOBJ') return null;

    const headerSize = buffer.readUInt16LE(offset + 4);
    const headerVersion = buffer.readUInt16LE(offset + 6);
    const objectSize = buffer.readUInt32LE(offset + 8);
    const objectType = buffer.readUInt32LE(offset + 12);

    if (objectSize < OBJ_HEADER_BASE_SIZE) return null;

    return { signature: sig, headerSize, headerVersion, objectSize, objectType };
  }

  /**
   * Parse the V1/V2 object header to extract timestamp.
   * OBJ_HEADER_BASE (16 bytes): sig(4) + headerSize(2) + headerVersion(2) + objectSize(4) + objectType(4)
   * OBJ_HEADER_V1 (12 bytes): flags(4) + clientIndex(2) + objectVersion(2) + timestamp(8) [as uint64 nanoseconds]
   * OBJ_HEADER_V2 (16 bytes): flags(4) + clientIndex(2) + objectVersion(2) + timestamp(8) + orig_timestamp(8)
   */
  private parseObjectTimestamp(buffer: Buffer, offset: number = 0): number {
    // After 16-byte base header
    const flagsOffset = offset + OBJ_HEADER_BASE_SIZE;
    if (buffer.length < flagsOffset + 12) return 0;

    const flags = buffer.readUInt32LE(flagsOffset);
    // timestamp is at flagsOffset + 8 (skip flags(4) + clientIndex(2) + objectVersion(2))
    const tsOffset = flagsOffset + 8;
    if (buffer.length < tsOffset + 8) return 0;

    const tsRaw = Number(buffer.readBigUInt64LE(tsOffset));

    let relativeSeconds: number;
    if (flags & TIMESTAMP_FLAG_TEN_MICS) {
      // 10 microseconds resolution
      relativeSeconds = tsRaw * 10e-6;
    } else {
      // nanoseconds resolution (default for modern files)
      relativeSeconds = tsRaw * 1e-9;
    }

    return relativeSeconds;
  }

  private async parseContainer(data: Buffer): Promise<CANMessage[]> {
    const messages: CANMessage[] = [];

    try {
      const reader = new BinaryReader(data);
      const method = reader.readUInt16LE();
      reader.skip(6); // reserved
      const uncompressedSize = reader.readUInt32LE();
      reader.skip(4); // reserved

      let containerData: Buffer = data.slice(reader.getOffset());

      if (method === ZLIB_DEFLATE) {
        containerData = (await this.decompressData(containerData)) as Buffer;
      } else if (method !== NO_COMPRESSION) {
        this.parseErrors.push(`Unknown compression method: ${method}`);
        return messages;
      }

      return this.parseObjects(containerData);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.parseErrors.push(`Container parse error: ${errorMsg}`);
    }

    return messages;
  }

  private decompressData(data: Buffer): Promise<Buffer<ArrayBufferLike>> {
    return new Promise((resolve, reject) => {
      zlib.inflate(data, (err, result) => {
        if (err) {
          // Try inflateRaw as fallback
          zlib.inflateRaw(data, (err2, result2) => {
            if (err2) reject(err);
            else resolve(result2 as Buffer<ArrayBufferLike>);
          });
        } else {
          resolve(result as Buffer<ArrayBufferLike>);
        }
      });
    });
  }

  private parseObjects(data: Buffer): CANMessage[] {
    const messages: CANMessage[] = [];
    let offset = 0;

    while (offset <= data.length - OBJ_HEADER_BASE_SIZE) {
      // Find next LOBJ signature
      const nextObj = data.indexOf(Buffer.from('LOBJ'), offset);
      if (nextObj === -1) break;

      offset = nextObj;
      if (data.length - offset < OBJ_HEADER_BASE_SIZE) break;

      const objHeader = this.parseObjectHeader(data, offset);
      if (!objHeader || objHeader.objectSize < OBJ_HEADER_BASE_SIZE) {
        offset += 4;
        continue;
      }

      try {
        // Parse relative timestamp from object header
        const relTs = this.parseObjectTimestamp(data, offset);
        const absTs = relTs + (this.header?.startTimestamp ?? 0);

        const objBuf = data.slice(offset, offset + objHeader.objectSize);

        if (objHeader.objectType === CAN_MESSAGE || objHeader.objectType === CAN_MESSAGE2) {
          const msg = this.parseCANMessage(objBuf, objHeader, relTs, absTs);
          if (msg) messages.push(msg);
        } else if (objHeader.objectType === CAN_ERROR_EXT) {
          const msg = this.parseCANErrorFrame(objBuf, objHeader, relTs, absTs);
          if (msg) messages.push(msg);
        } else if (objHeader.objectType === CAN_FD_MESSAGE) {
          const msg = this.parseCANFDMessage(objBuf, objHeader, relTs, absTs);
          if (msg) messages.push(msg);
        } else if (objHeader.objectType === CAN_FD_MESSAGE_64) {
          const msg = this.parseCANFDMessage64(objBuf, objHeader, relTs, absTs);
          if (msg) messages.push(msg);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.parseErrors.push(`Error parsing object at offset ${offset}: ${errorMsg}`);
      }

      let nextOffset = offset + objHeader.objectSize;
      const pad = (4 - (nextOffset % 4)) % 4;
      nextOffset += pad;

      if (nextOffset <= offset) nextOffset = offset + 4;
      offset = nextOffset;
    }

    return messages;
  }

  // CAN_MSG_STRUCT: channel(2) + flags(1) + dlc(1) + arb_id(4) + data(8)
  private parseCANMessage(
    buffer: Buffer,
    header: ObjHeaderBase,
    relTs: number,
    absTs: number
  ): CANMessage | null {
    try {
      let pos = header.headerSize;
      if (buffer.length < pos + 8) return null;

      const channel = buffer.readUInt16LE(pos); pos += 2;
      const msgFlags = buffer.readUInt8(pos); pos += 1;
      const dlc = buffer.readUInt8(pos); pos += 1;
      const canId = buffer.readUInt32LE(pos); pos += 4;

      const dataLen = Math.min(dlc, 8, buffer.length - pos);
      const canData = buffer.slice(pos, pos + dataLen);

      return {
        relativeTimestamp: relTs,
        absoluteTimestamp: absTs,
        arbitrationId: canId & 0x1FFFFFFF,
        isExtendedId: !!(canId & CAN_MSG_EXT),
        isRemoteFrame: !!(msgFlags & 0x10),
        isRx: !(msgFlags & DIR),
        dlc,
        data: canData,
        channel: channel > 0 ? channel - 1 : 0,
      };
    } catch {
      return null;
    }
  }

  // CAN_ERROR_EXT_STRUCT: channel(2) + length(2) + flags(4) + ecc(1) + position(1) + dlc(1) + frameLen_pad(1) + frameLength(4) + id(4) + flagsExt(2) + pad(2) + data(8)
  private parseCANErrorFrame(
    buffer: Buffer,
    header: ObjHeaderBase,
    relTs: number,
    absTs: number
  ): CANMessage | null {
    try {
      let pos = header.headerSize;
      if (buffer.length < pos + 8) return null;

      const channel = buffer.readUInt16LE(pos); pos += 2;
      pos += 2; // length
      pos += 4; // flags
      pos += 1; // ecc
      pos += 1; // position
      const dlc = buffer.readUInt8(pos); pos += 1;
      pos += 1; // frame length (low byte) — skip
      const canId = buffer.length >= pos + 4 ? buffer.readUInt32LE(pos) : 0; pos += 4;
      pos += 4; // frame length full + flagsExt + pad

      const dataLen = Math.min(dlc, 8, buffer.length - pos);
      const canData = buffer.slice(pos, pos + dataLen);

      return {
        relativeTimestamp: relTs,
        absoluteTimestamp: absTs,
        arbitrationId: canId & 0x1FFFFFFF,
        isExtendedId: !!(canId & CAN_MSG_EXT),
        isRemoteFrame: false,
        isRx: true,
        dlc,
        isErrorFrame: true,
        data: canData,
        channel: channel > 0 ? channel - 1 : 0,
      };
    } catch {
      return null;
    }
  }

  // CAN_FD_MSG_STRUCT: channel(2) + flags(1) + dlc(1) + arb_id(4) + frameLen(4) + bitCount(4) + fdFlags(1) + validBytes(1) + pad(5) + data(64)
  private parseCANFDMessage(
    buffer: Buffer,
    header: ObjHeaderBase,
    relTs: number,
    absTs: number
  ): CANMessage | null {
    try {
      let pos = header.headerSize;
      if (buffer.length < pos + 16) return null;

      const channel = buffer.readUInt16LE(pos); pos += 2;
      const msgFlags = buffer.readUInt8(pos); pos += 1;
      const dlc = buffer.readUInt8(pos); pos += 1;
      const canId = buffer.readUInt32LE(pos); pos += 4;
      pos += 4; // frame length
      pos += 4; // bit count
      const fdFlags = buffer.readUInt8(pos); pos += 1;
      const validBytes = buffer.readUInt8(pos); pos += 1;
      pos += 5; // reserved

      const dataLen = Math.min(validBytes, 64, buffer.length - pos);
      const canData = buffer.slice(pos, pos + dataLen);

      return {
        relativeTimestamp: relTs,
        absoluteTimestamp: absTs,
        arbitrationId: canId & 0x1FFFFFFF,
        isExtendedId: !!(canId & CAN_MSG_EXT),
        isRemoteFrame: !!(msgFlags & 0x10),
        isRx: !(msgFlags & DIR),
        dlc,
        isFd: !!(fdFlags & 0x1),
        bitrateSwitch: !!(fdFlags & 0x2),
        errorStateIndicator: !!(fdFlags & 0x4),
        data: canData,
        channel: channel > 0 ? channel - 1 : 0,
      };
    } catch {
      return null;
    }
  }

  // CAN_FD_MSG_64_STRUCT: channel(1) + dlc(1) + validBytes(1) + txCount(1) + id(4) + frameLen(4) + flags(4) + arbBitrate(4) + dataBitrate(4) + timeOffsBRS(4) + timeOffsCRCDel(4) + bitCount(2) + dir(1) + extDataOffset(1) + crc(4) [then data]
  private parseCANFDMessage64(
    buffer: Buffer,
    header: ObjHeaderBase,
    relTs: number,
    absTs: number
  ): CANMessage | null {
    try {
      let pos = header.headerSize;
      if (buffer.length < pos + 32) return null;

      const channel = buffer.readUInt8(pos); pos += 1;
      const dlc = buffer.readUInt8(pos); pos += 1;
      const validBytes = buffer.readUInt8(pos); pos += 1;
      pos += 1; // tx count
      const canId = buffer.readUInt32LE(pos); pos += 4;
      pos += 4; // frame length
      const flags = buffer.readUInt32LE(pos); pos += 4;
      pos += 4; // arb bitrate
      pos += 4; // data bitrate
      pos += 4; // time offset BRS
      pos += 4; // time offset CRC del
      pos += 2; // bit count
      const dir = buffer.readUInt8(pos); pos += 1;
      const extDataOffset = buffer.readUInt8(pos); pos += 1;
      pos += 4; // crc

      // If extDataOffset is set, data starts at header_size + extDataOffset
      const dataStart = extDataOffset ? header.headerSize + extDataOffset : pos;
      const dataLen = Math.min(validBytes, 64, buffer.length - dataStart);
      const canData = buffer.slice(dataStart, dataStart + dataLen).toString('hex');

      return {
        relativeTimestamp: relTs,
        absoluteTimestamp: absTs,
        arbitrationId: canId & 0x1FFFFFFF,
        isExtendedId: !!(canId & CAN_MSG_EXT),
        isRemoteFrame: !!(flags & 0x0010),
        isRx: !(dir & 0x1),
        dlc,
        isFd: !!(flags & 0x1000),
        bitrateSwitch: !!(flags & 0x2000),
        errorStateIndicator: !!(flags & 0x4000),
        data: Buffer.from(canData, 'hex'),
        channel: channel > 0 ? channel - 1 : 0,
      };
    } catch {
      return null;
    }
  }

  getHeader(): FileHeader | null {
    return this.header;
  }

  getMessages(): CANMessage[] {
    return this.messages;
  }

  getErrors(): string[] {
    return this.parseErrors;
  }
}