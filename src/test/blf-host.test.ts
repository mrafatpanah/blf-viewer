import * as assert from 'assert';
import { applyFilter, applySort, toWire, UdsReconstructor, reconstructUdsMessages } from '../blf-host';
import { CANMessage } from '../blf-parser';
import { FilterState, SortState } from '../blf-types';

function msg(arbitrationId: number, channel: number): CANMessage {
  return {
    relativeTimestamp: 0,
    absoluteTimestamp: 0,
    arbitrationId,
    isExtendedId: false,
    isRemoteFrame: false,
    isRx: true,
    dlc: 8,
    data: Buffer.alloc(8),
    channel,
  };
}

const no: FilterState = { id: '', data: '', dir: '', msgType: '', channel: '' };

// Messages mirror the two-channel.blf fixture:
//   ch0: 0x100, 0x200, 0x300
//   ch1: 0x100, 0x400, 0x500
const msgs = [
  msg(0x100, 0),
  msg(0x100, 1),
  msg(0x200, 0),
  msg(0x400, 1),
  msg(0x300, 0),
  msg(0x500, 1),
];

const ids = (result: CANMessage[]) =>
  result.map(m => `ch${m.channel}/0x${m.arbitrationId.toString(16).toUpperCase()}`).sort();

suite('applyFilter – id@channel', () => {
  test('no filter returns all', () => {
    assert.strictEqual(applyFilter(msgs, no).length, 6);
  });

  test('plain id matches both channels', () => {
    assert.deepStrictEqual(ids(applyFilter(msgs, { ...no, id: '100' })), ['ch0/0x100', 'ch1/0x100']);
  });

  test('id@0 restricts to channel 0', () => {
    const r = applyFilter(msgs, { ...no, id: '100@0' });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].channel, 0);
  });

  test('id@1 restricts to channel 1', () => {
    const r = applyFilter(msgs, { ...no, id: '100@1' });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].channel, 1);
  });

  test('id@0,id@1 returns same id from both channels simultaneously', () => {
    assert.deepStrictEqual(
      ids(applyFilter(msgs, { ...no, id: '100@0,100@1' })),
      ['ch0/0x100', 'ch1/0x100']
    );
  });

  test('cross-channel: different ids per channel', () => {
    assert.deepStrictEqual(
      ids(applyFilter(msgs, { ...no, id: '100@0,400@1' })),
      ['ch0/0x100', 'ch1/0x400']
    );
  });

  test('global channel dropdown restricts plain segment', () => {
    const r = applyFilter(msgs, { ...no, id: '100', channel: '0' });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].channel, 0);
  });

  test('@channel suffix overrides global channel dropdown', () => {
    // id='100@1' with global channel='0': @1 wins, returns ch1 message
    const r = applyFilter(msgs, { id: '100@1', data: '', channel: '0', dir: '', msgType: '' });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].channel, 1);
  });

  test('malformed @channel segment is dropped silently', () => {
    // '100@abc' → non-integer channel → segment dropped → no valid id filter → fail-closed → 0 returned
    assert.strictEqual(applyFilter(msgs, { ...no, id: '100@abc' }).length, 0);
  });

  test('empty @channel part is dropped', () => {
    // '100@' → chPart='' → fails /^\d+$/ → dropped → no valid id filter → fail-closed → 0 returned
    assert.strictEqual(applyFilter(msgs, { ...no, id: '100@' }).length, 0);
  });
});

// ── applySort ─────────────────────────────────────────────────────────────────

function mk(overrides: Partial<CANMessage>): CANMessage {
  return {
    relativeTimestamp: 0,
    absoluteTimestamp: 0,
    arbitrationId: 0x100,
    isExtendedId: false,
    isRemoteFrame: false,
    isRx: true,
    dlc: 8,
    data: Buffer.alloc(8),
    channel: 0,
    ...overrides,
  };
}

