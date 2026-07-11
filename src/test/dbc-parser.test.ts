import * as assert from 'assert';
import { parseDbcFile, decodeSignal, DbcSignal } from '../dbc-parser';
import { toWire } from '../blf-host';
import { CANMessage } from '../blf-parser';

const EXT_RAW_ID = 0x18fedcba + 0x80000000; // extended bit set, as stored in DBC

const DBC_TEXT = `VERSION ""

BO_ 256 EngineStatus: 8 ECU1
 SG_ EngineSpeed : 0|16@1+ (0.25,0) [0|16383.75] "rpm" Vector__XXX
 SG_ CoolantTemp : 16|8@1+ (1,-40) [-40|215] "degC" Vector__XXX
 SG_ GearPos : 24|4@1+ (1,0) [0|15] "" Vector__XXX
 SG_ AccelPedal : 39|8@0- (1,0) [-128|127] "%" Vector__XXX

BO_ ${EXT_RAW_ID} ExtendedMsg: 8 ECU2
 SG_ Counter : 0|8@1+ (1,0) [0|255] "" Vector__XXX

CM_ BO_ 256 "Engine status frame";
CM_ SG_ 256 EngineSpeed "Engine speed signal";
VAL_ 256 GearPos 0 "Park" 1 "Neutral" 2 "Drive" ;
`;

function sig(overrides: Partial<DbcSignal>): DbcSignal {
  return {
    name: 's',
    startBit: 0,
    bitLength: 8,
    byteOrder: 'intel',
    signed: false,
    factor: 1,
    offset: 0,
    unit: '',
    ...overrides,
  };
}

suite('parseDbcFile', () => {
  const db = parseDbcFile(DBC_TEXT, 'test.dbc');

  test('parses messages keyed by masked 29-bit id', () => {
    assert.strictEqual(db.messages.size, 2);
    const eng = db.messages.get(0x100);
    assert.ok(eng);
    assert.strictEqual(eng.name, 'EngineStatus');
    assert.strictEqual(eng.dlc, 8);
    assert.strictEqual(eng.signals.length, 4);
    assert.strictEqual(eng.isExtended, false);
  });

  test('masks extended-bit ids and flags them', () => {
    const ext = db.messages.get(0x18fedcba);
    assert.ok(ext);
    assert.strictEqual(ext.isExtended, true);
    assert.strictEqual(ext.name, 'ExtendedMsg');
  });

  test('parses signal fields', () => {
    const speed = db.messages.get(0x100)!.signals.find(s => s.name === 'EngineSpeed')!;
    assert.strictEqual(speed.startBit, 0);
    assert.strictEqual(speed.bitLength, 16);
    assert.strictEqual(speed.byteOrder, 'intel');
    assert.strictEqual(speed.signed, false);
    assert.strictEqual(speed.factor, 0.25);
    assert.strictEqual(speed.unit, 'rpm');

    const pedal = db.messages.get(0x100)!.signals.find(s => s.name === 'AccelPedal')!;
    assert.strictEqual(pedal.byteOrder, 'motorola');
    assert.strictEqual(pedal.signed, true);
  });

  test('attaches comments and value tables', () => {
    const eng = db.messages.get(0x100)!;
    assert.strictEqual(eng.comment, 'Engine status frame');
    assert.strictEqual(eng.signals.find(s => s.name === 'EngineSpeed')!.comment, 'Engine speed signal');
    const gear = eng.signals.find(s => s.name === 'GearPos')!;
    assert.strictEqual(gear.valueTable?.get(2), 'Drive');
  });
});

suite('decodeSignal', () => {
  // EngineSpeed=10000 raw (LE 0x2710), CoolantTemp=40 raw, GearPos=2, AccelPedal=0xFE
  const data = Buffer.from([0x10, 0x27, 0x28, 0x02, 0xfe, 0x00, 0x00, 0x00]);

  test('intel unsigned with factor', () => {
    const r = decodeSignal(data, sig({ startBit: 0, bitLength: 16, factor: 0.25 }));
    assert.strictEqual(r.raw, 10000);
    assert.strictEqual(r.physical, 2500);
  });

  test('intel with offset', () => {
    const r = decodeSignal(data, sig({ startBit: 16, bitLength: 8, offset: -40 }));
    assert.strictEqual(r.raw, 40);
    assert.strictEqual(r.physical, 0);
  });

  test('intel cross-byte extraction', () => {
    // bits 4..11 of [0xAB, 0xCD] → 0xDA
    const r = decodeSignal(Buffer.from([0xab, 0xcd]), sig({ startBit: 4, bitLength: 8 }));
    assert.strictEqual(r.raw, 0xda);
  });

  test('motorola big-endian extraction', () => {
    // startBit 7 (MSB of byte 0), 16 bits → 0x1234
    const r = decodeSignal(Buffer.from([0x12, 0x34]), sig({ startBit: 7, bitLength: 16, byteOrder: 'motorola' }));
    assert.strictEqual(r.raw, 0x1234);
  });

  test('motorola signed negative', () => {
    const r = decodeSignal(data, sig({ startBit: 39, bitLength: 8, byteOrder: 'motorola', signed: true }));
    assert.strictEqual(r.raw, -2);
  });

  test('intel signed negative', () => {
    const r = decodeSignal(Buffer.from([0xff]), sig({ startBit: 0, bitLength: 8, signed: true }));
    assert.strictEqual(r.raw, -1);
  });

  test('value table label lookup', () => {
    const s = sig({ startBit: 24, bitLength: 4, valueTable: new Map([[2, 'Drive']]) });
    assert.strictEqual(decodeSignal(data, s).valueLabel, 'Drive');
  });

  test('bits beyond buffer read as zero', () => {
    const r = decodeSignal(Buffer.from([0xff]), sig({ startBit: 0, bitLength: 16 }));
    assert.strictEqual(r.raw, 0xff);
  });
});

suite('toWire with DBC', () => {
  const db = parseDbcFile(DBC_TEXT, 'test.dbc');

  function msg(): CANMessage {
    return {
      relativeTimestamp: 0,
      absoluteTimestamp: 0,
      arbitrationId: 0x100,
      isExtendedId: false,
      isRemoteFrame: false,
      isRx: true,
      dlc: 8,
      data: Buffer.from([0x10, 0x27, 0x28, 0x02, 0xfe, 0x00, 0x00, 0x00]),
      channel: 0,
    };
  }

  test('resolves message name and decodes signals', () => {
    const w = toWire(msg(), 0, db);
    assert.strictEqual(w.msgName, 'EngineStatus');
    assert.strictEqual(w.signals?.length, 4);

    const speed = w.signals!.find(s => s.name === 'EngineSpeed')!;
    assert.strictEqual(speed.physStr, '2500.0 rpm'); // factor 0.25 → 1 decimal
    assert.strictEqual(speed.rawHex, '0x2710');

    const gear = w.signals!.find(s => s.name === 'GearPos')!;
    assert.strictEqual(gear.valueLabel, 'Drive');
  });

  test('signed negative raw renders as bit pattern scoped to bitLength', () => {
    const pedal = toWire(msg(), 0, db).signals!.find(s => s.name === 'AccelPedal')!;
    assert.strictEqual(pedal.physical, -2);
    assert.strictEqual(pedal.rawHex, '0xFE');
  });

  test('no DBC match leaves msgName and signals undefined', () => {
    const m = msg();
    m.arbitrationId = 0x999;
    const w = toWire(m, 0, db);
    assert.strictEqual(w.msgName, undefined);
    assert.strictEqual(w.signals, undefined);
  });
});
