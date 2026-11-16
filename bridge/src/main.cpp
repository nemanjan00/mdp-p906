// MDP radio bridge: nRF52840 RADIO driven as an nRF24L01-compatible
// Enhanced ShockBurst endpoint (2 Mbps, 5-byte address, CRC16, auto-ACK).
// Framing/semantics of the MDP protocol live in the host tool; this only
// moves 32-byte payloads. See mdp/PROTOCOL.md §1 and mdp/BRIDGE.md.
//
// Serial commands (one per line, hex without separators):
//   C <ch> <addr5> [order]   set channel + address (address bytes in nRF24
//                            SPI write order, LSB first); order 1 = reversed
//   X <hex> [rx_ms]          send payload (padded to 32), wait for ACK
//                            (with retries), then listen rx_ms for one reply
//   L <ms>                   listen only, print every packet heard
//   P <ack-bit>              S1 no-ack bit value to send (default 1)
//   A <mode>                 ACK header: 0 = length bits 0, 1 = echo sender's
//   D <us>                   delay before sending an ACK (default 130)
//   S                        print and reset received/duplicate counters
//   B                        reboot into the UF2 bootloader
//   ?                        print config
// Replies: "OK ...", "ACK n" / "NOACK", "RX <pid> <hex32>", "TIMEOUT", "ERR ..."
#include <Arduino.h>
#include <Adafruit_TinyUSB.h>

static uint8_t ch = 78;
static uint8_t addr[5] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static uint8_t order = 0;
static uint8_t ackbit = 1;
static uint8_t pid = 0;
static uint8_t last_rx_pid = 0xFF;

// RAM packet buffer: S0/LENGTH/S1 header bytes + payload.
static uint8_t pkt[2 + 32 + 2];

// Cycle-counter time base (64 MHz); works with interrupts disabled, unlike
// micros() on this core.
static inline uint32_t cyc() { return DWT->CYCCNT; }
static inline bool cyc_expired(uint32_t t0, uint32_t us) { return cyc() - t0 > us * 64; }

static void wdt_feed() { NRF_WDT->RR[0] = WDT_RR_RR_Reload; }

static uint8_t rev8(uint8_t b) {
  b = (b & 0xF0) >> 4 | (b & 0x0F) << 4;
  b = (b & 0xCC) >> 2 | (b & 0x33) << 2;
  b = (b & 0xAA) >> 1 | (b & 0x55) << 1;
  return b;
}

// nRF24 sends the address MSByte first, MSbit first; the nRF52 sends
// BASE (LSbit first) then PREFIX. So the on-air bit string matches when
// PREFIX = rev8(LSB) and BASE bytes are the remaining bytes, bit-reversed,
// with the address MSByte in BASE's lowest byte.
static void apply_address() {
  uint8_t a[5];
  for (int i = 0; i < 5; i++) a[i] = order ? addr[4 - i] : addr[i];
  NRF_RADIO->PREFIX0 = rev8(a[0]);
  NRF_RADIO->BASE0 = (uint32_t)rev8(a[1]) << 24 | (uint32_t)rev8(a[2]) << 16 |
                     (uint32_t)rev8(a[3]) << 8 | rev8(a[4]);
  NRF_RADIO->TXADDRESS = 0;
  NRF_RADIO->RXADDRESSES = 1;
  NRF_RADIO->FREQUENCY = ch;
}

// Dynamic-length layout (LENGTH 6 bits + S1 3 bits = PID,NO_ACK): used to
// send data/ACKs and to receive ACKs.
static void fmt_dpl() {
  NRF_RADIO->PCNF0 = (6 << RADIO_PCNF0_LFLEN_Pos) | (3 << RADIO_PCNF0_S1LEN_Pos);
  NRF_RADIO->PCNF1 = (RADIO_PCNF1_ENDIAN_Big << RADIO_PCNF1_ENDIAN_Pos) |
                     (4 << RADIO_PCNF1_BALEN_Pos) | (32 << RADIO_PCNF1_MAXLEN_Pos);
}

// Static layout for receiving the module's data: 8 header bits as S0
// (6 length bits, whatever the sender put there, + PID), 1 bit S1, then
// exactly 32 payload bytes.
static void fmt_static() {
  NRF_RADIO->PCNF0 = (1 << RADIO_PCNF0_S0LEN_Pos) | (1 << RADIO_PCNF0_S1LEN_Pos);
  NRF_RADIO->PCNF1 = (RADIO_PCNF1_ENDIAN_Big << RADIO_PCNF1_ENDIAN_Pos) |
                     (4 << RADIO_PCNF1_BALEN_Pos) | (32 << RADIO_PCNF1_STATLEN_Pos) |
                     (32 << RADIO_PCNF1_MAXLEN_Pos);
}