suite('applySort', () => {
  const unsorted = [
    mk({ arbitrationId: 0x300, relativeTimestamp: 2, absoluteTimestamp: 12, channel: 1, dlc: 4, isRx: false }),
    mk({ arbitrationId: 0x100, relativeTimestamp: 3, absoluteTimestamp: 13, channel: 0, dlc: 8, isFd: true }),
    mk({ arbitrationId: 0x200, relativeTimestamp: 1, absoluteTimestamp: 11, channel: 2, dlc: 2, isErrorFrame: true }),
  ];

  const idsOf = (r: CANMessage[]) => r.map(m => m.arbitrationId);

  test('default column i keeps parse order, desc reverses copy', () => {
    assert.deepStrictEqual(idsOf(applySort(unsorted, { col: 'i', dir: 'asc' })), [0x300, 0x100, 0x200]);
    assert.deepStrictEqual(idsOf(applySort(unsorted, { col: 'i', dir: 'desc' })), [0x200, 0x100, 0x300]);
    // master array untouched
    assert.deepStrictEqual(idsOf(unsorted), [0x300, 0x100, 0x200]);
  });

  test('sorts by relative timestamp', () => {
    assert.deepStrictEqual(idsOf(applySort(unsorted, { col: 't', dir: 'asc' })), [0x200, 0x300, 0x100]);
    assert.deepStrictEqual(idsOf(applySort(unsorted, { col: 't', dir: 'desc' })), [0x100, 0x300, 0x200]);
  });

  test('sorts by utc timestamp', () => {
    assert.deepStrictEqual(idsOf(applySort(unsorted, { col: 'utc', dir: 'asc' })), [0x200, 0x300, 0x100]);
  });

  test('sorts by arbitration id without mutating input', () => {
    assert.deepStrictEqual(idsOf(applySort(unsorted, { col: 'id', dir: 'asc' })), [0x100, 0x200, 0x300]);
    assert.deepStrictEqual(idsOf(unsorted), [0x300, 0x100, 0x200]);
  });

  test('sorts by type ERR < FD < STD ascending', () => {
    const types = applySort(unsorted, { col: 'type', dir: 'asc' })
      .map(m => m.isErrorFrame ? 'ERR' : m.isFd ? 'FD' : 'STD');
    assert.deepStrictEqual(types, ['ERR', 'FD', 'STD']);
  });

  test('sorts by direction RX first ascending', () => {
    const dirs = applySort(unsorted, { col: 'dir', dir: 'asc' }).map(m => m.isRx ? 'RX' : 'TX');
    assert.deepStrictEqual(dirs, ['RX', 'RX', 'TX']);
  });

  test('sorts by channel and dlc', () => {
    assert.deepStrictEqual(applySort(unsorted, { col: 'ch', dir: 'asc' }).map(m => m.channel), [0, 1, 2]);
    assert.deepStrictEqual(applySort(unsorted, { col: 'dlc', dir: 'desc' }).map(m => m.dlc), [8, 4, 2]);
  });

  test('undefined sort state returns input as-is', () => {
    assert.strictEqual(applySort(unsorted, undefined as unknown as SortState), unsorted);
  });
});

// ── toWire ────────────────────────────────────────────────────────────────────

suite('toWire', () => {
  test('formats standard id as 3-char hex, extended as 0x + 8-char', () => {
    assert.strictEqual(toWire(mk({ arbitrationId: 0x7e }), 0).id, '07E');
    assert.strictEqual(
      toWire(mk({ arbitrationId: 0x18fedcba, isExtendedId: true }), 0).id,
      '0x18FEDCBA'
    );
  });

  test('formats relative timestamp with 7 decimals', () => {
    assert.strictEqual(toWire(mk({ relativeTimestamp: 1.23456789 }), 0).t, '1.2345679');
  });

  test('formats utc as ISO string, empty when not finite', () => {
    assert.strictEqual(toWire(mk({ absoluteTimestamp: 1700000000.5 }), 0).utc, '2023-11-14T22:13:20.500Z');
    assert.strictEqual(toWire(mk({ absoluteTimestamp: NaN }), 0).utc, '');
  });

  test('formats data as space-separated uppercase hex pairs', () => {
    assert.strictEqual(toWire(mk({ data: Buffer.from([0xde, 0xad, 0xbe, 0xef]) }), 0).data, 'DE AD BE EF');
  });

  test('joins active flags', () => {
    const w = toWire(mk({ isExtendedId: true, isRemoteFrame: true, bitrateSwitch: true, errorStateIndicator: true }), 0);
    assert.strictEqual(w.flags, 'EXT RTR BRS ESI');
    assert.strictEqual(toWire(mk({}), 0).flags, '');
  });

  test('type precedence: ERR over FD over STD', () => {
    assert.strictEqual(toWire(mk({}), 0).type, 'STD');
    assert.strictEqual(toWire(mk({ isFd: true }), 0).type, 'FD');
    assert.strictEqual(toWire(mk({ isFd: true, isErrorFrame: true }), 0).type, 'ERR');
  });

  test('uds and otp rows override type and data', () => {
    const uds = toWire(mk({ isUds: true, udsType: 'neg' }), 0);
    assert.strictEqual(uds.type, 'neg');

    const otp = toWire(mk({ isOtp: true, otpType: 'FC.WT', formattedData: '[30 00 00]' }), 0);
    assert.strictEqual(otp.type, 'FC.WT');
    assert.strictEqual(otp.data, '[30 00 00]');
  });

  test('carries index and raw id', () => {
    const w = toWire(mk({ arbitrationId: 0x321 }), 42);
    assert.strictEqual(w.i, 42);
    assert.strictEqual(w.rawId, 0x321);
  });
});

