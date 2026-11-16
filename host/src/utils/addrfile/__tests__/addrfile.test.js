const addrfile = require("..");

test("default slot address, channel 78", () => {
	expect(addrfile.build([0xe0, 0xd3, 0xc2, 0xb1, 0xa0], 78))
		.toBe("Addr=A0:B1:C2:D3:E0\r\nFreq[2405,2478]MHz=2478\r\n");
});

test("rejects frequencies outside the module's band", () => {
	expect(() => addrfile.build([1, 2, 3, 4, 5], 100)).toThrow(RangeError);
});
