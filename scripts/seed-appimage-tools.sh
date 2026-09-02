#!/usr/bin/env bash
# Put linuxdeploy-plugin-gtk-no-wayland.sh in front of the real GTK plugin, in
# the tools cache tauri-bundler builds AppImages out of. Run before `tauri build
# --bundles appimage`; the release workflow runs it too.
#
# tauri-bundler fetches each tool only when it is not already in the cache, which
# is the whole hook: seed the slot and it uses what it finds. See the wrapper for
# what it fixes.
#
# The upstream plugin is parked under a name that does NOT match linuxdeploy's
# plugin-discovery regex, ^linuxdeploy-plugin-([^\s.-]+)(-[^.]+)?(\..+)?$. Called
# anything like linuxdeploy-plugin-gtk-real.sh it registers as a second "gtk"
# plugin and linuxdeploy runs it instead of the wrapper — silently, and the
# AppImage ships libwayland again.
#
# Building on Arch also wants NO_STRIP=1: linuxdeploy's bundled strip is too old
# for the .relr.dyn sections in current Arch libraries. Ubuntu runners are fine.
set -euo pipefail

tools="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$tools"

if [ ! -s "$tools/upstream-gtk-plugin.sh" ]; then
  curl -fsSL -o "$tools/upstream-gtk-plugin.sh" \
    https://raw.githubusercontent.com/tauri-apps/linuxdeploy-plugin-gtk/master/linuxdeploy-plugin-gtk.sh
  chmod +x "$tools/upstream-gtk-plugin.sh"
fi

install -m755 "$here/linuxdeploy-plugin-gtk-no-wayland.sh" "$tools/linuxdeploy-plugin-gtk.sh"
echo "seeded $tools/linuxdeploy-plugin-gtk.sh"
