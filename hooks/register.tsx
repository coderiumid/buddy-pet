import type { Register } from 'claude-code'

import { AMBER, EAR, EYE, GREEN, RED, TEXT_FACE, pack, paint } from './pet-art'
import type { Face, PetColors } from './pet-art'

// What the pet is doing. Idle expands into blink, wink, glances, tired or sleepy when drawn.
type Activity = 'idle' | 'thinking' | 'working' | 'waiting' | 'happy' | 'alert' | 'surprised'

// What the person chose with /pet; kept between sessions in $.store
type Prefs = { compact: boolean; muted: boolean; budget: number; theme: string }

// Module variables: the pet and its numbers start over when the mod reloads
let activity: Activity = 'idle'
let note = 'chilling'
let until = 0 // when a temporary activity (happy, alert, surprised) ends
let activityStartedAt = 0
let lastActive = 0
let tick = 0

let ctxTokens: number | undefined
let ctxWindow = 0
let ctxPercent: number | undefined
let costUsd: number | undefined
let limits: { kind: string; percentUsed: number; resetsAt?: string }[] = []

let toolCalls = 0
let turns = 0
let turnStartedAt = 0
let lastTurnSeconds = 0
let warnedLevel = 0
let lastTool = ''
let history: number[] = [] // context percent after each turn, for the trend

let prefs: Prefs = { compact: false, muted: false, budget: 10, theme: 'blue' }

// Eye and accent colors the person can pick with /pet theme
const THEMES: Record<string, number> = {
  blue: EYE,
  cyan: 0x22d3ee,
  violet: 0xa78bfa,
  pink: 0xf472b6,
  lime: 0xa3e635,
}

// Subagents that have started and not stopped, and how much of the budget has been warned about
const agents = new Set<string>()
let warnedBudget = 0

// Totals from earlier sessions, and the session cost when this module started,
// so a hot reload does not count the same dollars twice
let baseTools = 0
let baseTurns = 0
let baseUsd = 0
let baselineUsd = 0

// Change what the pet is doing and ask Claude Code to draw the band again
function setActivity($: any, next: Activity, text: string, now: number, ms: number) {
  activity = next
  note = text
  until = ms > 0 ? now + ms : 0
  activityStartedAt = now
  lastActive = now
  $.ui.invalidate('ui.render')
}

// Keep the latest context, cost and rate-limit figures
function applyUsage(context: any, rateLimits: any, cost: any) {
  if (context) {
    ctxTokens = context.tokens
    ctxWindow = context.window ?? ctxWindow
    ctxPercent = context.percent
  }
  limits = Array.isArray(rateLimits) ? rateLimits : []
  costUsd = cost && typeof cost.usd === 'number' ? cost.usd : undefined
}

// 70, 85 and 95 percent are the levels the pet warns at
function levelOf(percent: number | undefined): number {
  if (percent === undefined) return 0
  if (percent >= 95) return 95
  if (percent >= 85) return 85
  if (percent >= 70) return 70
  return 0
}

// Which face to draw now
function pickFace(now: number): Face {
  let a = activity
  if (until > 0 && now > until) {
    a = 'idle'
    activity = 'idle'
    note = 'chilling'
    until = 0
  }
  if (a !== 'idle') return a
  if ((ctxPercent ?? 0) >= 85) return 'tired'
  if (now - lastActive > 120000) return 'sleepy'
  const t = tick % 40
  if (t === 0) return 'blink'
  if (t === 20) return 'wink'
  if (t >= 8 && t <= 10) return 'lookright'
  if (t >= 30 && t <= 32) return 'lookleft'
  return 'idle'
}

function accent(): number {
  return THEMES[prefs.theme] ?? EYE
}

// A color mixed toward the face's black: the dim half of a blinking light
function dimmed(color: number): number {
  const mix = (shift: number, dark: number) => Math.round(((color >> shift) & 255) * 0.35 + dark * 0.65)
  return (mix(16, 0x0b) << 16) | (mix(8, 0x0f) << 8) | mix(0, 0x1a)
}

// The status line takes the color of what the pet is doing
function statusColor(face: Face): number | undefined {
  switch (face) {
    case 'thinking':
    case 'working':
      return accent()
    case 'waiting':
    case 'surprised':
    case 'tired':
      return AMBER
    case 'happy':
      return GREEN
    case 'alert':
      return RED
    default:
      return undefined
  }
}

