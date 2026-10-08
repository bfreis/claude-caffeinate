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
| Lid closed | **Sleep as usual** (default), or stay awake with the lid closed (macOS; one-time admin install, see below) |

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
- Closing a laptop's lid still sleeps it, unless you turn on [Lid closed](#lid-closed-macos) (off by default).
- Works in the terminal. The Claude desktop app's Code tab does not run mod processes.

## Lid closed (macOS)

macOS sleeps when you close a laptop's lid whatever `caffeinate` says. The one thing that prevents it is
`pmset -a disablesleep 1`, which needs root and applies to the whole machine. The **Lid closed** setting does that
for you, only while the mod is holding the machine awake.

- **Opt-in.** It is off by default, and nothing asks for admin rights until you turn it on in `/caffeinate`.
- **One admin prompt.** The first time you turn it on, macOS asks for your password once, to install a small helper.
  It asks again only if a plugin update changes the helper (`/caffeinate` then shows an *Install/Update lid helper*
  button; nothing prompts by itself). Turning the setting off leaves the idle helper installed, so turning it on
  again does not ask.
- **What is installed.** A LaunchDaemon, `/Library/LaunchDaemons/com.bfreis.claude-caffeinate.lid.plist`, and its
  script and state in `/Library/Application Support/claude-caffeinate/`. The daemon runs a root-owned copy of
  `lid/lidd.sh`, never the plugin directory.
- **How it works.** While the mod holds, the command it runs registers its PID as a file in the helper's `holders`
  directory. The helper sets `disablesleep 1` while any registered process is alive and your user owns its file, and
  sets it back to 0 when none is. A holder that dies (Claude Code quits or crashes, the mod stops the command) is
  cleaned up within about 5 seconds. The helper only undoes what it set itself; it never overrides a `pmset` change
  you made by hand.
- **Recovery.** If the Mac is ever stuck awake: `sudo pmset -a disablesleep 0`.
- **Uninstall.** Use *Uninstall lid helper* in `/caffeinate`, or `sudo sh <plugin>/lid/uninstall.sh`.
- **Mind the heat.** A Mac that stays awake with the lid closed, in a bag for example, gets warm and drains its
  battery. Use it when you mean it.
- It needs Claude Code running natively on the Mac: the mod's processes run where Claude Code runs, so over SSH or in
  a container the setting has nothing to hold.

## Develop

```sh
claude --plugin-dir plugins/caffeinate        # hot-reloads on save
claude plugin validate --strict plugins/caffeinate
claude plugin test plugins/caffeinate
sh plugins/caffeinate/tests/lid.test.sh       # the lid helper, on macOS, without root
```

## License

MIT, see [LICENSE](LICENSE).
