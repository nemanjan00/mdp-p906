// Radio frame: [type, len, body..., check], 32 bytes on air, zero padded.
// check = XOR of type, len and body, then XOR 0x88 (mdp/PROTOCOL.md §3).

const FRAME_SIZE = 32;
const CHECK_SEED = 0x88;
const MAX_BODY = FRAME_SIZE - 3;

const checksum = (bytes) => {
	return bytes.reduce((acc, b) => {
		return acc ^ b;
	}, CHECK_SEED);
};

const frame = {
	FRAME_SIZE: FRAME_SIZE,

	checksum: checksum,

	/**
	 * Build a frame (without padding; the bridge pads to 32).
	 * @param {number} type message type
	 * @param {number[]} body body bytes
	 * @returns {Buffer}
	 */
	build: (type, body) => {
		if (body.length > MAX_BODY) {
			throw new RangeError("body too long: " + body.length);
		}
		const head = [type, body.length].concat(body);
		return Buffer.from(head.concat([checksum(head)]));
	},

	/**
	 * Parse a received frame. Returns null when length or check is wrong.
	 * @param {Buffer|number[]} bytes raw 32-byte payload
	 * @returns {{type: number, body: number[], raw: number[]}|null}
	 */
	parse: (bytes) => {
		const raw = Array.from(bytes);
		const len = raw[1];
		if (raw.length < 3 || len > MAX_BODY || len + 3 > raw.length) {
			return null;
		}
		const head = raw.slice(0, len + 2);
		if (checksum(head) !== raw[len + 2]) {
			return null;
		}
		return {
			type: raw[0],
			body: raw.slice(2, len + 2),
			raw: raw
		};
	}
};

module.exports = frame;
