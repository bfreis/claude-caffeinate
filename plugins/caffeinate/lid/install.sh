#!/bin/sh
# Installs (or updates) the lid helper. Run as root: install.sh USER, where USER may register holders.
# The daemon runs from a root-owned copy, never from the plugin directory, which the user can write.
set -u
# System tools only: a root script must not pick up whatever is first on the PATH (e.g. GNU stat from Homebrew)
export PATH=/usr/bin:/bin:/usr/sbin:/sbin

DIR=/Library/Application\ Support/claude-caffeinate
LABEL=com.bfreis.claude-caffeinate.lid
PLIST=/Library/LaunchDaemons/$LABEL.plist
here=$(cd "$(dirname "$0")" && pwd)

fail() {
  echo "caffeinate lid helper: $*" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "only macOS is supported"
[ "$(id -u)" = 0 ] || fail "must run as root"
[ $# -eq 1 ] && id -u "$1" >/dev/null 2>&1 || fail "usage: install.sh USER (an existing user)"
[ -f "$here/lidd.sh" ] || fail "lidd.sh not found next to install.sh"

launchctl bootout "system/$LABEL" 2>/dev/null || true

mkdir -p "$DIR" || fail "cannot create $DIR"
chown root:wheel "$DIR" && chmod 755 "$DIR" || fail "cannot set permissions on $DIR"
cp "$here/lidd.sh" "$DIR/lidd.sh" || fail "cannot copy lidd.sh"
chown root:wheel "$DIR/lidd.sh" && chmod 755 "$DIR/lidd.sh" || fail "cannot set permissions on lidd.sh"
mkdir -p "$DIR/holders" || fail "cannot create $DIR/holders"
chown "$1" "$DIR/holders" && chmod 755 "$DIR/holders" || fail "cannot set permissions on $DIR/holders"

cat > "$PLIST" <<PLIST_EOF || fail "cannot write $PLIST"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$DIR/lidd.sh</string>
  </array>
  <key>WatchPaths</key>
  <array>
    <string>$DIR/holders</string>
  </array>
  <key>StartInterval</key>
  <integer>5</integer>
  <key>ThrottleInterval</key>
  <integer>1</integer>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
PLIST_EOF
chown root:wheel "$PLIST" && chmod 644 "$PLIST" || fail "cannot set permissions on $PLIST"

launchctl bootstrap system "$PLIST" || fail "launchctl bootstrap failed"
