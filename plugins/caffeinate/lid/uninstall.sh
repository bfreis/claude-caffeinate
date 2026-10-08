#!/bin/sh
# Removes the lid helper. Run as root. Safe to run again.
set -u
# System tools only: a root script must not pick up whatever is first on the PATH (e.g. GNU stat from Homebrew)
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

DIR=/Library/Application\ Support/claude-caffeinate
LABEL=com.bfreis.claude-caffeinate.lid
PLIST=/Library/LaunchDaemons/$LABEL.plist

launchctl bootout "system/$LABEL" 2>/dev/null || true
# Put sleep back if the helper had turned it off
if [ -e "$DIR/held" ]; then
  /usr/bin/pmset -a disablesleep 0
fi
rm -f "$PLIST"
rm -rf "$DIR"
