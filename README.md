<p align="center">
  <img src=".claude-plugin/icon.png" alt="buddy-pet" width="128" height="128">
</p>

# buddy-pet

A small pixel-art robot that lives above the Claude Code prompt. It reacts to what Claude is doing (thinking, running a tool, waiting for your approval, done, failed) and sits beside a dashboard of the numbers worth watching: context, session cost and rate limits.

## What you get

- **A pet that shows what Claude is doing.** The eyes, the antenna tips and the ears change with every step of a turn, so you can tell at a glance whether Claude is busy, stuck on a permission prompt, or finished.
- **A dashboard of three boxes** that fills the width of the terminal:
  - **Context**: percent used, tokens used and free, a bar, and an estimate of how many turns are left.
  - **Session**: cost, how much of your budget it is, tools and turns, cost per turn, and your all-time total.
  - **Limits**: the 5-hour and 7-day windows as bars, and when the first one resets.
- **A status line** over the boxes: a spinner while Claude works, how long it has lasted, the last tool used, and how many subagents are running.
- **Warnings that are hard to miss.** A toast and a startled pet when the context passes 70, 85 and 95 percent, and when the session cost passes 50, 80 and 100 percent of your budget.
- **Short sounds** when a turn finishes, when Claude asks for approval, and when a tool fails.

## Requirements

- Claude Code with mods (hooks modules) enabled.
- The terminal surface. The pixel art needs `Raster`, which only the terminal draws. Elsewhere you get a text face and one line of numbers.
- Room for the pet: at least 8 free rows and about 51 columns. Narrower than that, the pet falls back to the text face.
- macOS for the sounds (they play through `afplay`). On other systems the pet stays quiet and works as usual.

## Install

From a marketplace, at the prompt of a Claude Code session (answer `y` to add the marketplace, then pick a scope):

```
/plugin install buddy-pet --marketplace ganjardbc/buddy-pet
```

Or from a shell:

```sh
claude plugin install buddy-pet --marketplace ganjardbc/buddy-pet
```

From a clone of this repository, to try it or to work on it:

```sh
claude --plugin-dir /path/to/buddy-pet
```

A folder loaded with `--plugin-dir` reloads by itself when its files change. To reload by hand, run `/reload-plugins`.

## The `/pet` command

| Command | What it does |
| --- | --- |
| `/pet` or `/pet compact` | Hide or show the numbers, leaving only the pet. |
| `/pet sound` | Mute or unmute the sounds. |
| `/pet budget <usd>` | Set the session budget the cost is measured against. The default is `$10`. `0` turns it off. |
| `/pet theme <name>` | Change the eye and accent color: `blue`, `cyan`, `violet`, `pink` or `lime`. |

The `[hide]` button at the end of the status line does the same as `/pet compact`. Your choices are kept between sessions.

## What the pet does

| When | The pet |
| --- | --- |
| A turn starts | Looks off to the side, antenna tips blink. |
| A tool runs | Eyes scan left and right, status shows `running <tool>`. |
| Claude asks for approval | Looks down, ears and tips turn amber. |
| A tool fails | X eyes and red ears for a few seconds. |
| A turn ends | Smiling eyes, the ears take turns lighting green. |
| Context or budget crosses a warning level | Wide eyes for a few seconds. |
| The conversation is compacted | Smiling eyes, and the trend starts over. |
| Context is above 85 percent | Tired, with drooping eyes. |
| Nothing happens for two minutes | Sleepy. |
| Idle | Blinks, winks, and glances left and right. |

While subagents run, the two antenna tips take turns blinking.

## Colors

- **Context**: green under 60 percent, amber from 60, red from 85.
- **Limits**: green under 70 percent, amber from 70, red from 90.
- **Session cost**: dim until half of the budget, amber from half, red at the budget.

## Your data

The mod stores three small values in Claude Code's own plugin store: your `/pet` choices, your all-time totals (tools, turns, cost) and the recent context trend. Nothing leaves your machine, and the mod makes no network calls.

## Development

There is no build step. The mod is two TypeScript files that Claude Code loads directly:

- `hooks/register.tsx` holds the event handlers, the state, the `/pet` command and the dashboard.
- `hooks/pet-art.ts` draws the pet: a 12 x 14 pixel grid packed into terminal cells.

Check the types, the manifest and the tests with:

```sh
npx tsc -p tsconfig.json
claude plugin validate .
claude plugin test .
```

The tests in `hooks/register.test.tsx` run the mod against the engine's test kit: the dashboard on a wide terminal, the fallbacks on a narrow or short one, the pet's reaction to a failing tool, and the `/pet` command.

The types in `.claude-plugin/types/` are written by Claude Code when it loads the mod. They are not part of the source.

One rule of the art is worth knowing before you change it: two pixels share a terminal cell, and the terminal's line spacing draws a faint seam where a shape crosses from one cell row into the next. Keep the eyes, the visor and the head on cell edges (even pixel rows) or the seam splits them.

## License

MIT. See [LICENSE](LICENSE).
