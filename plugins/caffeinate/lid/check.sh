#!/bin/sh
# Is the lid helper installed and current? No privileges needed.
# Exit 0 installed and current, 1 not installed, 2 outdated, 3 not macOS.
set -u
# System tools only: a root script must not pick up whatever is first on the PATH (e.g. GNU stat from Homebrew)
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

DIR=${CAFFEINATE_LID_DIR:-/Library/Application Support/claude-caffeinate}
LABEL=com.bfreis.claude-caffeinate.lid
PLIST=/Library/LaunchDaemons/$LABEL.plist
here=$(cd "$(dirname "$0")" && pwd)

[ "$(uname -s)" = Darwin ] || exit 3
[ -f "$PLIST" ] && [ -f "$DIR/lidd.sh" ] || exit 1
cmp -s "$here/lidd.sh" "$DIR/lidd.sh" || exit 2
exit 0
