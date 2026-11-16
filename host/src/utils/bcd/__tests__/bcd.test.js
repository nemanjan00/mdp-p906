const bcd = require("..");

test("bcd5 round trip and layout", () => {
	expect(bcd.encode5(12345)).toEqual([0x01, 0x23, 0x45]);
	expect(bcd.encode5(5000)).toEqual([0x00, 0x50, 0x00]);
	expect(bcd.decode5([0x03, 0x00, 0x00])).toBe(30000);
	[0, 1, 99, 3300, 99999].forEach((v) => {
		expect(bcd.decode5(bcd.encode5(v))).toBe(v);
	});
});

test("bcd4 and bcd6", () => {
	expect(bcd.encode4(1234)).toEqual([0x12, 0x34]);
	expect(bcd.decode4([0x99, 0x01])).toBe(9901);
	expect(bcd.encode6(123456)).toEqual([0x12, 0x34, 0x56]);
	expect(bcd.decode6([0x00, 0x10, 0x00])).toBe(1000);
});

test("out of range throws", () => {
	expect(() => bcd.encode5(100000)).toThrow(RangeError);
	expect(() => bcd.encode4(-1)).toThrow(RangeError);
	expect(() => bcd.encode5(1.5)).toThrow(RangeError);
});