// Antenna tips and ears show the same mood: busy blinks, waiting and trouble light up,
// and while subagents work the two tips take turns
function petColors(face: Face): PetColors {
  const mood = statusColor(face) ?? accent()
  const isBusy = face === 'thinking' || face === 'working'
  let tipL = mood
  let tipR = mood
  if (isBusy) {
    tipL = tipR = tick % 2 === 0 ? dimmed(mood) : mood
  } else if (agents.size > 0) {
    tipL = tick % 2 === 0 ? mood : dimmed(mood)
    tipR = tick % 2 === 0 ? dimmed(mood) : mood
  }
  let earL = EAR
  let earR = EAR
  if (face === 'waiting') {
    earL = AMBER
    earR = AMBER
  } else if (face === 'alert') {
    earL = RED
    earR = RED
  } else if (face === 'happy') {
    // the ears take turns
    earL = tick % 2 === 0 ? GREEN : EAR
    earR = tick % 2 === 0 ? EAR : GREEN
  }
  return { tipL, tipR, earL, earR, eye: accent() }
}

// 188700 is 189k, 1000000 is 1M
function fmt(n: number | undefined): string {
  if (n === undefined) return '--'
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 100000) return Math.round(n / 1000) + 'k'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function bar(percent: number | undefined, width: number): string {
  const filled = Math.round(((percent ?? 0) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// 7800000 ms is "2h 10m", 100000000 is "1d 3h"
function untilReset(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes >= 1440) return Math.floor(minutes / 1440) + 'd ' + Math.floor((minutes % 1440) / 60) + 'h'
  if (minutes >= 60) return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
  return minutes + 'm'
}

function windowName(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  return kind
}

// A piece of a stat line; no color draws dim
type Part = { text: string; color?: number; bold?: boolean }
// One box of the dashboard: a title with a few words beside it, a border color
// (none draws dim) and its lines
type Card = { title: string; extra?: Part[]; border?: number; lines: Part[][] }

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0')
}

// Context turns amber at 60 percent and red at 85
function ctxColor(): number | undefined {
  if (ctxPercent === undefined) return undefined
  return ctxPercent >= 85 ? RED : ctxPercent >= 60 ? AMBER : GREEN
}

function limitColor(percent: number): number {
  return percent >= 90 ? RED : percent >= 70 ? AMBER : GREEN
}

// The session cost stays dim until it is half of the budget set with /pet budget
function costColor(): number | undefined {
  if (costUsd === undefined || prefs.budget <= 0) return undefined
  if (costUsd >= prefs.budget) return RED
  if (costUsd >= prefs.budget / 2) return AMBER
  return undefined
}

// 0, 50, 80 or 100: how much of the budget the session cost has reached
function budgetLevel(): number {
  if (costUsd === undefined || prefs.budget <= 0) return 0
  const used = costUsd / prefs.budget
  return used >= 1 ? 100 : used >= 0.8 ? 80 : used >= 0.5 ? 50 : 0
}

function lifetimeUsd(): number {
  return baseUsd + Math.max(0, (costUsd ?? baselineUsd) - baselineUsd)
}

const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

// Join neighbours of one color so the tree stays small
function merge(parts: Part[]): Part[] {
  const out: Part[] = []
  for (const part of parts) {
    const last = out[out.length - 1]
    if (last && last.color === part.color && last.bold === part.bold) last.text += part.text
    else out.push({ ...part })
  }
  return out
}

// A bar whose cells are colored by how full they are: green, then amber, then red
function gradientBar(percent: number | undefined, width: number): Part[] {
  const filled = Math.round(((percent ?? 0) / 100) * width)
  const parts: Part[] = []
  for (let i = 0; i < filled; i++) {
    const at = ((i + 1) / width) * 100
    parts.push({ text: '█', color: at > 85 ? RED : at > 60 ? AMBER : GREEN })
  }
  if (filled < width) parts.push({ text: '░'.repeat(width - filled) })
  return merge(parts)
}

function miniBar(percent: number, width: number, color: number): Part[] {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return [{ text: '█'.repeat(filled), color }, { text: '░'.repeat(width - filled) }]
}

// How many more turns fit before the context is full, from the last few turns
function turnsLeft(): number | undefined {
  if (history.length < 3) return undefined
  const recent = history.slice(-6)
  const last = recent[recent.length - 1] ?? 0
  const rate = (last - (recent[0] ?? last)) / (recent.length - 1)
  if (rate < 0.2 || last >= 100) return undefined
  return Math.ceil((100 - last) / rate)
}

function statusGlyph(face: Face): string {
  switch (face) {
    case 'thinking':
    case 'working':
      return SPINNER[tick % SPINNER.length] ?? '·'
    case 'waiting':
      return '?'
    case 'happy':
      return '✓'
    case 'alert':
      return '✗'
    case 'surprised':
      return '!'
    case 'tired':
      return '~'
    case 'sleepy':
      return 'z'
    default:
      return '·'
  }
}

// A line of text of a given length for a card, cut to fit
function fit(text: string, width: number): string {
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text
}

// The boxes of the dashboard, the things worth watching: context, cost and limits.
// `inner` is the width of the text inside a box. A box holds a title line and two more,
// so it stands as tall as the pet's head.
function buildCards(inner: number, now: number): Card[] {
  const pct = ctxPercent === undefined ? '--' : ctxPercent + '%'
  const left = turnsLeft()
  const ctxLevel = ctxColor()
  const free = ctxWindow > 0 && ctxTokens !== undefined ? ctxWindow - ctxTokens : undefined

  // Beside the title: how many turns are left, or how many tokens are free
  const trendNote =
    left !== undefined
      ? (left > 99 ? '99+' : '~' + left) + ' turns left'
      : free !== undefined
        ? fmt(free) + ' free'
        : ''
  const context: Card = {
    title: 'CONTEXT',
    extra: [{ text: fit('  ' + trendNote, inner - 'CONTEXT'.length) }],
    border: ctxLevel === GREEN ? undefined : ctxLevel,
    lines: [
      [
        { text: pct, color: ctxLevel, bold: true },
        { text: '  ' + fmt(ctxTokens) + ' / ' + fmt(ctxWindow || undefined) },
      ],
      gradientBar(ctxPercent, inner),
    ],
  }

  // The budget set with /pet budget: the cost says how much of it is used
  const budgetPart: Part[] =
    costUsd !== undefined && prefs.budget > 0
      ? [{ text: '  ' + Math.round((costUsd / prefs.budget) * 100) + '% of $' + prefs.budget, color: costColor() }]
      : []
  const spent = costUsd !== undefined ? Math.max(0, costUsd - baselineUsd) : undefined
  const perTurn = spent !== undefined && turns > 0 ? ' · $' + (spent / turns).toFixed(2) + '/turn' : ''
  const session: Card = {
    title: 'SESSION',
    extra: [{ text: fit('  all $' + lifetimeUsd().toFixed(2), inner - 'SESSION'.length) }],
    border: costColor(),
    lines: [
      [{ text: costUsd !== undefined ? '$' + costUsd.toFixed(2) : '--', color: costColor(), bold: true }, ...budgetPart],
      [{ text: fit(toolCalls + ' tools · ' + turns + ' turns' + perTurn, inner) }],
    ],
  }

  // One line a window: its name, a bar that takes the width left, and the percent
  const limitLines: Part[][] = limits.slice(0, 2).map((r) => {
    const color = limitColor(r.percentUsed)
    const percent = Math.round(r.percentUsed) + '%'
    return [
      { text: windowName(r.kind) + ' ' },
      ...miniBar(r.percentUsed, Math.max(4, inner - 3 - percent.length - 1), color),
      { text: ' ' + percent, color, bold: true },
    ]
  })
  const worst = limits.reduce((m, r) => Math.max(m, r.percentUsed), 0)
  // Beside the title: the window that resets first, and in how long
  const soonest = limits
    .filter((r) => r.resetsAt !== undefined && Date.parse(r.resetsAt) > now)
    .sort((x, y) => Date.parse(x.resetsAt!) - Date.parse(y.resetsAt!))[0]
  const limitCard: Card = {
    title: 'LIMITS',
    extra:
      soonest === undefined
        ? undefined
        : [{ text: fit('  ' + windowName(soonest.kind) + ' resets in ' + untilReset(Date.parse(soonest.resetsAt!) - now), inner - 'LIMITS'.length) }],
    border: limits.length > 0 && worst >= 70 ? limitColor(worst) : undefined,
    lines: limitLines.length > 0 ? limitLines : [[{ text: 'not available' }]],
  }

  return [context, session, limitCard]
}

// What the pet is doing, as one line of text above the boxes: a spinner or sign, the
// status, how long it has lasted, and the tool last used
function statusLine(face: Face, now: number): Part[] {
  const isTimed = activity === 'thinking' || activity === 'working' || activity === 'waiting'
  const seconds = Math.floor((now - activityStartedAt) / 1000)
  const idleMinutes = Math.floor((now - lastActive) / 60000)
  const timing = isTimed && seconds >= 1 ? ' · ' + seconds + 's' : activity === 'idle' && idleMinutes >= 1 ? (face === 'sleepy' ? ' · zzz ' : ' · idle ') + idleMinutes + 'm' : ''
  return [
    { text: statusGlyph(face) + ' ' + note, color: statusColor(face), bold: true },
    { text: timing + (lastTool !== '' ? '   last: ' + lastTool : '') },
    ...(agents.size > 0 ? [{ text: '   ⚙ ' + agents.size + (agents.size === 1 ? ' agent' : ' agents'), color: accent() }] : []),
  ]
}

// Three boxes at most; with little room the first ones stay: context, session, limits
const MIN_CARD = 18

function compactLine(): string {
  const pct = ctxPercent === undefined ? '--' : ctxPercent + '%'
  return (
    note +
    ' · ctx ' +
    pct +
    ' (' +
    fmt(ctxTokens) +
    '/' +
    fmt(ctxWindow || undefined) +
    ')' +
    (costUsd !== undefined ? ' · $' + costUsd.toFixed(2) : '') +
    ' · ' +
    toolCalls +
    ' tool'
  )
}

// Read what the person chose and the totals of earlier sessions
async function loadStore($: any) {
  try {
    const saved = (await $.store.get('prefs')) as Partial<Prefs> | undefined
    if (saved) prefs = { ...prefs, ...saved }
    const total = (await $.store.get('lifetime')) as { tools?: number; turns?: number; usd?: number } | undefined
    baseTools = total?.tools ?? 0
    baseTurns = total?.turns ?? 0
    baseUsd = total?.usd ?? 0
  } catch (_) {
    // the pet starts with defaults and empty totals
  }
}

// The trend is kept in the store so a reload does not start it over. It is only taken
// back when the context has not shrunk since, which is when it is the same session.
async function restoreHistory($: any) {
  try {
    const saved = (await $.store.get('history')) as number[] | undefined
    if (!Array.isArray(saved) || saved.length === 0 || ctxPercent === undefined) return
    const last = saved[saved.length - 1] ?? 0
    if (ctxPercent >= last - 1 && ctxPercent <= last + 10) history = saved.filter((v) => typeof v === 'number').slice(-24)
  } catch (_) {
    // the trend starts over
  }
}

async function saveHistory($: any) {
  try {
    await $.store.set('history', history)
  } catch (_) {
    // the trend is a nicety
  }
}

async function saveLifetime($: any) {
  try {
    await $.store.set('lifetime', { tools: baseTools + toolCalls, turns: baseTurns + turns, usd: lifetimeUsd() })
  } catch (_) {
    // totals are a nicety
  }
}

// A short sound, unless the person muted the pet. A clip that cannot play is skipped.
function chirp($: any, name: 'done' | 'ask' | 'fail') {
  if (prefs.muted) return
  try {
    $.audio.play({ asset: 'sounds/' + name + '.wav' }).catch(() => {})
  } catch (_) {
    // no player on this machine
  }
}

const USAGE = 'Usage: /pet [compact | sound | budget <usd> | theme <' + Object.keys(THEMES).join(' | ') + '>]'

export const register: Register = (on) => {
  // Start-up: read what was saved and the current figures, add /pet, run the animation clock
  on('session.start', async ($, e, next) => {
    lastActive = await $.clock.now()
    activityStartedAt = lastActive
    await loadStore($)
    try {
      const u = await $.session.usage()
      applyUsage(u.context, u.rateLimits, u.cost)
      baselineUsd = costUsd ?? 0
      warnedBudget = budgetLevel()
      await restoreHistory($)
    } catch (_) {
      // the figures arrive with the first measurement instead
    }
    try {
      await $.command.register({
        name: 'pet',
        description: 'Show or hide the pet numbers, mute its sounds, set the cost budget or the theme',
        argumentHint: '[compact | sound | budget <usd> | theme <name>]',
      })
    } catch (_) {
      // without the command the pet still works
    }
    $.clock.every(300, () => {
      tick += 1
      $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  // /pet: no argument or "compact" toggles the numbers, "sound" toggles the sounds,
  // "budget 20" sets the cost where the session line turns red
  on('command.run', { command: 'pet' }, async ($, e) => {
    const [sub = '', arg = ''] = e.args.trim().split(/\s+/)
    let text = USAGE
    if (sub === '' || sub === 'compact') {
      prefs.compact = !prefs.compact
      text = prefs.compact ? 'Pet numbers hidden.' : 'Pet numbers shown.'
    } else if (sub === 'sound') {
      prefs.muted = !prefs.muted
      text = prefs.muted ? 'Pet sounds muted.' : 'Pet sounds on.'
    } else if (sub === 'budget') {
      const usd = Number(arg)
      if (arg !== '' && Number.isFinite(usd) && usd >= 0) {
        prefs.budget = usd
        warnedBudget = budgetLevel()
        text = usd > 0 ? 'Cost budget set to $' + usd.toFixed(2) + '.' : 'Cost budget off.'
      }
    } else if (sub === 'theme') {
      if (arg in THEMES) {
        prefs.theme = arg
        text = 'Pet theme: ' + arg + '.'
      } else {
        text = 'Themes: ' + Object.keys(THEMES).join(', ') + '.'
      }
    }
    try {
      await $.store.set('prefs', prefs)
    } catch (_) {
      // the choice lasts for this session
    }
    $.ui.invalidate('ui.render')
    return { text }
  })

  // A turn begins: the pet starts thinking
  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    turnStartedAt = now
    setActivity($, 'thinking', 'thinking...', now, 0)
    return next(e)
  })

  // Each tool call: count it and show which tool Claude is using
  on('tool.call', async ($, e, next) => {
    toolCalls += 1
    lastTool = e.tool
    setActivity($, 'working', 'running ' + e.tool, await $.clock.now(), 0)
    saveLifetime($)
    return next(e)
  }).catch(async ($, e, next) => next(e)) // if the pet breaks, the tool call still runs

  // Claude Code is asking the person for approval: the pet waits with you
  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    if (result.decision === 'ask') {
      setActivity($, 'waiting', 'waiting for your OK', await $.clock.now(), 0)
      chirp($, 'ask')
    }
    return result
  }).catch(async ($, e, next) => next(e)) // never let the pet change a permission decision

  // A tool failed: the pet looks alarmed for a few seconds
  on('classic.PostToolUseFailure', async ($, e, next) => {
    setActivity($, 'alert', 'a tool failed', await $.clock.now(), 4000)
    chirp($, 'fail')
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // Turn ended: count it, celebrate, then go back to idle
  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    turns += 1
    lastTurnSeconds = turnStartedAt > 0 ? Math.round((now - turnStartedAt) / 1000) : 0
    setActivity($, 'happy', 'done!', now, 4000)
    chirp($, 'done')
    saveLifetime($)
    return next(e)
  })

  // Fresh context, rate-limit and cost figures after each turn
  on('session.measure', async ($, e, next) => {
    applyUsage(e.context, e.rateLimits, e.cost)
    if (ctxPercent !== undefined) {
      history = [...history, ctxPercent].slice(-24)
      saveHistory($)
    }
    const level = levelOf(ctxPercent)
    if (level > warnedLevel) {
      $.ui.toast(
        'Context ' + ctxPercent + '% used' + (level >= 85 ? ' - consider /compact or a new session' : ''),
      )
      setActivity($, 'surprised', 'context ' + ctxPercent + '%', await $.clock.now(), 3000)
    }
    warnedLevel = level
    const spend = budgetLevel()
    if (spend > warnedBudget) {
      $.ui.toast('Session cost $' + (costUsd ?? 0).toFixed(2) + ' is ' + spend + '% of your $' + prefs.budget + ' budget')
      setActivity($, 'surprised', 'budget ' + spend + '%', await $.clock.now(), 4000)
      chirp($, 'ask')
    }
    warnedBudget = spend
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Subagents: the antenna tips take turns while any is working
  on('classic.SubagentStart', async ($, e, next) => {
    agents.add(String((e as any).agent_id ?? agents.size + ':' + (await $.clock.now())))
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async ($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const id = (e as any).agent_id
    if (id !== undefined) agents.delete(String(id))
    else agents.clear()
    $.ui.invalidate('ui.render')
    return next(e)
  }).catch(async ($, e, next) => next(e))

  // The conversation was compacted: the trend starts over and the pet is glad about the room
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !('skip' in result)) {
      history = []
      warnedLevel = 0
      saveHistory($)
      setActivity($, 'happy', 'compacted', await $.clock.now(), 4000)
      chirp($, 'done')
      $.ui.toast('Context compacted')
    }
    return result
  }).catch(async ($, e, next) => next(e)) // never let the pet get in the way of compaction

  // The pet and its numbers, drawn in the band above the prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const now = await $.clock.now()
    const face = pickFace(now)

    // Pixel art needs a terminal (only it has Raster), room for seven rows,
    // and width for at least two boxes beside the pet
    const room = e.props.bodyColumns - 12 - 2
    if (e.surface === 'terminal' && e.props.maxRows >= 8 && room >= MIN_CARD * 2 + 1) {
      const { Box, Text, Raster } = $.ui.resolve(e)
      const cells = pack(paint(face, tick, petColors(face)))
      const pet = <Raster key="pet" columns={12} rows={7} cells={cells} />
      const { Button } = $.ui.resolve(e)
      const toggle = async () => {
        prefs.compact = !prefs.compact
        try {
          await $.store.set('prefs', prefs)
        } catch (_) {
          // the choice lasts for this session
        }
        $.ui.invalidate('ui.render')
      }
      if (prefs.compact) {
        return (
          <Box columnGap={2}>
            {pet}
            <Box marginTop={2}>
              <Button key="toggle" plain dimColor onPress={toggle}>
                [show numbers]
              </Button>
            </Box>
          </Box>
        )
      }

      // The boxes share the width left of the pet: equal widths, the spare columns
      // going one each to the first boxes
      const count = Math.min(3, Math.floor((room + 1) / (MIN_CARD + 1)))
      const each = Math.floor((room - (count - 1)) / count)
      const spare = room - (count - 1) - each * count
      const chosen = buildCards(each - 4, now).slice(0, count)
      return (
        <Box columnGap={2}>
          {pet}
          <Box flexDirection="column" marginTop={1}>
            <Box columnGap={3}>
              <Text wrap="truncate-end">
                {statusLine(face, now).map((part) =>
                  part.color === undefined ? (
                    <Text dimColor>{part.text}</Text>
                  ) : (
                    <Text color={hex(part.color)} bold={part.bold}>
                      {part.text}
                    </Text>
                  ),
                )}
              </Text>
              <Button key="toggle" plain dimColor onPress={toggle}>
                [hide]
              </Button>
            </Box>
            <Box columnGap={1}>
              {chosen.map((card, i) => (
                <Box
                  key={card.title}
                  flexDirection="column"
                  width={each + (i < spare ? 1 : 0)}
                  height={5}
                  borderStyle="round"
                  borderColor={card.border === undefined ? undefined : hex(card.border)}
                  borderDimColor={card.border === undefined}
                  paddingX={1}
                  overflow="hidden"
                >
                  <Text wrap="truncate-end">
                    <Text dimColor bold>
                      {card.title}
                    </Text>
                    {(card.extra ?? []).map((part) =>
                      part.color === undefined ? (
                        <Text dimColor>{part.text}</Text>
                      ) : (
                        <Text color={hex(part.color)}>{part.text}</Text>
                      ),
                    )}
                  </Text>
                  {card.lines
                    .filter((parts) => parts.length > 0)
                    .map((parts) => (
                      <Text wrap="truncate-end">
                        {parts.map((part) =>
                          part.color === undefined ? (
                            <Text dimColor>{part.text}</Text>
                          ) : (
                            <Text color={hex(part.color)} bold={part.bold}>
                              {part.text}
                            </Text>
                          ),
                        )}
                      </Text>
                    ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )
    }

    // Everywhere else: a text face and one line of numbers
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color={statusColor(face) === undefined ? undefined : hex(statusColor(face)!)}>{TEXT_FACE[face]} </Text>
        <Text dimColor>{compactLine()}</Text>
      </Box>
    )
  })
}
