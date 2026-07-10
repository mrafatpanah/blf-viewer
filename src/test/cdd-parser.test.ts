import * as assert from 'assert';
import { parseCddFile } from '../cdd-parser';
import { UdsReconstructor, reconstructUdsMessages, toWire } from '../blf-host';
import { CANMessage } from '../blf-parser';

// Sample mock CDD XML content to test the parser
const mockCddXml = `<?xml version='1.0' encoding='utf-8' standalone='no'?>
<!DOCTYPE CANDELA SYSTEM 'candela.dtd'>
<CANDELA dtdvers='11.0.102'>
<ECUDOC>
<DEFATTS></DEFATTS>
<UNSDEF id='_000001BA6892EAC0' oid='8350EF1976154d83BFF6E3E39B15E009' temploid='4E50598D7EA34ad0907B94747FC31667' attrcatref='_000001BA685D3B30' usage='sys' v='1808' df='hex'>
<NAME>
<TUV xml:lang='en-US'>Request CAN-ID</TUV>
</NAME>
<QUAL>CAN.ReqCanId</QUAL>
</UNSDEF>
<UNSDEF id='_000001BA6892ECB0' oid='BE6E45DA361C4a4a81F9395319B48E39' temploid='8F1A928D8071442b8A555654C2A03325' attrcatref='_000001BA685D3B30' usage='sys' v='1810' df='hex'>
<NAME>
<TUV xml:lang='en-US'>Response CAN-ID</TUV>
</NAME>
<QUAL>CAN.ResCanId</QUAL>
</UNSDEF>
<UNS oid='CAE520AC2B7543718825B5BE7827C75F' attrref='_000001BA6892EAC0' v='1922'/>
<UNS oid='BFEB1811E4C84eccB7139A3330D0FFD2' attrref='_000001BA6892ECB0' v='1930'/>
<PROTOCOLSERVICES>
<PROTOCOLSERVICE id='_000001BA49589220' oid='B5DA315CE4FC4f3a80D307E4207DAEA9' temploid='{983175F8-D5F7-4ead-8D51-AE6FB12B7D23}' func='1' phys='1' mresp='0' respOnPhys='1' respOnFunc='1'>
<NAME>
<TUV xml:lang='en-US'>($10) DiagnosticSessionControl</TUV>
</NAME>
<QUAL>DSC</QUAL>
<REQ>
<CONSTCOMP id='_000001BA6CD54250' must='1' spec='sid' bl='8' v='16'></CONSTCOMP>
<STATICCOMP id='_000001BA6A414830' must='1' spec='sub' respsupbit='1'></STATICCOMP>
</REQ>
<POS>
<CONSTCOMP id='_000001BA6CD519F0' must='1' spec='sid' bl='8' v='80'></CONSTCOMP>
</POS>
</PROTOCOLSERVICE>
</PROTOCOLSERVICES>
<DCLSRVTMPL id='_000001BA6CC8A4F0' tmplref='_000001BA49589220' conv='req'></DCLSRVTMPL>
<DIAGCLASS id='_000001BA6CFECCA0'>
<DIAGINST id='_000001BA6A396A10' tmplref='_000001BA6CEA4D60'>
<NAME>
<TUV xml:lang='en-US'>Default Session</TUV>
</NAME>
<QUAL>DefaultSession</QUAL>
<SERVICE id='_000001BA6D2EF6E0' tmplref='_000001BA6CC8A4F0'>
<SHORTCUTNAME>
<TUV xml:lang='en-US'>Default Session Start</TUV>
</SHORTCUTNAME>
</SERVICE>
<STATICVALUE shstaticref='_000001BA6A3E0910' v='1'/>
</DIAGINST>
</DIAGCLASS>
</ECUDOC>
</CANDELA>`;

