import * as assert from 'assert';
import { applyFilter } from '../blf-host';
import { CANMessage } from '../blf-parser';
import { FilterState } from '../blf-types';

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

const no: FilterState = { id: '', dir: '', msgType: '', channel: '' };

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
    const r = applyFilter(msgs, { id: '100@1', channel: '0', dir: '', msgType: '' });
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].channel, 1);
  });

  test('malformed @channel segment is dropped silently', () => {
    // '100@abc' → non-integer channel → segment dropped → no id filter → all 6 returned
    assert.strictEqual(applyFilter(msgs, { ...no, id: '100@abc' }).length, 6);
  });

  test('empty @channel part is dropped', () => {
    // '100@' → chPart='' → fails /^\d+$/ → dropped → all 6 returned
    assert.strictEqual(applyFilter(msgs, { ...no, id: '100@' }).length, 6);
  });
});
