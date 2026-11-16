// RX_ADDR.TXT as the P906 reads it from its USB drive at boot
// (mdp/PROTOCOL.md §0b): address bytes printed MSB first, then the
// frequency in MHz. Address is given in nRF24 SPI order (LSB first).

const BAND_LOW_MHZ = 2405;
const BAND_HIGH_MHZ = 2478;
const BASE_MHZ = 2400;

const hex = (byte) => {
	return byte.toString(16).toUpperCase().padStart(2, "0");
};

/**
 * @param {number[]} address 5 bytes, nRF24 SPI order (LSB first)
 * @param {number} channel RF channel (MHz - 2400)
 * @returns {string} file contents
 */
const build = (address, channel) => {
	const mhz = BASE_MHZ + channel;
	if (mhz < BAND_LOW_MHZ || mhz > BAND_HIGH_MHZ) {
		throw new RangeError("frequency " + mhz + " MHz outside " + BAND_LOW_MHZ + "-" + BAND_HIGH_MHZ);
	}
	const msbFirst = address.slice().reverse().map(hex).join(":");
	return "Addr=" + msbFirst + "\r\n" +
		"Freq[" + BAND_LOW_MHZ + "," + BAND_HIGH_MHZ + "]MHz=" + mhz + "\r\n";
};

module.exports = {
	build: build
};
