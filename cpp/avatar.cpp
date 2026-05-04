// Server-side text-to-PNG renderer for the chat demo.
//
// The demo's binary response is not a client-side avatar. The server
// receives chat text, renders that text into a PNG in wasm, and returns
// the PNG bytes through ChatMessage.image (a Cap'n Proto Data field).
// The browser displays those bytes via Blob/ObjectURL.
//
// PNG encoder is deliberately tiny:
//   - palette PNG, 8-bit indexed color (2 colors)
//   - single IDAT chunk
//   - zlib stored block (no compression library)
//
// Image: 384x144, 1 byte/pixel + filter byte per row => ~55.4 KB PNG.
// That is intentionally real binary payload, while staying small enough
// for a public demo.

#include <cstdint>
#include <cstring>

extern "C" {
uint8_t* cpp_in_ptr();
uint8_t* cpp_out_ptr();
}

namespace {

constexpr int W = 384;
constexpr int H = 144;
constexpr int SCALE = 2;
constexpr int MARGIN_X = 16;
constexpr int MARGIN_Y = 16;
constexpr int CHAR_ADV = 6 * SCALE;
constexpr int LINE_ADV = 9 * SCALE;
constexpr int MAX_COLS = (W - MARGIN_X * 2) / CHAR_ADV;
constexpr int MAX_LINES = (H - MARGIN_Y * 2) / LINE_ADV;
constexpr int SCAN = 1 + W;       // PNG filter byte + 8-bit palette index pixels
constexpr int RAW_SIZE = H * SCAN;

uint32_t crc_table[256];
bool crc_table_initialized = false;

void init_crc_table() {
  for (int i = 0; i < 256; i++) {
    uint32_t c = (uint32_t)i;
    for (int j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320u ^ (c >> 1)) : (c >> 1);
    crc_table[i] = c;
  }
  crc_table_initialized = true;
}

uint32_t crc32(const uint8_t* data, size_t len) {
  if (!crc_table_initialized) init_crc_table();
  uint32_t crc = 0xffffffffu;
  for (size_t i = 0; i < len; i++) crc = crc_table[(crc ^ data[i]) & 0xff] ^ (crc >> 8);
  return crc ^ 0xffffffffu;
}

uint32_t adler32(const uint8_t* data, size_t len) {
  uint32_t a = 1, b = 0;
  for (size_t i = 0; i < len; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

inline void w_be32(uint8_t* p, uint32_t v) {
  p[0] = (uint8_t)(v >> 24);
  p[1] = (uint8_t)(v >> 16);
  p[2] = (uint8_t)(v >> 8);
  p[3] = (uint8_t)v;
}

// 5x7 bitmap font. Bits 4..0 map left-to-right.
static const uint8_t GLYPH_UNKNOWN[7] = {0x0e,0x11,0x01,0x06,0x04,0x00,0x04}; // ?
static const uint8_t GLYPH_SPACE[7]   = {0,0,0,0,0,0,0};

const uint8_t* glyph(char c) {
  if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
  switch (c) {
    case ' ': return GLYPH_SPACE;
    case 'A': { static const uint8_t g[7]={0x0e,0x11,0x11,0x1f,0x11,0x11,0x11}; return g; }
    case 'B': { static const uint8_t g[7]={0x1e,0x11,0x11,0x1e,0x11,0x11,0x1e}; return g; }
    case 'C': { static const uint8_t g[7]={0x0e,0x11,0x10,0x10,0x10,0x11,0x0e}; return g; }
    case 'D': { static const uint8_t g[7]={0x1e,0x11,0x11,0x11,0x11,0x11,0x1e}; return g; }
    case 'E': { static const uint8_t g[7]={0x1f,0x10,0x10,0x1e,0x10,0x10,0x1f}; return g; }
    case 'F': { static const uint8_t g[7]={0x1f,0x10,0x10,0x1e,0x10,0x10,0x10}; return g; }
    case 'G': { static const uint8_t g[7]={0x0e,0x11,0x10,0x17,0x11,0x11,0x0f}; return g; }
    case 'H': { static const uint8_t g[7]={0x11,0x11,0x11,0x1f,0x11,0x11,0x11}; return g; }
    case 'I': { static const uint8_t g[7]={0x0e,0x04,0x04,0x04,0x04,0x04,0x0e}; return g; }
    case 'J': { static const uint8_t g[7]={0x07,0x02,0x02,0x02,0x12,0x12,0x0c}; return g; }
    case 'K': { static const uint8_t g[7]={0x11,0x12,0x14,0x18,0x14,0x12,0x11}; return g; }
    case 'L': { static const uint8_t g[7]={0x10,0x10,0x10,0x10,0x10,0x10,0x1f}; return g; }
    case 'M': { static const uint8_t g[7]={0x11,0x1b,0x15,0x15,0x11,0x11,0x11}; return g; }
    case 'N': { static const uint8_t g[7]={0x11,0x19,0x15,0x13,0x11,0x11,0x11}; return g; }
    case 'O': { static const uint8_t g[7]={0x0e,0x11,0x11,0x11,0x11,0x11,0x0e}; return g; }
    case 'P': { static const uint8_t g[7]={0x1e,0x11,0x11,0x1e,0x10,0x10,0x10}; return g; }
    case 'Q': { static const uint8_t g[7]={0x0e,0x11,0x11,0x11,0x15,0x12,0x0d}; return g; }
    case 'R': { static const uint8_t g[7]={0x1e,0x11,0x11,0x1e,0x14,0x12,0x11}; return g; }
    case 'S': { static const uint8_t g[7]={0x0f,0x10,0x10,0x0e,0x01,0x01,0x1e}; return g; }
    case 'T': { static const uint8_t g[7]={0x1f,0x04,0x04,0x04,0x04,0x04,0x04}; return g; }
    case 'U': { static const uint8_t g[7]={0x11,0x11,0x11,0x11,0x11,0x11,0x0e}; return g; }
    case 'V': { static const uint8_t g[7]={0x11,0x11,0x11,0x11,0x11,0x0a,0x04}; return g; }
    case 'W': { static const uint8_t g[7]={0x11,0x11,0x11,0x15,0x15,0x15,0x0a}; return g; }
    case 'X': { static const uint8_t g[7]={0x11,0x11,0x0a,0x04,0x0a,0x11,0x11}; return g; }
    case 'Y': { static const uint8_t g[7]={0x11,0x11,0x0a,0x04,0x04,0x04,0x04}; return g; }
    case 'Z': { static const uint8_t g[7]={0x1f,0x01,0x02,0x04,0x08,0x10,0x1f}; return g; }
    case '0': { static const uint8_t g[7]={0x0e,0x11,0x13,0x15,0x19,0x11,0x0e}; return g; }
    case '1': { static const uint8_t g[7]={0x04,0x0c,0x04,0x04,0x04,0x04,0x0e}; return g; }
    case '2': { static const uint8_t g[7]={0x0e,0x11,0x01,0x02,0x04,0x08,0x1f}; return g; }
    case '3': { static const uint8_t g[7]={0x1f,0x02,0x04,0x02,0x01,0x11,0x0e}; return g; }
    case '4': { static const uint8_t g[7]={0x02,0x06,0x0a,0x12,0x1f,0x02,0x02}; return g; }
    case '5': { static const uint8_t g[7]={0x1f,0x10,0x1e,0x01,0x01,0x11,0x0e}; return g; }
    case '6': { static const uint8_t g[7]={0x06,0x08,0x10,0x1e,0x11,0x11,0x0e}; return g; }
    case '7': { static const uint8_t g[7]={0x1f,0x01,0x02,0x04,0x08,0x08,0x08}; return g; }
    case '8': { static const uint8_t g[7]={0x0e,0x11,0x11,0x0e,0x11,0x11,0x0e}; return g; }
    case '9': { static const uint8_t g[7]={0x0e,0x11,0x11,0x0f,0x01,0x02,0x0c}; return g; }
    case '.': { static const uint8_t g[7]={0,0,0,0,0,0x0c,0x0c}; return g; }
    case ',': { static const uint8_t g[7]={0,0,0,0,0,0x0c,0x08}; return g; }
    case ':': { static const uint8_t g[7]={0,0x0c,0x0c,0,0x0c,0x0c,0}; return g; }
    case ';': { static const uint8_t g[7]={0,0x0c,0x0c,0,0x0c,0x08,0x10}; return g; }
    case '!': { static const uint8_t g[7]={0x04,0x04,0x04,0x04,0x04,0,0x04}; return g; }
    case '?': return GLYPH_UNKNOWN;
    case '-': { static const uint8_t g[7]={0,0,0,0x1f,0,0,0}; return g; }
    case '_': { static const uint8_t g[7]={0,0,0,0,0,0,0x1f}; return g; }
    case '/': { static const uint8_t g[7]={0x01,0x02,0x02,0x04,0x08,0x08,0x10}; return g; }
    case '@': { static const uint8_t g[7]={0x0e,0x11,0x17,0x15,0x17,0x10,0x0e}; return g; }
    case '#': { static const uint8_t g[7]={0x0a,0x0a,0x1f,0x0a,0x1f,0x0a,0x0a}; return g; }
    default: return GLYPH_UNKNOWN;
  }
}

void set_pixel(uint8_t* raw, int x, int y, uint8_t color) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  raw[y * SCAN + 1 + x] = color;
}

void draw_char(uint8_t* raw, char ch, int x, int y) {
  const uint8_t* g = glyph(ch);
  for (int row = 0; row < 7; row++) {
    uint8_t bits = g[row];
    for (int col = 0; col < 5; col++) {
      if ((bits >> (4 - col)) & 1) {
        for (int sy = 0; sy < SCALE; sy++) {
          for (int sx = 0; sx < SCALE; sx++) set_pixel(raw, x + col * SCALE + sx, y + row * SCALE + sy, 1);
        }
      }
    }
  }
}

void write_chunk(uint8_t* out, size_t& pos, const char type[4], const uint8_t* data, uint32_t len) {
  w_be32(out + pos, len); pos += 4;
  size_t type_pos = pos;
  std::memcpy(out + pos, type, 4); pos += 4;
  if (len) { std::memcpy(out + pos, data, len); pos += len; }
  w_be32(out + pos, crc32(out + type_pos, 4 + len)); pos += 4;
}

}  // namespace

// Render text staged at cpp_in to a PNG in cpp_out. The input is UTF-8-ish
// but this tiny demo renderer treats bytes as printable ASCII; non-ASCII
// bytes render as '?'. Newlines are honored, long text wraps.
extern "C" uint32_t cpp_chat_render_text_png(uint32_t text_len) {
  uint8_t* in = cpp_in_ptr();
  uint8_t* out = cpp_out_ptr();
  static uint8_t raw[RAW_SIZE];

  // Background palette index 0, text palette index 1.
  for (int y = 0; y < H; y++) {
    raw[y * SCAN] = 0; // filter: none
    std::memset(raw + y * SCAN + 1, 0, W);
  }

  int line = 0, col = 0;
  for (uint32_t i = 0; i < text_len && line < MAX_LINES; i++) {
    char ch = (char)in[i];
    if (ch == '\r') continue;
    if (ch == '\n') { line++; col = 0; continue; }
    if ((unsigned char)ch < 32 || (unsigned char)ch > 126) ch = '?';
    if (col >= MAX_COLS) { line++; col = 0; if (line >= MAX_LINES) break; }
    draw_char(raw, ch, MARGIN_X + col * CHAR_ADV, MARGIN_Y + line * LINE_ADV);
    col++;
  }

  size_t pos = 0;
  static const uint8_t sig[8] = {0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a};
  std::memcpy(out + pos, sig, 8); pos += 8;

  uint8_t ihdr[13];
  w_be32(ihdr + 0, W);
  w_be32(ihdr + 4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed color
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  write_chunk(out, pos, "IHDR", ihdr, 13);

  // PLTE: background #f8fafc, ink #111827.
  static const uint8_t plte[6] = {0xf8,0xfa,0xfc, 0x11,0x18,0x27};
  write_chunk(out, pos, "PLTE", plte, 6);

  // IDAT payload = zlib header + one stored block + Adler-32.
  static uint8_t idat[2 + 5 + RAW_SIZE + 4];
  size_t ip = 0;
  idat[ip++] = 0x78; idat[ip++] = 0x01;
  idat[ip++] = 0x01; // BFINAL=1, stored block
  uint16_t len = (uint16_t)RAW_SIZE;
  idat[ip++] = (uint8_t)(len & 0xff);
  idat[ip++] = (uint8_t)(len >> 8);
  uint16_t nlen = (uint16_t)(~len);
  idat[ip++] = (uint8_t)(nlen & 0xff);
  idat[ip++] = (uint8_t)(nlen >> 8);
  std::memcpy(idat + ip, raw, RAW_SIZE); ip += RAW_SIZE;
  w_be32(idat + ip, adler32(raw, RAW_SIZE)); ip += 4;
  write_chunk(out, pos, "IDAT", idat, (uint32_t)ip);

  write_chunk(out, pos, "IEND", nullptr, 0);
  return (uint32_t)pos;
}