// Every busy-wait is capped so a misconfigured radio can't wedge the
// board (it also has a watchdog).
#define SPIN_MAX 2000000u
#define WAIT(cond) do { uint32_t _n = 0; while (!(cond) && ++_n < SPIN_MAX) {} } while (0)

static void radio_disable() {
  NRF_RADIO->SHORTS = 0;
  NRF_RADIO->EVENTS_DISABLED = 0;
  NRF_RADIO->TASKS_DISABLE = 1;
  WAIT(NRF_RADIO->EVENTS_DISABLED);
  NRF_RADIO->EVENTS_DISABLED = 0;
}

static void radio_init() {
  NRF_CLOCK->EVENTS_HFCLKSTARTED = 0;
  NRF_CLOCK->TASKS_HFCLKSTART = 1;
  WAIT(NRF_CLOCK->EVENTS_HFCLKSTARTED);
  NRF_RADIO->POWER = 1;
  NRF_RADIO->MODE = RADIO_MODE_MODE_Nrf_2Mbit;
  NRF_RADIO->MODECNF0 = RADIO_MODECNF0_RU_Fast;
  NRF_RADIO->TXPOWER = RADIO_TXPOWER_TXPOWER_0dBm;
  NRF_RADIO->CRCCNF = RADIO_CRCCNF_LEN_Two;  // address included
  NRF_RADIO->CRCINIT = 0xFFFF;
  NRF_RADIO->CRCPOLY = 0x11021;
  NRF_RADIO->PACKETPTR = (uint32_t)pkt;
  apply_address();
}

// Start TX of whatever is in pkt; block until END. Radio ends DISABLED.
static void tx_now() {
  NRF_RADIO->EVENTS_END = 0;
  NRF_RADIO->EVENTS_DISABLED = 0;
  NRF_RADIO->SHORTS = RADIO_SHORTS_READY_START_Msk | RADIO_SHORTS_END_DISABLE_Msk;
  NRF_RADIO->TASKS_TXEN = 1;
  WAIT(NRF_RADIO->EVENTS_DISABLED);
  NRF_RADIO->EVENTS_DISABLED = 0;
}

// Receive one packet within timeout_us. Returns true with CRC ok.
static bool rx_wait(uint32_t timeout_us) {
  NRF_RADIO->EVENTS_END = 0;
  NRF_RADIO->EVENTS_DISABLED = 0;
  NRF_RADIO->SHORTS = RADIO_SHORTS_READY_START_Msk | RADIO_SHORTS_END_DISABLE_Msk;
  NRF_RADIO->TASKS_RXEN = 1;
  uint32_t t0 = cyc();
  uint32_t n = 0;
  while (!NRF_RADIO->EVENTS_END) {
    // the spin cap backs up the cycle counter in case it isn't running
    if (cyc_expired(t0, timeout_us) || ++n > timeout_us * 16) {
      radio_disable();
      return false;
    }
  }
  WAIT(NRF_RADIO->EVENTS_DISABLED);
  NRF_RADIO->EVENTS_DISABLED = 0;
  return NRF_RADIO->CRCSTATUS == 1;
}

// Zero-payload static layout: ACK packets (sent and received).
static void fmt_ack() {
  NRF_RADIO->PCNF0 = (1 << RADIO_PCNF0_S0LEN_Pos) | (1 << RADIO_PCNF0_S1LEN_Pos);
  NRF_RADIO->PCNF1 = (RADIO_PCNF1_ENDIAN_Big << RADIO_PCNF1_ENDIAN_Pos) |
                     (4 << RADIO_PCNF1_BALEN_Pos) | (0 << RADIO_PCNF1_STATLEN_Pos) |
                     (32 << RADIO_PCNF1_MAXLEN_Pos);
}

// ACK mode 0: length bits 0; mode 1: echo the length bits the module sent
// (it was seen sending 0b110011 there, not 32) [HW].
static uint8_t ackmode = 1;

// An nRF24 PTX needs ~130 us after its packet to switch to RX; a real PRX
// answers no sooner. Our fast ramp-up would put the ACK on air while the
// module is still switching, so wait before sending it.
static uint32_t ack_delay_us = 130;
static uint32_t rx_count = 0, dup_count = 0;

static void send_ack(uint8_t rx_hdr) {
  uint32_t t0 = cyc();
  fmt_ack();
  if (ackmode) pkt[0] = rx_hdr;
  else pkt[0] = rx_hdr & 3;
  pkt[1] = 0;
  while (!cyc_expired(t0, ack_delay_us)) {}
  tx_now();
}

