#!/usr/bin/env node
// mdp — control MDP P90x power modules through the nRF52840 bridge.
//
//   mdp pair                      pair a module (it must be in pairing)
//   mdp handshake | status
//   mdp set-voltage <mV> | set-current <mA> | output on|off
//   mdp listen [ms] | raw <hex> [ms]
//   mdp addr-file                 print RX_ADDR.TXT for --addr/--ch (no device I/O)
// Options: --port --ch --addr <hex5> --order 0|1 --slot --id <hex4> --model
//          --window <s> (pair: how long to keep trying, default 120)
//          --direct (pair: skip the beacon, just repeat the assign)

const parseArgs = require("node:util").parseArgs;
const bridgeService = require("../src/services/bridge");
const psuModule = require("../src/psu");
const frame = require("../src/utils/frame");
const addrfile = require("../src/utils/addrfile");

const DEFAULT_PORT = "/dev/ttyACM0";

const args = parseArgs({
	allowPositionals: true,
	options: {
		port: { type: "string", default: DEFAULT_PORT },
		ch: { type: "string", default: String(psuModule.DEFAULT_CHANNEL) },
		addr: { type: "string", default: Buffer.from(psuModule.DEFAULT_ADDRESS).toString("hex") },
		order: { type: "string", default: "0" },
		slot: { type: "string", default: "0" },
		id: { type: "string", default: "00000000" },
		model: { type: "string", default: "2" },
		window: { type: "string", default: "120" },
		direct: { type: "boolean", default: false }
	}
});

const command = args.positionals[0];
const params = args.positionals.slice(1);

const link = {
	channel: Number(args.values.ch),
	address: Array.from(Buffer.from(args.values.addr, "hex")),
	order: Number(args.values.order),
	slot: Number(args.values.slot),
	id: Array.from(Buffer.from(args.values.id, "hex")),
	model: Number(args.values.model)
};

const print = (value) => {
	console.log(JSON.stringify(value, null, 2));
};

const run = (psu, bridge) => {
	if (command === "pair") {
		return psu.pair((msg) => {
			console.error(new Date().toISOString() + " " + msg);
		}, Number(args.values.window) * 1000, { direct: args.values.direct }).then((hs) => {
			print({ link: psu.link, handshake: hs });
		});
	}
	if (command === "listen") {
		return bridge.configure(link.channel, link.address, link.order).then(() => {
			return bridge.listen(Number(params[0] || 2000));
		}).then((packets) => {
			print(packets.map((p) => {
				return { header: p.header, duplicate: p.duplicate, frame: frame.parse(p.payload), raw: p.payload.toString("hex") };
			}));
		});
	}
	if (command === "raw") {
		return psu.useLink().then(() => {
			return bridge.exchange(Buffer.from(params[0], "hex"), Number(params[1] || 100));
		}).then((result) => {
			print({ acked: result.acked, reply: result.reply && result.reply.payload.toString("hex") });
		});
	}
	const actions = {
		handshake: () => {
			return psu.handshake();
		},
		status: () => {
			return psu.handshake().then(() => {
				return psu.status();
			});
		},
		"set-voltage": () => {
			return psu.setVoltage(Number(params[0]));
		},
		"set-current": () => {
			return psu.setCurrent(Number(params[0]));
		},
		output: () => {
			return psu.setOutput(params[0] === "on");
		}
	};
	if (!actions[command]) {
		return Promise.reject(new Error("unknown command: " + command));
	}
	return psu.useLink().then(() => {
		return actions[command]();
	}).then((result) => {
		if (result === null) {
			throw new Error("no reply from module");
		}
		print(result);
	});
};

if (command === "addr-file") {
	process.stdout.write(addrfile.build(link.address, link.channel));
	process.exit(0);
}

bridgeService.open(args.values.port)
	.then((bridge) => {
		const psu = psuModule.create(bridge, link);
		return run(psu, bridge)
			.then(() => {
				return bridge.close();
			}, (err) => {
				return bridge.close().then(() => {
					throw err;
				});
			});
	})
	.then(() => {
		// a pending blocking tty read keeps the event loop alive
		process.exit(0);
	}, (err) => {
		console.error("error: " + err.message);
		process.exit(1);
	});
