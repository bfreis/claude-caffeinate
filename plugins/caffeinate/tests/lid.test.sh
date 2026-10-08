#!/bin/sh
# Tests lidd.sh and hold.sh without root, against a temp directory and a stub pmset. Needs macOS (BSD stat, ps).
# Run: sh tests/lid.test.sh
set -u

here=$(cd "$(dirname "$0")/../lid" && pwd)
T=$(mktemp -d)
pids=
cleanup() {
  [ -n "$pids" ] && kill $pids 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT

export CAFFEINATE_LID_DIR=$T/dir
export CAFFEINATE_LID_PMSET=$T/pmset
LOG=$T/log
mkdir -p "$T/dir/holders"
printf '#!/bin/sh\necho "$*" >> "%s"\n' "$LOG" > "$T/pmset"
chmod +x "$T/pmset"
: > "$LOG"

failed=0
check() { # name, condition result (0 = pass)
  if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; failed=1; fi
}
run() { sh "$here/lidd.sh"; }
calls() { wc -l < "$LOG" | tr -d ' '; }

run
check "no holders: no pmset call" "$([ "$(calls)" = 0 ]; echo $?)"

sleep 30 &
pid=$!
pids=$pid
: > "$T/dir/holders/$pid"
run
check "live holder: disablesleep 1 once" "$([ "$(calls)" = 1 ] && [ "$(cat "$LOG")" = "-a disablesleep 1" ]; echo $?)"
check "live holder: held marker created" "$([ -e "$T/dir/held" ]; echo $?)"
run
check "second run: no extra call" "$([ "$(calls)" = 1 ]; echo $?)"

kill $pid
wait $pid 2>/dev/null
run
check "holder gone: disablesleep 0" "$([ "$(calls)" = 2 ] && [ "$(tail -n 1 "$LOG")" = "-a disablesleep 0" ]; echo $?)"
check "holder gone: held marker removed" "$([ ! -e "$T/dir/held" ]; echo $?)"
check "holder gone: stale file removed" "$([ ! -e "$T/dir/holders/$pid" ]; echo $?)"

: > "$T/dir/holders/abc"
ln -s /etc/hosts "$T/dir/holders/12345"
run
check "junk: non-numeric file removed" "$([ ! -e "$T/dir/holders/abc" ]; echo $?)"
check "junk: digit-named symlink removed" "$([ ! -L "$T/dir/holders/12345" ]; echo $?)"
check "junk: holds nothing" "$([ "$(calls)" = 2 ]; echo $?)"

# Without the marker, a manual pmset change is left alone
run
check "idle with no marker: no call" "$([ "$(calls)" = 2 ]; echo $?)"

sh "$here/hold.sh" sleep 30 &
hpid=$!
pids="$pids $hpid"
sleep 1
check "hold.sh: registers its PID" "$([ -f "$T/dir/holders/$hpid" ]; echo $?)"
cmd=$(ps -o command= -p "$hpid" 2>/dev/null)
check "hold.sh: execs the command" "$([ "${cmd#sleep}" != "$cmd" ]; echo $?)"
run
check "hold.sh holder counts" "$([ "$(calls)" = 3 ] && [ "$(tail -n 1 "$LOG")" = "-a disablesleep 1" ]; echo $?)"

exit $failed
