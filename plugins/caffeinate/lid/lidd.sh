#!/bin/sh
# The lid helper: runs as root under launchd, once per run (launchd starts it again when a holder file appears and
# every few seconds). Keeps `pmset disablesleep` at 1 while some live process has registered a holder file, else 0.
set -u
# System tools only: a root script must not pick up whatever is first on the PATH (e.g. GNU stat from Homebrew)
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

DIR=${CAFFEINATE_LID_DIR:-/Library/Application Support/claude-caffeinate}
PMSET=${CAFFEINATE_LID_PMSET:-/usr/bin/pmset}
HOLD=$DIR/holders
# Root-owned marker: "we set disablesleep 1". Without it we never touch pmset, so a manual change is left alone.
HELD=$DIR/held

want=0
if [ -d "$HOLD" ]; then
  for f in "$HOLD"/*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    name=${f##*/}
    case $name in
      '' | *[!0-9]*) rm -f "$f"; continue ;;
    esac
    if [ -L "$f" ] || [ ! -f "$f" ]; then
      rm -f "$f"
      continue
    fi
    # A holder counts only while its PID is alive and still belongs to whoever created the file
    owner=$(stat -f %u "$f" 2>/dev/null)
    puid=$(ps -o uid= -p "$name" 2>/dev/null | tr -d ' ')
    if [ -n "$puid" ] && [ "$puid" = "$owner" ]; then
      want=1
    else
      rm -f "$f"
    fi
  done
fi

if [ "$want" = 1 ] && [ ! -e "$HELD" ]; then
  "$PMSET" -a disablesleep 1 && : > "$HELD"
elif [ "$want" = 0 ] && [ -e "$HELD" ]; then
  "$PMSET" -a disablesleep 0 && rm -f "$HELD"
fi
exit 0