// One data packet from the module (static layout). Prints and ACKs it.
static bool rx_data(uint32_t timeout_us) {
  fmt_static();
  if (!rx_wait(timeout_us)) return false;
  // The ACK must go out within the sender's ACK window (~250 us), so do it
  // before anything slow; interrupts stay on, USB ISRs are short.
  uint8_t rpid = pkt[0] & 3;
  uint8_t hdr = pkt[0];
  uint8_t data[32];
  memcpy(data, &pkt[2], 32);
  send_ack(hdr);
  bool dup = rpid == last_rx_pid;
  last_rx_pid = rpid;
  rx_count++;
  if (dup) dup_count++;
  Serial.printf("RX %02X%s ", hdr, dup ? " DUP" : "");
  for (int i = 0; i < 32; i++) Serial.printf("%02X", data[i]);
  Serial.println();
  return true;
}

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static int parse_hex(const char *s, uint8_t *out, int max) {
  int n = 0;
  while (s[0] && s[1] && n < max) {
    int h = hexval(s[0]), l = hexval(s[1]);
    if (h < 0 || l < 0) break;
    out[n++] = h << 4 | l;
    s += 2;
  }
  return n;
}

static void cmd_x(const char *hex, uint32_t rx_ms) {
  uint8_t payload[32] = {0};
  int n = parse_hex(hex, payload, 32);
  if (n == 0) { Serial.println("ERR payload"); return; }
  pid = (pid + 1) & 3;
  bool acked = false;
  int tries;
  for (tries = 1; tries <= 11 && !acked; tries++) {
    noInterrupts();
    fmt_dpl();
    pkt[0] = 32;
    pkt[1] = pid << 1 | ackbit;
    memcpy(&pkt[2], payload, 32);
    tx_now();
    fmt_ack();
    acked = rx_wait(500);
    interrupts();
    if (!acked) delayMicroseconds(500);
  }
  if (acked) Serial.printf("ACK %d\n", tries - 1);
  else Serial.println("NOACK");
  uint32_t t0 = millis();
  while (millis() - t0 < rx_ms) {
    wdt_feed();
    if (rx_data(20000)) return;
  }
  Serial.println("TIMEOUT");
}

static void cmd_l(uint32_t ms) {
  uint32_t t0 = millis();
  int n = 0;
  while (millis() - t0 < ms) {
    wdt_feed();
    if (rx_data(20000)) n++;
  }
  Serial.printf("OK heard %d\n", n);
}

static void print_cfg() {
  Serial.printf("OK ch=%d addr=%02X%02X%02X%02X%02X order=%d ackbit=%d ackmode=%d ackdelay=%lu prefix=%02lX base=%08lX\n",
                ch, addr[0], addr[1], addr[2], addr[3], addr[4], order, ackbit, ackmode, ack_delay_us,
                NRF_RADIO->PREFIX0 & 0xFF, NRF_RADIO->BASE0);
}

static char line[160];
static int len = 0;

static void handle(char *l) {
  char *tok[4] = {0};
  int nt = 0;
  for (char *p = strtok(l, " "); p && nt < 4; p = strtok(NULL, " ")) tok[nt++] = p;
  if (!nt) return;
  switch (tok[0][0]) {
    case 'C':
      if (nt < 3 || parse_hex(tok[2], addr, 5) != 5) { Serial.println("ERR C <ch> <addr5> [order]"); return; }
      ch = atoi(tok[1]);
      order = nt > 3 ? atoi(tok[3]) : 0;
      apply_address();
      print_cfg();
      break;
    case 'X':
      if (nt < 2) { Serial.println("ERR X <hex> [rx_ms]"); return; }
      cmd_x(tok[1], nt > 2 ? atoi(tok[2]) : 50);
      break;
    case 'L':
      cmd_l(nt > 1 ? atoi(tok[1]) : 1000);
      break;
    case 'D':
      ack_delay_us = nt > 1 ? atoi(tok[1]) : 130;
      print_cfg();
      break;
    case 'S':
      Serial.printf("OK rx=%lu dup=%lu\n", rx_count, dup_count);
      rx_count = dup_count = 0;
      break;
    case 'A':
      ackmode = nt > 1 ? atoi(tok[1]) & 1 : 1;
      print_cfg();
      break;
    case 'P':
      ackbit = nt > 1 ? atoi(tok[1]) & 1 : 1;
      print_cfg();
      break;
    case 'B':
      Serial.println("OK bootloader");
      Serial.flush();
      delay(100);
      enterUf2Dfu();
      break;
    case '?':
      print_cfg();
      break;
    default:
      Serial.println("ERR unknown");
  }
}

void setup() {
  CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
  DWT->CYCCNT = 0;
  DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
  // 2 s watchdog: any wedge resets the board instead of needing a hand.
  NRF_WDT->CONFIG = WDT_CONFIG_SLEEP_Run << WDT_CONFIG_SLEEP_Pos;
  NRF_WDT->CRV = 2 * 32768;
  NRF_WDT->RREN = 1;
  NRF_WDT->TASKS_START = 1;
  Serial.begin(115200);
  radio_init();
}

void loop() {
  wdt_feed();
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[len] = 0;
      handle(line);
      len = 0;
    } else if (len < (int)sizeof(line) - 1) {
      line[len++] = c;
    }
  }
}
