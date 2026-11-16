// Repeat a promise-returning step until it yields a value or time runs out.

/**
 * @param {Function} step returns a Promise of a value, or of null to retry
 * @param {number} durationMs give up after this long (resolves null)
 */
const until = (step, durationMs) => {
	const deadline = Date.now() + durationMs;
	const attempt = () => {
		if (Date.now() > deadline) {
			return Promise.resolve(null);
		}
		return step().then((value) => {
			if (value !== null && value !== undefined) {
				return value;
			}
			return attempt();
		});
	};
	return attempt();
};

const sleep = (ms) => {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
};

module.exports = {
	until: until,
	sleep: sleep
};