// ── UDS / ISO-TP reconstruction ───────────────────────────────────────────────

const REQ = 0x7e0;
const RES = 0x7e8;

function diag(id: number, data: number[], overrides: Partial<CANMessage> = {}): CANMessage {
  return mk({ arbitrationId: id, data: Buffer.from(data), dlc: data.length, ...overrides });
}

suite('UdsReconstructor', () => {
  test('ignores non-diagnostic ids', () => {
    const r = new UdsReconstructor(REQ, RES);
    assert.strictEqual(r.processMessage(diag(0x123, [0x02, 0x10, 0x01])).otpType, '');
  });

  test('single frame request completes immediately', () => {
    const r = new UdsReconstructor(REQ, RES);
    const info = r.processMessage(diag(REQ, [0x02, 0x10, 0x01, 0, 0, 0, 0, 0]));
    assert.strictEqual(info.otpType, 'SF');
    assert.ok(info.completedUds);
    assert.strictEqual(info.completedUds.udsType, 'req');
    assert.deepStrictEqual([...info.completedUds.data], [0x10, 0x01]);
  });

  test('single frame response classifies pos vs neg', () => {
    const r = new UdsReconstructor(REQ, RES);
    const pos = r.processMessage(diag(RES, [0x02, 0x50, 0x01]));
    const neg = r.processMessage(diag(RES, [0x03, 0x7f, 0x10, 0x22]));
    assert.strictEqual(pos.completedUds?.udsType, 'pos');
    assert.strictEqual(neg.completedUds?.udsType, 'neg');
  });

  test('classic frame starting with 0x00 is not an FD length escape', () => {
    const r = new UdsReconstructor(REQ, RES);
    const info = r.processMessage(diag(REQ, [0x00, 0x05, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]));
    assert.strictEqual(info.otpType, 'SF');
    assert.strictEqual(info.completedUds, undefined); // zero-length SF → raw frame only
  });

  test('FD single frame uses length escape byte', () => {
    const r = new UdsReconstructor(REQ, RES);
    const payload = [0x22, 0xf1, 0x90, 1, 2, 3, 4, 5, 6, 7];
    const info = r.processMessage(diag(REQ, [0x00, 0x0a, ...payload], { isFd: true }));
    assert.strictEqual(info.otpType, 'SF');
    assert.deepStrictEqual([...(info.completedUds?.data ?? Buffer.alloc(0))], payload);
  });

  test('FF + CF reassembles multi-frame message', () => {
    const r = new UdsReconstructor(REQ, RES);
    const ff = r.processMessage(diag(RES, [0x10, 0x0a, 0x62, 0xf1, 0x90, 0xaa, 0xbb, 0xcc]));
    assert.strictEqual(ff.otpType, 'FF');
    assert.strictEqual(ff.completedUds, undefined);

    const cf = r.processMessage(diag(RES, [0x21, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44]));
    assert.strictEqual(cf.otpType, 'CF');
    assert.ok(cf.completedUds);
    assert.strictEqual(cf.completedUds.udsType, 'pos');
    assert.deepStrictEqual(
      [...cf.completedUds.data],
      [0x62, 0xf1, 0x90, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11] // trimmed to FF_DL=10
    );
  });

  test('sequence-number break aborts reassembly', () => {
    const r = new UdsReconstructor(REQ, RES);
    r.processMessage(diag(RES, [0x10, 0x0a, 1, 2, 3, 4, 5, 6]));
    const bad = r.processMessage(diag(RES, [0x23, 7, 8, 9, 10, 11, 12, 13])); // expected SN=1, got 3
    assert.strictEqual(bad.snError, true);
    assert.strictEqual(bad.completedUds, undefined);
    // stream aborted → the "correct" CF is now an orphan
    const orphan = r.processMessage(diag(RES, [0x21, 7, 8, 9, 10, 11, 12, 13]));
    assert.strictEqual(orphan.snError, true);
  });

  test('orphan CF without FF reports snError', () => {
    const r = new UdsReconstructor(REQ, RES);
    assert.strictEqual(r.processMessage(diag(RES, [0x21, 1, 2, 3])).snError, true);
  });

  test('flow control frames classify CTS / WT / OVFLW', () => {
    const r = new UdsReconstructor(REQ, RES);
    assert.strictEqual(r.processMessage(diag(REQ, [0x30, 0, 0])).otpType, 'FC.CTS');
    assert.strictEqual(r.processMessage(diag(REQ, [0x31, 0, 0])).otpType, 'FC.WT');
    assert.strictEqual(r.processMessage(diag(REQ, [0x32, 0, 0])).otpType, 'FC.OVFLW');
  });

  test('streams are independent per channel', () => {
    const r = new UdsReconstructor(REQ, RES);
    r.processMessage(diag(RES, [0x10, 0x0a, 1, 2, 3, 4, 5, 6], { channel: 0 }));
    // CF on a different channel has no FF there → orphan, ch0 stream untouched
    assert.strictEqual(r.processMessage(diag(RES, [0x21, 9, 9, 9], { channel: 1 })).snError, true);
    const done = r.processMessage(diag(RES, [0x21, 7, 8, 9, 10, 11, 12, 13], { channel: 0 }));
    assert.ok(done.completedUds);
  });
});

