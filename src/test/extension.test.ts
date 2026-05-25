import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { BLFReader, CANMessage, canFdDlcToLength } from '../blf-parser';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});
});

suite('BLF parser', () => {
	test('maps CAN FD DLC values to payload lengths', () => {
		const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];

		expected.forEach((length, dlc) => {
			assert.strictEqual(canFdDlcToLength(dlc), length);
		});
	});

	test('parses CAN_FD_MESSAGE_64 payload lengths from DLC fallback', () => {
		assert.strictEqual(parseCanFdMessage64(8).data.length, 8);
		assert.strictEqual(parseCanFdMessage64(10).data.length, 16);
		assert.strictEqual(parseCanFdMessage64(15).data.length, 64);
	});

	test('parses CAN_FD_MESSAGE_64 payload after fixed fields, not extDataOffset', () => {
		const msg = parseCanFdMessage64(10, 0, 8);
		const data = [...msg.data];

		assert.deepStrictEqual(data.slice(0, 8), [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7]);
		assert.strictEqual(msg.data.length, 16);
	});
});

function parseCanFdMessage64(dlc: number, validBytes = 0, extDataOffset = 0): CANMessage {
	const headerSize = 32;
	const fixedBodySize = 40;
	const payload = Buffer.from(Array.from({ length: 64 }, (_, i) => 0xa0 + i));
	const buffer = Buffer.alloc(headerSize + fixedBodySize + payload.length, 0);

	let pos = headerSize;
	buffer.writeUInt8(1, pos); pos += 1; // channel
	buffer.writeUInt8(dlc, pos); pos += 1;
	buffer.writeUInt8(validBytes, pos); pos += 1;
	pos += 1; // tx count
	buffer.writeUInt32LE(0x2fa, pos); pos += 4;
	pos += 4; // frame length
	buffer.writeUInt32LE(0x3000, pos); pos += 4; // CAN FD + BRS flags
	pos += 4; // arb bitrate
	pos += 4; // data bitrate
	pos += 4; // time offset BRS
	pos += 4; // time offset CRC delimiter
	pos += 2; // bit count
	buffer.writeUInt8(0, pos); pos += 1; // dir RX
	buffer.writeUInt8(extDataOffset, pos); pos += 1;
	pos += 4; // crc
	payload.copy(buffer, pos);

	const reader = new BLFReader('');
	const parser = (reader as unknown as {
		parseCANFDMessage64(buffer: Buffer, header: object, relTs: number, absTs: number): CANMessage | null;
	}).parseCANFDMessage64.bind(reader);
	const msg = parser(buffer, {
		signature: 'LOBJ',
		headerSize,
		headerVersion: 2,
		objectSize: buffer.length,
		objectType: 101,
	}, 0, 0);

	assert.ok(msg);
	return msg;
}
