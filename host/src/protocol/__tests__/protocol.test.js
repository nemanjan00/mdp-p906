const protocol = require("..");
const frame = require("../../utils/frame");

const target = { id: [0x11, 0x22, 0x33, 0x44], slot: 0, selected: true };

const hex = (buf) => {
	return buf.toString("hex");
};

test("beacon and handshake builders", () => {
	expect(hex(protocol.beacon())).toBe("05014dc1");
	expect(hex(protocol.handshake({ id: [0, 0, 0, 0], slot: 0, selected: true }, 0x5a73)))
		.toBe("09080000000000015a73a1");
});

test("set voltage / current / output frames", () => {
	const v = frame.parse(protocol.setVoltage(target, 12345));
	expect(v.type).toBe(0x07);
	expect(v.body).toEqual([0x11, 0x22, 0x33, 0x44, 0, 1, 0x03, 3, 0x01, 0x23, 0x45]);

	const i1 = frame.parse(protocol.setCurrent(target, 1500, protocol.MODEL.SUPPLY_5A));
	expect(i1.body.slice(6)).toEqual([0x02, 2, 0x15, 0x00]);
	const i2 = frame.parse(protocol.setCurrent(target, 1500, protocol.MODEL.SUPPLY_10A));
	expect(i2.body.slice(6)).toEqual([0x02, 3, 0x00, 0x15, 0x00]);

	expect(frame.parse(protocol.setOutput(target, true)).body.slice(6)).toEqual([0x0c, 1, 1]);
});

test("assign carries address and channel", () => {
	expect(frame.parse(protocol.assign([0xe0, 0xd3, 0xc2, 0xb1, 0xa0], 78)).body)
		.toEqual([0xe0, 0xd3, 0xc2, 0xb1, 0xa0, 78]);
});

test("handshake reply with calibration", () => {
	const body = [1, 2, 3, 4, 1, 0x01, 0x00, 0x80, 0x00, 0x00, 0x40, 0x7a, 0x12, 2];
	const r = protocol.parseHandshakeReply(body);
	expect(r.id).toEqual([1, 2, 3, 4]);
	expect(r.model).toBe(2);
	expect(r.calibration).toEqual({ vOffset: 0x100, vGain: 0x8000, iOffset: 0x40, iGain: 0x7a12 });
});

test("status parse incl. samples and setpoints", () => {
	const body = [0, 0, 0x02, 0x50, 1, 0x02, 0x40, 0x00, 0x00, 0x00,
		0xab, 0xc1, 0x23, 0, 0, 0, 0, 0, 0, 0, 0, 0,
		0x01, 0x23, 0x45, 0x00, 0x50, 0x00];
	const s = protocol.parseStatus(body);
	expect(s.outputOn).toBe(true);
	expect(s.temperatureC).toBe(25);
	expect(s.inputMv).toBe(24000);
	expect(s.samples[0]).toEqual({ v: 0xabc, i: 0x123 });
	expect(s.setVoltage).toBe(12345);
	expect(s.setCurrent).toBe(5000);
});

test("calibration formula", () => {
	const cal = { vOffset: 0, vGain: 50000, iOffset: 0, iGain: 50000 };
	expect(protocol.calibrate({ v: 100, i: 100 }, cal, protocol.MODEL.SUPPLY_10A)).toEqual({ mV: 800, mA: 400 });
	expect(protocol.calibrate({ v: 1, i: 1 }, { vOffset: 100, vGain: 1, iOffset: 100, iGain: 1 }, 1)).toEqual({ mV: 0, mA: 0 });
});

test("assign reply as seen from a P906", () => {
	expect(protocol.parseAssignReply([0x4f, 0x4b, 0x02])).toEqual({ model: 2 });
	const f = frame.parse(Buffer.from("06034f4b028b" + "00".repeat(26), "hex"));
	expect(f.body).toEqual([0x4f, 0x4b, 0x02]);
});

test("beacon reply (synthetic ID, real layout)", () => {
	const f = frame.parse(Buffer.from("05041234567881" + "00".repeat(25), "hex"));
	expect(protocol.parseBeaconReply(f.body)).toEqual({ id: [0x12, 0x34, 0x56, 0x78] });
});
