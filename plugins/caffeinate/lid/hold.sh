#!/bin/sh
# Registers this process as a lid holder, then becomes the command: the registered PID is the command itself, so
# when the mod stops it the helper sees the PID is gone and lets the Mac sleep again. Without the helper installed
# the registration just fails and the command runs as usual.
set -u

DIR=${CAFFEINATE_LID_DIR:-/Library/Application Support/claude-caffeinate}

: > "$DIR/holders/$$" 2>/dev/null
exec "$@"
