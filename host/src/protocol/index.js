// MDP radio messages, built from mdp/PROTOCOL.md §4-§7. All meanings are
// [INF] there until confirmed on hardware.

const frame = require("../utils/frame");
const bcd = require("../utils/bcd");

const TYPE = {
	BEACON: 0x05,
	ASSIGN: 0x06,
	POLL: 0x07,
	SAMPLES: 0x08,
	HANDSHAKE: 0x09,
	POLL_LOAD: 0x0a
};

const CODE = {
	CURRENT: 0x02,
	VOLTAGE: 0x03,
	OUTPUT: 0x0c
};

const MODEL = {
	SUPPLY_5A: 1,
	SUPPLY_10A: 2,
	LOAD: 3
};

const BEACON_MAGIC = 0x4d;
const CAL_DIVISOR = 100000;
const SAMPLE_COUNT = 4;

/**
 * @typedef {Object} Target
 * @property {number[]} id module's 4-byte ID ([0,0,0,0] if unknown)
 * @property {number} slot 0-5
 * @property {boolean} selected whether this slot is the "shown" one
 */

const header = (target) => {
	return target.id.concat([target.slot, target.selected ? 1 : 0]);
};

const sliceBcd5 = (body, at) => {
	return bcd.decode5(body.slice(at, at + 3));
};

const sliceBcd4 = (body, at) => {
	return bcd.decode4(body.slice(at, at + 2));
};

const unpackPair = (byte) => {
	return (byte >> 4) * 10 + (byte & 0x0f);
};

const word = (body, at) => {
	return (body[at] << 8) | body[at + 1];
};

const decodeSamples = (body, at) => {
	return Array.from({ length: SAMPLE_COUNT }, (_, i) => {
		const b = body.slice(at + i * 3, at + i * 3 + 3);
		return {
			v: (b[0] << 4) | (b[1] >> 4),
			i: ((b[1] & 0x0f) << 8) | b[2]
		};
	});
};

const protocol = {
	TYPE: TYPE,
	CODE: CODE,
	MODEL: MODEL,

	beacon: () => {
		return frame.build(TYPE.BEACON, [BEACON_MAGIC]);
	},

	/**
	 * Pairing step 2: give the module its address and channel.
	 * @param {number[]} address 5 bytes, nRF24 SPI order (LSB first)
	 * @param {number} channel RF channel (2400 + n MHz)
	 */
	assign: (address, channel) => {
		return frame.build(TYPE.ASSIGN, address.concat([channel]));
	},

	/**
	 * @param {Target} target
	 * @param {number} slotWord per-slot u16 the M01 sends (meaning unknown)
	 */
	handshake: (target, slotWord) => {
		return frame.build(TYPE.HANDSHAKE, header(target).concat([(slotWord >> 8) & 0xff, slotWord & 0xff]));
	},

	poll: (target, model) => {
		if (model === MODEL.LOAD) {
			return frame.build(TYPE.POLL_LOAD, header(target));
		}
		return frame.build(TYPE.POLL, header(target));
	},

	/**
	 * Poll that also sets one parameter.
	 * @param {Target} target
	 * @param {number} code parameter code (CODE.*)
	 * @param {number[]} value encoded value bytes
	 */
	set: (target, code, value) => {
		return frame.build(TYPE.POLL, header(target).concat([code, value.length]).concat(value));
	},

	setVoltage: (target, millivolts) => {
		return protocol.set(target, CODE.VOLTAGE, bcd.encode5(millivolts));
	},

	setCurrent: (target, milliamps, model) => {
		if (model === MODEL.SUPPLY_5A) {
			return protocol.set(target, CODE.CURRENT, bcd.encode4(milliamps));
		}
		return protocol.set(target, CODE.CURRENT, bcd.encode5(milliamps));
	},

	setOutput: (target, on) => {
		return protocol.set(target, CODE.OUTPUT, [on ? 1 : 0]);
	},

	parseBeaconReply: (body) => {
		return { id: body.slice(0, 4) };
	},

	// [HW] P906 sent body 4F 4B 02: "OK" + model.
	parseAssignReply: (body) => {
		if (body.length === 3) {
			return { model: body[2] };
		}
		if (body.length === 2) {
			return { model: MODEL.SUPPLY_5A };
		}
		return { model: null };
	},

	parseHandshakeReply: (body) => {
		const result = {
			id: body.slice(0, 4),
			state: body[4],
			model: null,
			calibration: null
		};
		if (body.length === 14) {
			result.calibration = {
				vOffset: word(body, 5),
				vGain: word(body, 7),
				iOffset: word(body, 9),
				iGain: word(body, 11)
			};
			result.model = body[13];
		} else if (body.length === 6) {
			result.model = body[5];
		} else if (body.length === 5 || body.length === 13) {
			result.model = MODEL.SUPPLY_5A;
		}
		return result;
	},

	// Body offsets are frame offsets - 2 (see the status table in PROTOCOL.md).
	parseStatus: (body) => {
		// layout confirmed from both the M01 parser and the P906 builder
		// (P906 @0x8016B2C) [INF]
		const result = {
			stateA: body[0],
			stateB: body[1],
			temperatureC: (body[2] * 100 + unpackPair(body[3])) / 10,
			outputOn: body[4] !== 0 && body[4] !== 0xff,
			inputMv: sliceBcd5(body, 5),
			unknownBcd4: sliceBcd4(body, 8),
			samples: decodeSamples(body, 10),
			setVoltage: null,
			setCurrent: null
		};
		if (body.length >= 0x17) {
			result.setVoltage = sliceBcd5(body, 22);
			if (body.length === 28) {
				result.setCurrent = sliceBcd5(body, 25);
			} else {
				result.setCurrent = sliceBcd4(body, 25);
			}
		}
		return result;
	},

	/**
	 * Convert one raw sample to millivolts / milliamps using the handshake
	 * calibration words.
	 * @param {{v: number, i: number}} sample raw 12-bit values
	 * @param {{vOffset: number, vGain: number, iOffset: number, iGain: number}} cal
	 * @param {number} model MODEL.*
	 */
	calibrate: (sample, cal, model) => {
		const scale = (raw, offset, gain) => {
			if (raw <= offset) {
				return 0;
			}
			return (raw - offset) * gain / CAL_DIVISOR;
		};
		const volts = scale(sample.v * 16, cal.vOffset, cal.vGain);
		const amps = scale(sample.i * 4, cal.iOffset, cal.iGain);
		return {
			mV: Math.round(volts),
			mA: Math.round(model === MODEL.SUPPLY_10A ? amps * 2 : amps)
		};
	}
};

module.exports = protocol;
