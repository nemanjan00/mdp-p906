const frame = require("..");

test("build computes xor ^ 0x88", () => {
	expect(frame.build(0x05, [0x4d]).toString("hex")).toBe("05014dc1");
});

test("parse accepts padded frame and rejects bad check", () => {
	const built = Array.from(frame.build(0x09, [1, 2, 3, 4, 0, 1, 0x5a, 0x73]));
	const padded = built.concat(new Array(32 - built.length).fill(0));
	const parsed = frame.parse(padded);
	expect(parsed.type).toBe(0x09);
	expect(parsed.body).toEqual([1, 2, 3, 4, 0, 1, 0x5a, 0x73]);

	const broken = padded.slice();
	broken[3] ^= 1;
	expect(frame.parse(broken)).toBeNull();
});

test("parse rejects impossible length", () => {
	expect(frame.parse([0x07, 0x40].concat(new Array(30).fill(0)))).toBeNull();
});