suite('cdd-parser', () => {
  test('parseCddFile parses CAN IDs and services correctly', () => {
    const db = parseCddFile(mockCddXml, 'test.cdd');
    assert.strictEqual(db.fileName, 'test.cdd');
    assert.strictEqual(db.requestCanId, 1922);
    assert.strictEqual(db.responseCanId, 1930);
    assert.strictEqual(db.services.size, 2); // req and pos mappings

    const reqService = db.services.get('10 01');
    assert.ok(reqService);
    assert.strictEqual(reqService.name, 'Default Session Start::req');
    assert.strictEqual(reqService.type, 'req');
    assert.strictEqual(reqService.sid, 0x10);
    assert.strictEqual(reqService.param, 1);
    assert.strictEqual(reqService.paramType, 'sub');

    const posService = db.services.get('50 01');
    assert.ok(posService);
    assert.strictEqual(posService.name, 'Default Session Start::pos');
    assert.strictEqual(posService.type, 'pos');
    assert.strictEqual(posService.sid, 0x50);
  });

  test('regex-metacharacter UNSDEF id does not throw or hang (regex-injection guard)', () => {
    // A malicious/malformed CDD could carry regex metacharacters in the id attribute;
    // parseCddFile must treat it as a literal string, not inject it into a RegExp unescaped.
    const evilXml = `<?xml version='1.0'?>
<CANDELA><ECUDOC>
<UNSDEF id='(a+)+evil$' oid='X' attrcatref='Y' usage='sys' v='1' df='hex'>
<NAME><TUV xml:lang='en-US'>Request CAN-ID</TUV></NAME>
</UNSDEF>
<UNS oid='Z' attrref='(a+)+evil$' v='1922'/>
</ECUDOC></CANDELA>`;
    const start = Date.now();
    const db = parseCddFile(evilXml, 'evil.cdd');
    const elapsedMs = Date.now() - start;
    assert.ok(elapsedMs < 1000, `parseCddFile took ${elapsedMs}ms — possible ReDoS via unescaped regex interpolation`);
    assert.strictEqual(db.requestCanId, 1922); // literal match still succeeds
  });
});

function createMsgCh(id: number, data: number[], channel: number): CANMessage {
  return {
    relativeTimestamp: 0.1,
    absoluteTimestamp: 1000,
    arbitrationId: id,
    isExtendedId: false,
    isRemoteFrame: false,
    isRx: id === 0x78A,
    dlc: data.length,
    data: Buffer.from(data),
    channel
  };
}

function createMsg(id: number, data: number[]): CANMessage {
  return {
    relativeTimestamp: 0.1,
    absoluteTimestamp: 1000,
    arbitrationId: id,
    isExtendedId: false,
    isRemoteFrame: false,
    isRx: id === 0x78A,
    dlc: data.length,
    data: Buffer.from(data),
    channel: 0
  };
}

