import { expect, test } from 'claude-code/testing'

const band = (bodyColumns: number, maxRows = 20) =>
  ({
    plugin: 'buddy-pet',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows,
      bodyColumns,
      scroll: { offset: 0, bodyRows: maxRows },
      view: {},
    },
  }) as const

// What the engine answers beneath the mod: the clock, the store, the session and its
// figures, the command it registers, and a drawing of its own where the mod passes
function engine(on: any) {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pet' } }))
  on('session.usage', () => ({
    value: {
      context: { tokens: 245000, window: 1000000, percent: 24 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
      cost: { usd: 1.5 },
    },
  }))
  on('classic.PostToolUseFailure', () => ({}))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

test('a wide terminal draws the three boxes and the status line', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band(120))
  for (const title of ['CONTEXT', 'SESSION', 'LIMITS']) {
    expect((await ui.find({ type: 'Text', text: new RegExp(title) }))?.text).toContain(title)
  }
  expect((await ui.find({ type: 'Text', text: /chilling/ }))?.text).toContain('chilling')
  await ui.unmount()
})

test('a narrow terminal falls back to a text face and one line of numbers', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band(40))
  expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /ctx 24%/ }))?.text).toContain('ctx 24%')
  await ui.unmount()
})

test('a band too short for the pet falls back to the text face', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(band(120, 5))
  expect(await ui.find({ type: 'Text', text: /CONTEXT/ })).toBeUndefined()
  await ui.unmount()
})

test('a failing tool makes the pet alarmed', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, error: 'boom' } as any)

  const ui = await $.ui.mount(band(120))
  expect((await ui.find({ type: 'Text', text: /a tool failed/ }))?.text).toContain('a tool failed')
  await ui.unmount()
})

test('/pet budget sets the budget and /pet theme checks the name', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // The test kit types a command run with the fields the engine adds; the mod reads two
  const run = (args: string) => $.command.run({ command: 'pet', args } as any)

  expect((await run('budget 20')).text).toBe('Cost budget set to $20.00.')
  expect((await run('theme pink')).text).toBe('Pet theme: pink.')
  expect((await run('theme plaid')).text).toContain('Themes:')
})
