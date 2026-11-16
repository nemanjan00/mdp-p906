// High-level P90x control over a bridge: pairing (mimicking the M01),
// handshake, status and setters. Flow per mdp/PROTOCOL.md §2, §7.

const protocol = require("../protocol");
const frame = require("../utils/frame");
const retry = require("../utils/retry");

const PAIR_ADDRESS = [0xff, 0xff, 0xff, 0xff, 0xff];
const PAIR_CHANNEL = 78;
const DEFAULT_ADDRESS = [0xe0, 0xd3, 0xc2, 0xb1, 0xa0];
const DEFAULT_CHANNEL = 78;
const SLOT_WORD = 0x5a73;
const LISTEN_MS = 60;
const PAIR_WINDOW_MS = 120000;
// The M01 waits up to 300 ms for each pairing reply and tries 4 times before
// falling back to beaconing (@0x80237DA) [INF]; 60 ms was too short [HW].
const PAIR_REPLY_MS = 300;
// [HW] after replying to a beacon the module ignores frames for ~1.4 s, and
// waits 7 s for the assign (P906 @0x80166D8) — so keep trying ~5 s.
const ASSIGN_TRIES = 16;
const POST_OK_BEACON_MS = 3000;
const HANDSHAKE_WINDOW_MS = 15000;

const replyOfType = (result, type) => {
	if (!result.reply) {
		return null;
	}
	const parsed = frame.parse(result.reply.payload);
	if (!parsed || parsed.type !== type) {
		return null;
	}
	return parsed;
};

/**
 * @param {Object} bridge from services/bridge
 * @param {{channel: number, address: number[], order: number, slot: number, id: number[], model: number}} link
 */
const create = (bridge, link) => {
	const target = () => {
		return { id: link.id, slot: link.slot, selected: true };
	};

	const request = (payload, type) => {
		return bridge.exchange(payload, LISTEN_MS).then((result) => {
			return replyOfType(result, type);
		});
	};

	const psu = {
		link: link,

		useLink: () => {
			return bridge.configure(link.channel, link.address, link.order);
		},

		/**
		 * Pair a module that is in its "Tx and Rx Addr" → SET screen.
		 * @param {function(string)} log progress callback
		 * @param {number} [windowMs] how long to keep trying
		 * @param {{direct: boolean}} [options] direct: skip the beacon step
		 */
		pair: (log, windowMs, options) => {
			const deadline = Date.now() + (windowMs || PAIR_WINDOW_MS);

			// log every pairing exchange: what we sent, whether the module's
			// radio ACKed it, and any raw reply
			const trace = (payload, result) => {
				let reply = "none";
				if (result.reply) {
					reply = result.reply.payload.toString("hex").slice(0, 16);
					if (result.reply.duplicate) {
						reply = reply + " DUP";
					}
				}
				log("tx " + payload.toString("hex") + " ack=" + (result.acked ? 1 : 0) + " rx=" + reply);
			};

			const pairRequest = (payload, type) => {
				return bridge.exchange(payload, PAIR_REPLY_MS).then((result) => {
					trace(payload, result);
					return replyOfType(result, type);
				});
			};

			const assign = (triesLeft) => {
				if (triesLeft === 0) {
					return Promise.resolve(null);
				}
				return pairRequest(protocol.assign(link.address, link.channel), protocol.TYPE.ASSIGN)
					.then((reply) => {
						if (reply) {
							return reply;
						}
						return assign(triesLeft - 1);
					});
			};

			// beacon until a module answers, assign, and go back to
			// beaconing if the assign isn't confirmed
			const attempt = () => {
				return retry.until(() => {
					return bridge.exchange(protocol.beacon(), PAIR_REPLY_MS).then((result) => {
						if (result.acked || result.reply) {
							trace(protocol.beacon(), result);
						}
						return replyOfType(result, protocol.TYPE.BEACON);
					});
				}, deadline - Date.now())
					.then((reply) => {
						if (!reply) {
							throw new Error("no module confirmed pairing in time");
						}
						link.id = protocol.parseBeaconReply(reply.body).id;
						log("module id " + Buffer.from(link.id).toString("hex") + ", assigning address");
						return assign(ASSIGN_TRIES);
					})
					.then((reply) => {
						if (!reply) {
							log("assign not confirmed, beaconing again");
							return attempt();
						}
						return reply;
					});
			};

			// The module's assign handler needs only its "Match RX Addr.."
			// screen, not a prior beacon (P906 @0x80166D8), so --direct just
			// repeats the assign until the module answers "OK".
			const direct = () => {
				return retry.until(() => {
					return pairRequest(protocol.assign(link.address, link.channel), protocol.TYPE.ASSIGN);
				}, deadline - Date.now()).then((reply) => {
					if (!reply) {
						throw new Error("no module confirmed the address in time");
					}
					return reply;
				});
			};

			return bridge.configure(PAIR_CHANNEL, PAIR_ADDRESS, 0)
				.then(() => {
					if (options && options.direct) {
						log("sending assign on pairing address; press SET on the module");
						return direct();
					}
					log("beaconing on pairing address; press SET on the module");
					return attempt();
				})
				.then((reply) => {
					link.model = protocol.parseAssignReply(reply.body).model;
					log("module confirmed address, model " + link.model);
					// the M01 keeps beaconing after the OK before it starts polling
					return retry.until(() => {
						return bridge.exchange(protocol.beacon(), PAIR_REPLY_MS).then(() => {
							return null;
						});
					}, POST_OK_BEACON_MS);
				})
				.then(() => {
					return psu.useLink();
				})
				.then(() => {
					log("handshaking on the new address");
					return retry.until(() => {
						return psu.handshake();
					}, HANDSHAKE_WINDOW_MS);
				})
				.then((hs) => {
					if (!hs) {
						throw new Error("module confirmed pairing but does not answer on the new address");
					}
					return hs;
				});
		},

		handshake: () => {
			return request(protocol.handshake(target(), SLOT_WORD), protocol.TYPE.HANDSHAKE).then((reply) => {
				if (!reply) {
					return null;
				}
				const hs = protocol.parseHandshakeReply(reply.body);
				if (hs.calibration) {
					link.calibration = hs.calibration;
				}
				if (hs.model) {
					link.model = hs.model;
				}
				return hs;
			});
		},

		status: () => {
			return request(protocol.poll(target(), link.model), protocol.TYPE.POLL).then((reply) => {
				if (!reply) {
					return null;
				}
				const status = protocol.parseStatus(reply.body);
				if (link.calibration) {
					status.measured = status.samples.map((sample) => {
						return protocol.calibrate(sample, link.calibration, link.model);
					});
				}
				return status;
			});
		},

		setVoltage: (millivolts) => {
			return request(protocol.setVoltage(target(), millivolts), protocol.TYPE.POLL);
		},

		setCurrent: (milliamps) => {
			return request(protocol.setCurrent(target(), milliamps, link.model), protocol.TYPE.POLL);
		},

		setOutput: (on) => {
			return request(protocol.setOutput(target(), on), protocol.TYPE.POLL);
		}
	};

	return psu;
};

module.exports = {
	create: create,
	DEFAULT_ADDRESS: DEFAULT_ADDRESS,
	DEFAULT_CHANNEL: DEFAULT_CHANNEL
};
