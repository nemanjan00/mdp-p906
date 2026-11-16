// Numeric encodings used on the MDP radio link (mdp/PROTOCOL.md §3).

const BCD5_MAX = 99999;
const BCD4_MAX = 9999;
const BCD6_MAX = 999999;

const packPair = (high, low) => {
	return (high << 4) | low;
};

const unpackPair = (byte) => {
	return (byte >> 4) * 10 + (byte & 0x0f);
};

const checkRange = (value, max) => {
	if (!Number.isInteger(value) || value < 0 || value > max) {
		throw new RangeError("value " + value + " out of range 0.." + max);
	}
};

const digits = (value, count) => {
	return String(value).padStart(count, "0").split("").map(Number);
};

const bcd = {
	// 4 digits in 2 packed bytes: 1234 -> 12 34
	encode4: (value) => {
		checkRange(value, BCD4_MAX);
		const d = digits(value, 4);
		return [packPair(d[0], d[1]), packPair(d[2], d[3])];
	},

	decode4: (bytes) => {
		return unpackPair(bytes[0]) * 100 + unpackPair(bytes[1]);
	},

	// 5 digits in 3 bytes; first byte is a plain 0-9 digit: 12345 -> 01 23 45
	encode5: (value) => {
		checkRange(value, BCD5_MAX);
		const d = digits(value, 5);
		return [d[0], packPair(d[1], d[2]), packPair(d[3], d[4])];
	},

	decode5: (bytes) => {
		return bytes[0] * 10000 + unpackPair(bytes[1]) * 100 + unpackPair(bytes[2]);
	},

	// 6 digits in 3 packed bytes: 123456 -> 12 34 56
	encode6: (value) => {
		checkRange(value, BCD6_MAX);
		const d = digits(value, 6);
		return [packPair(d[0], d[1]), packPair(d[2], d[3]), packPair(d[4], d[5])];
	},

	decode6: (bytes) => {
		return unpackPair(bytes[0]) * 10000 + unpackPair(bytes[1]) * 100 + unpackPair(bytes[2]);
	}
};

module.exports = bcd;
