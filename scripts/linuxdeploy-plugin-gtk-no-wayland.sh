#!/usr/bin/env bash
# linuxdeploy's GTK plugin, with libwayland dropped from the AppDir afterwards.
#
# Mesa's libEGL_mesa.so.0 has libwayland-client.so.0 as a direct NEEDED. The
# AppImage puts its own usr/lib first on LD_LIBRARY_PATH, so the *host* Mesa
# links against whatever libwayland the build machine happened to ship. Ubuntu
# 22.04 ships wayland 1.20; wl_fixes_interface arrived in 1.24. On any host with
# a newer Mesa the vendor library fails to dlopen, libglvnd is left with no EGL
# vendor at all, and WebKitWebProcess aborts on startup with
#   "Could not create default EGL display: ... Aborting..."
# — a blank window and a core dump, one second after launch.
#
# libwayland belongs to the same ABI island as the host compositor and Mesa,
# exactly like libGL/libEGL/libdrm/libX11, which the AppImage excludelist already
# drops. It just never made it onto that list.
#
# This hooks the GTK plugin rather than linuxdeploy itself because linuxdeploy's
# own --exclude-library does not reach here: the plugin shells out to a second
# linuxdeploy of its own to pull in GTK's dependency tree, and that is what drags
# libwayland in. Deleting after the plugin has run covers both passes. It is the
# last thing to touch the AppDir before the output plugin packs it — true while
# gtk is the only input plugin, which bundleMediaFramework being off guarantees.
# The release workflow asserts the result either way.
#
# ponytail: a wrapper because tauri-bundler hardcodes the plugin's argv and
# offers no exclude hook. Delete this, and the seed step in release.yml, if tauri
# ever exposes one.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
"$here/upstream-gtk-plugin.sh" "$@"

appdir=
while [ $# -gt 0 ]; do
  case "$1" in
    --appdir) appdir="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[ -n "$appdir" ] && rm -fv "$appdir"/usr/lib/libwayland-*
exit 0
