# claude-caffeinate

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that keeps your computer awake while
Claude works, so a long turn isn't cut short because the machine went to sleep.

By default it runs macOS's `caffeinate -i` when a turn starts and stops it when the turn ends. The machine sleeps
normally the rest of the time.

## Install

```sh
claude plugin marketplace add bfreis/claude-caffeinate
claude plugin install caffeinate@caffeinate
```

Requires Claude Code 2.1.287 or later (mods). Tested with 2.1.292.

## Configure

Run `/caffeinate` to open the settings pane:

| Setting | Choices |
| --- | --- |
| Keep awake | **While Claude is working** (default), for the whole session, or off |
| Scheduled wake-ups | While Claude is working: **stay awake while a `/loop`, `ScheduleWakeup` or `CronCreate` task is pending** (default), or let it sleep until then |
| Using | **caffeinate** (macOS, default), or a custom command |
| Flags (caffeinate) | **`-i`** no idle sleep, display may sleep (default) · `-di` display stays on too · `-s` no system sleep, on AC power only · `-ims` no idle, disk or system sleep |
| Command (custom) | Any command that keeps the machine awake while it runs, e.g. `systemd-inhibit --what=idle sleep infinity` on Linux |

Settings are saved once for every session on the machine. Open sessions pick up a change at their next turn, or
within 15 seconds.

A custom command is split into words like a shell would (quotes and backslashes work), but runs **without** a shell:
no variables, pipes or `&&`. Wrap it in `sh -c '...'` if you need those. The mod stops the command when awake is no
longer wanted, so it should run until it is stopped. One that exits by itself is reported in the status line and
started again on the next refresh.

## How it behaves

- **Each session holds its own block.** Two sessions each start their own `caffeinate`, and macOS stays awake while
  any of them runs. When one session's turn ends, the other session's turn still keeps the machine awake.
- **Nothing is left behind.** The command is a child of the session: quitting Claude Code, closing the terminal, or
  reloading the mod stops it.
- **"While Claude is working" covers background work.** That means the turn itself, plus anything the turn leaves
  running: a monitor, a background shell, a background agent or workflow. When that work finishes it starts a new
  turn, and the machine may sleep once a turn ends with nothing left running. (The mod reads this from what Claude
  Code reports at the end of each turn. An interrupted turn reports nothing, so the mod keeps what the previous turn
  reported until the next turn ends.)
- **Scheduled wake-ups count as work too, by default.** A session waiting on a `/loop`, `ScheduleWakeup` or
  `CronCreate` task keeps the machine awake, so the wake-up runs on time. A recurring `/loop` therefore keeps it
  awake for as long as the loop exists. Turn this off to let the machine sleep while one waits; the wake-up then
  runs once the machine is awake again.
- While it holds, the status line under the prompt says why, e.g. `☕ keeping awake: 1 background task running`.
- Closing a laptop's lid still sleeps it: `caffeinate` can't prevent that unless an external display is attached.
- Works in the terminal. The Claude desktop app's Code tab does not run mod processes.

## Develop

```sh
claude --plugin-dir plugins/caffeinate        # hot-reloads on save
claude plugin validate --strict plugins/caffeinate
claude plugin test plugins/caffeinate
```

## License

MIT, see [LICENSE](LICENSE).