suite('UdsReconstructor', () => {
  test('reconstructs Single Frame UDS message', () => {
    const reconstructor = new UdsReconstructor(0x782, 0x78A);
    const m = createMsg(0x782, [0x02, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const { otpType, completedUds } = reconstructor.processMessage(m);

    assert.strictEqual(otpType, 'SF');
    assert.ok(completedUds);
    assert.strictEqual(completedUds.udsType, 'req');
    assert.strictEqual(completedUds.dlc, 2);
    assert.deepStrictEqual(Array.from(completedUds.data), [0x10, 0x01]);
  });

  test('reconstructs Multi Frame UDS message', () => {
    const reconstructor = new UdsReconstructor(0x782, 0x78A);
    
    // FF: first frame, total len = 9 bytes
    const ff = createMsg(0x78A, [0x10, 0x09, 0x62, 0xF1, 0x8C, 0x11, 0x22, 0x33]);
    const ffResult = reconstructor.processMessage(ff);
    assert.strictEqual(ffResult.otpType, 'FF');
    assert.strictEqual(ffResult.completedUds, undefined);

    // FC: Flow control frame from tester (processed but doesn't yield UDS)
    const fc = createMsg(0x782, [0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const fcResult = reconstructor.processMessage(fc);
    assert.strictEqual(fcResult.otpType, 'FC.CTS');
    assert.strictEqual(fcResult.completedUds, undefined);

    // CF: consecutive frame, SN = 1
    const cf = createMsg(0x78A, [0x21, 0x44, 0x55, 0x66, 0xAA, 0xBB, 0xCC, 0xDD]);
    const cfResult = reconstructor.processMessage(cf);
    assert.strictEqual(cfResult.otpType, 'CF');
    assert.ok(cfResult.completedUds);
    assert.strictEqual(cfResult.completedUds.udsType, 'pos');
    assert.strictEqual(cfResult.completedUds.dlc, 9);
    assert.deepStrictEqual(
      Array.from(cfResult.completedUds.data),
      [0x62, 0xF1, 0x8C, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]
    );
  });

  test('CF with wrong sequence number aborts reassembly (no silent corruption)', () => {
    const r = new UdsReconstructor(0x782, 0x78A);
    r.processMessage(createMsg(0x78A, [0x10, 0x09, 0x62, 0xF1, 0x8C, 0x11, 0x22, 0x33])); // FF, expect SN=1
    // CF carries SN=2 instead of 1 → sequence break
    const bad = r.processMessage(createMsg(0x78A, [0x22, 0x44, 0x55, 0x66, 0, 0, 0, 0]));
    assert.strictEqual(bad.otpType, 'CF');
    assert.strictEqual(bad.snError, true);
    assert.strictEqual(bad.completedUds, undefined);
    // A correct SN=1 afterwards must NOT complete — stream was aborted
    const after = r.processMessage(createMsg(0x78A, [0x21, 0x44, 0x55, 0x66, 0, 0, 0, 0]));
    assert.strictEqual(after.completedUds, undefined);
    assert.strictEqual(after.snError, true);
  });

  test('orphan CF (no preceding FF) is flagged, not reassembled', () => {
    const r = new UdsReconstructor(0x782, 0x78A);
    const cf = r.processMessage(createMsg(0x78A, [0x21, 0x44, 0x55, 0x66, 0, 0, 0, 0]));
    assert.strictEqual(cf.otpType, 'CF');
    assert.strictEqual(cf.snError, true);
    assert.strictEqual(cf.completedUds, undefined);
  });

  test('per-channel streams do not collide for identical response IDs', () => {
    const r = new UdsReconstructor(0x782, 0x78A);
    // Same response CAN ID 0x78A on two channels, interleaved
    r.processMessage(createMsgCh(0x78A, [0x10, 0x09, 0x62, 0x11, 0x11, 0x11, 0x11, 0x11], 0)); // ch0 FF
    r.processMessage(createMsgCh(0x78A, [0x10, 0x09, 0x62, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA], 1)); // ch1 FF
    const ch0 = r.processMessage(createMsgCh(0x78A, [0x21, 0x11, 0x11, 0x11, 0, 0, 0, 0], 0)); // ch0 CF
    const ch1 = r.processMessage(createMsgCh(0x78A, [0x21, 0xAA, 0xAA, 0xAA, 0, 0, 0, 0], 1)); // ch1 CF
    assert.ok(ch0.completedUds && ch1.completedUds);
    assert.deepStrictEqual(Array.from(ch0.completedUds.data), [0x62, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11]);
    assert.deepStrictEqual(Array.from(ch1.completedUds.data), [0x62, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA]);
  });

  test('CAN-FD single-frame escape requires an FD frame (classic 0x00 frame is not escaped)', () => {
    const r = new UdsReconstructor(0x782, 0x78A);
    // Classic 8-byte frame, first byte 0x00 — must NOT be read as an escaped SF
    const classic = r.processMessage(createMsg(0x782, [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]));
    assert.strictEqual(classic.otpType, 'SF');
    assert.strictEqual(classic.completedUds, undefined); // len 0 → no UDS service emitted

    // FD frame with isFd set: escape honoured, real length in byte 1
    const fd: CANMessage = {
      relativeTimestamp: 0.1, absoluteTimestamp: 1000, arbitrationId: 0x782,
      isExtendedId: false, isRemoteFrame: false, isRx: false, dlc: 12,
      data: Buffer.from([0x00, 0x03, 0x10, 0x01, 0x02, 0, 0, 0, 0, 0, 0, 0]),
      channel: 0, isFd: true
    };
    const fdRes = r.processMessage(fd);
    assert.strictEqual(fdRes.otpType, 'SF');
    assert.ok(fdRes.completedUds);
    assert.deepStrictEqual(Array.from(fdRes.completedUds.data), [0x10, 0x01, 0x02]);
  });

  test('malformed short negative response does not throw and is labelled', () => {
    const r = new UdsReconstructor(0x782, 0x78A);
    // 1-byte SF carrying only 0x7F → classified neg, payload too short for SID/NRC
    const info = r.processMessage(createMsg(0x78A, [0x01, 0x7F, 0, 0, 0, 0, 0, 0]));
    assert.ok(info.completedUds);
    assert.strictEqual(info.completedUds.udsType, 'neg');
    // reconstructUdsMessages must annotate without throwing
    const out = reconstructUdsMessages([createMsg(0x78A, [0x01, 0x7F, 0, 0, 0, 0, 0, 0])], 0x782, 0x78A);
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.service, 'NegativeResponse');
    assert.ok(uds.name?.includes('malformed'));
  });

  test('zero-length single frame emits no UDS message', () => {
    const out = reconstructUdsMessages([createMsg(0x782, [0x00, 0, 0, 0, 0, 0, 0, 0])], 0x782, 0x78A);
    assert.strictEqual(out.some(m => m.isUds), false);
    assert.strictEqual(out.filter(m => m.isOtp).length, 1); // raw frame still shown
  });

  test('src/dst use arbitrationId, correct even when a response is TX (ECU-side capture)', () => {
    // Response frame on resCanId but isRx=false (createMsgCh sets isRx only for 0x78A; force via object)
    const ecuSideResponse: CANMessage = {
      relativeTimestamp: 0.1, absoluteTimestamp: 1000, arbitrationId: 0x78A,
      isExtendedId: false, isRemoteFrame: false, isRx: false, dlc: 8, // TX response
      data: Buffer.from([0x02, 0x50, 0x01, 0, 0, 0, 0, 0]), channel: 0
    };
    const out = reconstructUdsMessages([ecuSideResponse], 0x782, 0x78A);
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.src, '78A'); // response → sender is the response ID, regardless of isRx
    assert.strictEqual(uds.dst, '782');
  });

  test('FF_DL 32-bit escape length is honoured', () => {
    const r = new UdsReconstructor(0x782, 0x78A);
    // FF escape: nibble+byte1 == 0, real length in bytes 2..5 = 0x00000009
    const ff = r.processMessage(createMsg(0x78A, [0x10, 0x00, 0x00, 0x00, 0x00, 0x09, 0x62, 0xF1]));
    assert.strictEqual(ff.otpType, 'FF');
    assert.strictEqual(ff.pciLen, 6);
    assert.strictEqual(ff.payloadLen, 2); // bytes 0x62 0xF1
  });
});

suite('reconstructUdsMessages', () => {
  test('derives src/dst from request/response CAN IDs (not hardcoded)', () => {
    const out = reconstructUdsMessages(
      [createMsg(0x123, [0x02, 0x10, 0x01, 0, 0, 0, 0, 0])], // request SF on arbitrary ID 0x123
      0x123, 0x456 // arbitrary IDs — proves no hardcoding
    );
    // createMsg sets isRx only for 0x78A, so this request frame is TX (isRx=false)
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.src, '123'); // sender = request ID
    assert.strictEqual(uds.dst, '456'); // receiver = response ID

    const resOut = reconstructUdsMessages(
      [createMsg(0x78A, [0x02, 0x50, 0x01, 0, 0, 0, 0, 0])], // response SF on 0x78A (isRx=true)
      0x782, 0x78A
    );
    const resUds = resOut.find(m => m.isUds);
    assert.ok(resUds);
    assert.strictEqual(resUds.src, '78A'); // sender = response ID
    assert.strictEqual(resUds.dst, '782'); // receiver = request ID
  });

  test('SF padding rendered in brackets, real payload bare', () => {
    const out = reconstructUdsMessages(
      [createMsg(0x782, [0x02, 0x10, 0x01, 0, 0, 0, 0, 0])],
      0x782, 0x78A
    );
    const otp = out.find(m => m.isOtp && m.otpType === 'SF');
    assert.ok(otp);
    assert.strictEqual(otp.formattedData, '[02] 10 01 [00 00 00 00 00]');
  });

  test('completing CF renders padding correctly (regression: buffers no longer reset before format)', () => {
    const out = reconstructUdsMessages(
      [
        createMsg(0x78A, [0x10, 0x09, 0x62, 0xF1, 0x8C, 0x11, 0x22, 0x33]), // FF
        createMsg(0x782, [0x30, 0x00, 0x00, 0, 0, 0, 0, 0]),                 // FC
        createMsg(0x78A, [0x21, 0x44, 0x55, 0x66, 0xAA, 0xBB, 0xCC, 0xDD]),  // CF completes; only 44 55 66 real
      ],
      0x782, 0x78A
    );
    const cfOtp = out.find(m => m.isOtp && m.otpType === 'CF');
    assert.ok(cfOtp);
    assert.strictEqual(cfOtp.formattedData, '[21] 44 55 66 [AA BB CC DD]');
  });

  test('negative response is labelled with NRC name', () => {
    const out = reconstructUdsMessages(
      [createMsg(0x78A, [0x03, 0x7F, 0x10, 0x13, 0, 0, 0, 0])], // neg: SID 0x10, NRC 0x13
      0x782, 0x78A
    );
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.udsType, 'neg');
    assert.strictEqual(uds.diagId, '7F 10 13');
    assert.ok(uds.name?.includes('incorrectMessageLengthOrInvalidFormat'));
  });

  test('request-side multi-frame reassembles and labels udsType req', () => {
    const out = reconstructUdsMessages(
      [
        createMsg(0x782, [0x10, 0x09, 0x10, 0x01, 0x02, 0x03, 0x04, 0x05]), // FF on request
        createMsg(0x78A, [0x30, 0x00, 0x00, 0, 0, 0, 0, 0]),                // FC from ECU
        createMsg(0x782, [0x21, 0x06, 0x07, 0x08, 0, 0, 0, 0]),             // CF completes
      ],
      0x782, 0x78A
    );
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.udsType, 'req');
    assert.deepStrictEqual(Array.from(uds.data), [0x10, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    assert.strictEqual(uds.src, '782');
    assert.strictEqual(uds.dst, '78A');
  });

  test('intermediate CF (not yet complete) is rendered without completing', () => {
    const out = reconstructUdsMessages(
      [
        createMsg(0x78A, [0x10, 0x0E, 0x62, 0x11, 0x22, 0x33, 0x44, 0x55]), // FF target 14, 6 payload
        createMsg(0x78A, [0x21, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC]), // CF1 +7 = 13 (<14)
        createMsg(0x78A, [0x22, 0xDD, 0x00, 0, 0, 0, 0, 0]),                // CF2 completes (14)
      ],
      0x782, 0x78A
    );
    const cfs = out.filter(m => m.isOtp && m.otpType === 'CF');
    assert.strictEqual(cfs.length, 2);
    // CF1 carries 7 real payload bytes, no padding
    assert.strictEqual(cfs[0].formattedData, '[21] 66 77 88 99 AA BB CC');
    // CF2 carries 1 real byte (0xDD), rest padding
    assert.strictEqual(cfs[1].formattedData, '[22] DD [00 00 00 00 00 00]');
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.data.length, 14);
  });

  test('flow-control frame formatted with PCI + padding, no UDS emitted', () => {
    const out = reconstructUdsMessages(
      [createMsg(0x782, [0x30, 0x00, 0x00, 0, 0, 0, 0, 0])],
      0x782, 0x78A
    );
    const fc = out.find(m => m.isOtp);
    assert.ok(fc);
    assert.strictEqual(fc.otpType, 'FC.CTS');
    assert.strictEqual(fc.formattedData, '[30 00 00] [00 00 00 00 00]');
    assert.strictEqual(out.some(m => m.isUds), false);
  });

  test('non-diagnostic frames pass through untouched', () => {
    const plain = createMsg(0x200, [0x01, 0x02, 0x03, 0, 0, 0, 0, 0]); // neither req nor res ID
    const out = reconstructUdsMessages([plain], 0x782, 0x78A);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0], plain);       // same reference — not copied/annotated
    assert.strictEqual(out[0].isOtp, undefined);
  });

  test('negative response service resolved via CDD SID match', () => {
    const db = parseCddFile(mockCddXml, 'test.cdd');
    const out = reconstructUdsMessages(
      [createMsg(0x78A, [0x03, 0x7F, 0x10, 0x22, 0, 0, 0, 0])], // neg on SID 0x10, NRC 0x22
      0x782, 0x78A, db
    );
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.service, 'Default Session Start'); // matched by SID prefix "10"
    assert.ok(uds.name?.includes('conditionsNotCorrect'));
  });

  test('unknown PCI type falls back to TP', () => {
    const r = new UdsReconstructor(0x782, 0x78A);
    const info = r.processMessage(createMsg(0x782, [0x40, 0x00, 0, 0, 0, 0, 0, 0])); // PCI nibble 4
    assert.strictEqual(info.otpType, 'TP');
    assert.strictEqual(info.completedUds, undefined);
  });

  test('CDD-matched service annotates name/service/diagId', () => {
    const db = parseCddFile(mockCddXml, 'test.cdd');
    const out = reconstructUdsMessages(
      [createMsg(0x782, [0x02, 0x10, 0x01, 0, 0, 0, 0, 0])], // SID 10 sub 01 → "10 01"
      0x782, 0x78A, db
    );
    const uds = out.find(m => m.isUds);
    assert.ok(uds);
    assert.strictEqual(uds.service, 'Default Session Start');
    assert.strictEqual(uds.name, 'Default Session Start::req');
    assert.strictEqual(uds.diagId, '10 01'); // sub paramType → 2-byte key
  });
});