suite('reconstructUdsMessages', () => {
  test('emits OTP row plus reassembled UDS row, passes other traffic through', () => {
    const input = [
      diag(REQ, [0x02, 0x10, 0x01, 0, 0, 0, 0, 0]),
      diag(RES, [0x02, 0x50, 0x01, 0, 0, 0, 0, 0], { isRx: false }), // ECU-side capture: response is TX
      mk({ arbitrationId: 0x123 }),
    ];
    const out = reconstructUdsMessages(input, REQ, RES);

    assert.strictEqual(out.length, 5); // otp+uds, otp+uds, raw
    assert.strictEqual(out[0].isOtp, true);
    assert.strictEqual(out[0].otpType, 'SF');
    assert.strictEqual(out[0].formattedData, '[02] 10 01 [00 00 00 00 00]');
    assert.strictEqual(out[1].isUds, true);
    assert.strictEqual(out[4].arbitrationId, 0x123);
    assert.strictEqual(out[4].isOtp, undefined);
  });

  test('src/dst derive from arbitration id, never from isRx', () => {
    const input = [diag(RES, [0x02, 0x50, 0x01], { isRx: false })];
    const uds = reconstructUdsMessages(input, REQ, RES)[1];
    assert.strictEqual(uds.src, '7E8');
    assert.strictEqual(uds.dst, '7E0');
  });

  test('OTP transport rows carry src/dst too (CANoe parity)', () => {
    const input = [
      diag(REQ, [0x02, 0x10, 0x01]),               // SF request
      diag(RES, [0x10, 0x0a, 1, 2, 3, 4, 5, 6]),   // FF response
      diag(REQ, [0x30, 0, 0]),                      // FC from the requester
    ];
    const out = reconstructUdsMessages(input, REQ, RES);
    const otp = out.filter(m => m.isOtp);
    assert.strictEqual(otp.length, 3);
    assert.deepStrictEqual([otp[0].src, otp[0].dst], ['7E0', '7E8']); // SF: req → res
    assert.deepStrictEqual([otp[1].src, otp[1].dst], ['7E8', '7E0']); // FF: res → req
    assert.deepStrictEqual([otp[2].src, otp[2].dst], ['7E0', '7E8']); // FC: req → res
  });

  test('connection index increments per completed message', () => {
    const input = [
      diag(REQ, [0x02, 0x10, 0x01]),
      diag(RES, [0x02, 0x50, 0x01]),
    ];
    const out = reconstructUdsMessages(input, REQ, RES);
    assert.strictEqual(out[1].conn, 1);
    assert.strictEqual(out[3].conn, 2);
  });

  test('annotates without CDD using SID fallbacks', () => {
    const req = reconstructUdsMessages([diag(REQ, [0x02, 0x10, 0x01])], REQ, RES)[1];
    assert.strictEqual(req.name, 'UDS_SID_0x10::req');
    assert.strictEqual(req.service, 'SID_0x10');

    const neg = reconstructUdsMessages([diag(RES, [0x03, 0x7f, 0x10, 0x22])], REQ, RES)[1];
    assert.strictEqual(neg.name, 'SID_0x10::neg(conditionsNotCorrect)');
    assert.strictEqual(neg.diagId, '7F 10 22');
  });
});
