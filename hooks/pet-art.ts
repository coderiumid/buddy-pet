// Pixel art for the pet: a small square robot head with two antennas and side ears, 12 x 14 pixels.
// Two pixels stack in one terminal cell (half blocks), so it draws as 12 x 7 cells.

export type Face =
  | 'idle'
  | 'blink'
  | 'wink'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'happy'
  | 'tired'
  | 'alert'
  | 'sleepy'
  | 'surprised'
  | 'lookleft'
  | 'lookright'

export const W = 12
export const H = 14

const T = -1 // transparent pixel
const DEF = 0x01000000 // the terminal's own color

const BODY = 0xf3f5fa
export const EAR = 0xaab3c5
const SCREEN = 0x0b0f1a
export const EYE = 0x4da3ff
export const GREEN = 0x4ade80
export const AMBER = 0xfbbf24
export const RED = 0xf87171

// The parts of the pet that change color with what it is doing
export type PetColors = { tipL: number; tipR: number; earL: number; earR: number; eye: number }

// The color of the eyes and of the face marks, set by each paint
let eye = EYE

type Grid = number[][] // [y][x], each a 0xRRGGBB color or T

function blank(): Grid {
  const g: Grid = []
  for (let y = 0; y < H; y++) {
    const row: number[] = []
    for (let x = 0; x < W; x++) row.push(T)
    g.push(row)
  }
  return g
}

// The head is 10 pixels wide with a column for an ear on each side, so x counts
// from the head's left edge and the left ear sits at x = -1. The head starts one
// terminal row (2 pixels) down, so y counts from the top of the antennas.
const OX = 1
const OY = 2

function put(g: Grid, x: number, y: number, c: number) {
  const row = g[y + OY]
  const px = x + OX
  if (row && px >= 0 && px < W) row[px] = c
}

function at(g: Grid, x: number, y: number): number {
  return g[y]?.[x] ?? T
}

function rect(g: Grid, x: number, y: number, w: number, h: number, c: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c)
}

// A square white head with two antennas that end in a colored tip, a vertical ear on
// each side, and a black visor the face is drawn on.
// The head is 10 x 10: a two pixel frame above and below the visor, one at its sides.
// A terminal cell row is two pixel rows (0-1, 2-3, ...). Where a shape crosses from one
// cell row into the next, the terminal's line spacing shows as a seam, so the head, the
// visor and the frame all start and end on a cell edge and the eyes sit inside one cell row.
function base(g: Grid, c: PetColors) {
  put(g, 2, 1, BODY)
  put(g, 7, 1, BODY)
  put(g, 2, 0, c.tipL)
  put(g, 7, 0, c.tipR)
  rect(g, 0, 2, 10, 10, BODY)
  rect(g, 1, 4, 8, 6, SCREEN)
  rect(g, -1, 4, 1, 6, c.earL)
  rect(g, 10, 4, 1, 6, c.earR)
}

// Round eyes, one cell row tall, centered on the visor
function eyes(g: Grid, dx: number, dy: number) {
  rect(g, 2 + dx, 6 + dy, 2, 2, eye)
  rect(g, 6 + dx, 6 + dy, 2, 2, eye)
}

function features(g: Grid, face: Face, tick: number) {
  switch (face) {
    case 'idle':
      eyes(g, 0, 0)
      break
    case 'blink':
      rect(g, 2, 7, 2, 1, eye)
      rect(g, 6, 7, 2, 1, eye)
      break
    case 'wink':
      rect(g, 2, 6, 2, 2, eye)
      rect(g, 6, 7, 2, 1, eye)
      break
    case 'thinking':
      // eyes look off to the right
      eyes(g, 1, 0)
      break
    case 'working':
      // eyes read left and right
      eyes(g, tick % 4 < 2 ? 0 : 1, 0)
      break
    case 'waiting':
      // eyes look down at the prompt, waiting for you
      eyes(g, 0, 2)
      break
    case 'happy':
      // arches: ^ ^
      put(g, 1, 7, eye)
      put(g, 2, 6, eye)
      put(g, 3, 7, eye)
      put(g, 6, 7, eye)
      put(g, 7, 6, eye)
      put(g, 8, 7, eye)
      break
    case 'tired':
      // drooping eyes: / \
      put(g, 2, 7, eye)
      put(g, 3, 6, eye)
      put(g, 6, 6, eye)
      put(g, 7, 7, eye)
      break
    case 'alert':
      // X eyes: a tool failed
      put(g, 1, 6, eye)
      put(g, 3, 6, eye)
      put(g, 2, 7, eye)
      put(g, 1, 8, eye)
      put(g, 3, 8, eye)
      put(g, 6, 6, eye)
      put(g, 8, 6, eye)
      put(g, 7, 7, eye)
      put(g, 6, 8, eye)
      put(g, 8, 8, eye)
      break
    case 'sleepy':
      rect(g, 2, 8, 2, 1, eye)
      rect(g, 6, 8, 2, 1, eye)
      break
    case 'lookleft':
      eyes(g, -1, 0)
      break
    case 'lookright':
      eyes(g, 1, 0)
      break
    case 'surprised':
      // wide eyes
      rect(g, 1, 6, 3, 2, eye)
      rect(g, 6, 6, 3, 2, eye)
      break
  }
}

export function paint(face: Face, tick: number, colors: PetColors): Grid {
  const g = blank()
  eye = colors.eye
  base(g, colors)
  features(g, face, tick)
  return g
}

function light(c: number): number {
  return 0.3 * ((c >> 16) & 255) + 0.59 * ((c >> 8) & 255) + 0.11 * (c & 255)
}

// Pack the grid the way a Raster takes it: one cell is a character,
// a foreground and a background, three little-endian u32 values
export function pack(g: Grid): string {
  const rows = Math.ceil(H / 2)
  const words = new Uint32Array(W * rows * 3)
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < W; c++) {
      const top = at(g, c, 2 * r)
      const bot = at(g, c, 2 * r + 1)
      let cp = 0x20
      let fg = DEF
      let bg = DEF
      if (top !== T && top === bot) {
        // both halves one color: fill the cell with its background, no glyph edges
        bg = top
      } else if (top !== T && bot !== T) {
        // two colors in one cell: the glyph takes the lighter one, so the tiny gaps a
        // half block leaves at its edges show the darker color and stay out of sight
        if (light(top) >= light(bot)) {
          cp = 0x2580
          fg = top
          bg = bot
        } else {
          cp = 0x2584
          fg = bot
          bg = top
        }
      } else if (top !== T) {
        cp = 0x2580
        fg = top
      } else if (bot !== T) {
        cp = 0x2584
        fg = bot
      }
      words[i++] = cp
      words[i++] = fg
      words[i++] = bg
    }
  }
  return (new Uint8Array(words.buffer) as any).toBase64()
}

// Plain text faces for surfaces that cannot draw a Raster
export const TEXT_FACE: Record<Face, string> = {
  idle: '=^ ^=',
  blink: '=- -=',
  wink: '=^ -=',
  thinking: '=o o=..',
  working: '=> <=',
  waiting: '=o O=?',
  happy: '\\=^ ^=/',
  tired: '=u u=',
  alert: '=> <=!',
  sleepy: '=- -=z',
  surprised: '=O O=!',
  lookleft: '=< <=',
  lookright: '=> >=',
}