suite('toWire diagnostics', () => {
  test('UDS message maps to typed wire row with service columns', () => {
    const uds: CANMessage = {
      relativeTimestamp: 0.5, absoluteTimestamp: 1000, arbitrationId: 0x78A,
      isExtendedId: false, isRemoteFrame: false, isRx: true, dlc: 2,
      data: Buffer.from([0x50, 0x01]), channel: 0,
      isUds: true, udsType: 'pos', name: 'DSC::pos', service: 'DSC',
      diagId: '50 01', src: '78A', dst: '782', conn: 3
    };
    const w = toWire(uds, 7);
    assert.strictEqual(w.type, 'pos');
    assert.strictEqual(w.msgName, 'DSC::pos');
    assert.strictEqual(w.service, 'DSC');
    assert.strictEqual(w.diagId, '50 01');
    assert.strictEqual(w.src, '78A');
    assert.strictEqual(w.dst, '782');
    assert.strictEqual(w.conn, 3);
    assert.strictEqual(w.isUds, true);
    assert.strictEqual(w.signals, undefined);
  });

  test('OTP raw frame uses formattedData and otpType', () => {
    const otp: CANMessage = {
      relativeTimestamp: 0.5, absoluteTimestamp: 1000, arbitrationId: 0x782,
      isExtendedId: false, isRemoteFrame: false, isRx: false, dlc: 8,
      data: Buffer.from([0x02, 0x10, 0x01, 0, 0, 0, 0, 0]), channel: 0,
      isOtp: true, otpType: 'SF', formattedData: '[02] 10 01 [00 00 00 00 00]', name: '<OTP>'
    };
    const w = toWire(otp, 1);
    assert.strictEqual(w.type, 'SF');
    assert.strictEqual(w.data, '[02] 10 01 [00 00 00 00 00]');
    assert.strictEqual(w.msgName, '<OTP>');
  });
});
