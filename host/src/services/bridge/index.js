// Talks to the nRF52840 radio bridge (../bridge) over USB serial. One command
// at a time; each resolves with the reply lines up to its terminator.

// Plain tty I/O instead of node-serialport: with serialport 13 on Node 26
// incoming data was only delivered on the next write (replies ~500 ms late).
const fs = require("fs");
const tty = require("tty");
const execFileSync = require("child_process").execFileSync;
const readline = require("readline");
const wrapper = require("queue-promised").wrapper;

const BAUD = 115200;
const DEFAULT_TIMEOUT_MS = 3000;
const PING_TIMEOUT_MS = 500;
const PING_ATTEMPTS = 10;
const TERMINATORS = [/^OK/, /^ERR/, /^TIMEOUT/, /^RX /];

const isTerminator = (line) => {
	return TERMINATORS.some((re) => {
		return re.test(line);
	});
};

const parseRx = (line) => {
	const parts = line.split(" ");
	return {
		header: parseInt(parts[1], 16),
		duplicate: parts[2] === "DUP",
		payload: Buffer.from(parts[parts.length - 1], "hex")
	};
};

/**
 * Open a bridge.
 * @param {string} path serial device, e.g. /dev/ttyACM0
 */
const open = (path) => {
	// raw mode, no echo; opening the tty raises DTR, which the bridge's USB
	// CDC needs before it talks
	execFileSync("stty", ["-F", path, String(BAUD), "raw", "-echo", "-hupcl"]);
	// non-blocking fd + tty.ReadStream: epoll-driven reads, so nothing sits
	// in a thread-pool read() that would block process exit
	const flags = fs.constants.O_RDWR | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK;
	const fd = fs.openSync(path, flags);
	const input = new tty.ReadStream(fd);
	input.setRawMode(true);
	const lines = readline.createInterface({ input: input });
	let pending = null;

	lines.on("line", (raw) => {
		const line = raw.trim();
		if (!pending || !line) {
			return;
		}
		pending.lines.push(line);
		if (isTerminator(line)) {
			const done = pending;
			pending = null;
			clearTimeout(done.timer);
			done.resolve(done.lines);
		}
	});

	const send = (command, timeoutMs) => {
		return new Promise((resolve, reject) => {
			pending = {
				lines: [],
				resolve: resolve,
				timer: setTimeout(() => {
					pending = null;
					reject(new Error("bridge timeout on: " + command));
				}, timeoutMs || DEFAULT_TIMEOUT_MS)
			};
			fs.writeSync(fd, command + "\n");
		});
	};

	const bridge = {
		_send: wrapper(send, 1),

		configure: (channel, address, order) => {
			const hex = Buffer.from(address).toString("hex").toUpperCase();
			return bridge._send("C " + channel + " " + hex + " " + (order || 0));
		},

		/**
		 * Send one payload and wait up to listenMs for one reply frame.
		 * @param {Buffer} payload frame to send (padded to 32 by the bridge)
		 * @param {number} listenMs how long to listen for the reply
		 * @returns {Promise<{acked: boolean, reply: Object|null}>}
		 */
		exchange: (payload, listenMs) => {
			const hex = payload.toString("hex").toUpperCase();
			return bridge._send("X " + hex + " " + listenMs, listenMs + DEFAULT_TIMEOUT_MS)
				.then((lines) => {
					const rx = lines.find((l) => {
						return l.startsWith("RX ");
					});
					return {
						acked: lines.some((l) => {
							return l.startsWith("ACK");
						}),
						reply: rx ? parseRx(rx) : null
					};
				});
		},

		listen: (ms) => {
			return bridge._send("L " + ms, ms + DEFAULT_TIMEOUT_MS).then((lines) => {
				return lines.filter((l) => {
					return l.startsWith("RX ");
				}).map(parseRx);
			});
		},

		close: () => {
			lines.close();
			input.destroy();
			return Promise.resolve();
		}
	};

	// Right after open the CDC link drops writes for a variable time, so ping
	// until a real reply comes back (also proves the bridge is alive).
	const ping = (attemptsLeft) => {
		return bridge._send("?", PING_TIMEOUT_MS).catch((err) => {
			if (attemptsLeft <= 1) {
				throw new Error("bridge not answering: " + err.message);
			}
			return ping(attemptsLeft - 1);
		});
	};

	return ping(PING_ATTEMPTS).then(() => {
		return bridge;
	});
};

module.exports = {
	open: open
};
