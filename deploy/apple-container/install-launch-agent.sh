#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
install_dir="$HOME/.my-wiki-demo/bin"
launch_agents="$HOME/Library/LaunchAgents"
label="com.my-wiki.demo-container"
plist="$launch_agents/$label.plist"
runner="$install_dir/my-wiki-container-keep-alive.sh"
stdout_log="$HOME/Library/Logs/$label.out.log"
stderr_log="$HOME/Library/Logs/$label.err.log"
domain="gui/$(id -u)"

install -d -m 700 "$install_dir"
install -d -m 755 "$launch_agents"
install -m 755 "$script_dir/keep-alive.sh" "$runner"

rm -f "$plist"
plutil -create xml1 "$plist"
plutil -insert Label -string "$label" "$plist"
plutil -insert ProgramArguments -array "$plist"
plutil -insert ProgramArguments.0 -string "$runner" "$plist"
plutil -insert RunAtLoad -bool true "$plist"
plutil -insert KeepAlive -bool true "$plist"
plutil -insert ProcessType -string Background "$plist"
plutil -insert StandardOutPath -string "$stdout_log" "$plist"
plutil -insert StandardErrorPath -string "$stderr_log" "$plist"

launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$plist"
launchctl kickstart -k "$domain/$label"

printf 'Installed launch agent: %s\n' "$label"
