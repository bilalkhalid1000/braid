import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

/** Apply a theme choice, resolving "system" against the OS.
 *
 *  The choice itself lives in settings.json, which only the backend can read.
 *  It is mirrored into localStorage here so the inline script in index.html can
 *  paint the correct background before this bundle has even downloaded —
 *  without that mirror, every launch flashes the wrong colour. settings.json
 *  stays the source of truth; this is a cache for the first frame.
 */
export function useTheme(choice: ThemeChoice): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  // "System" stays live: switching Windows to dark flips the app immediately
  // rather than on next launch.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" =
    choice === "system" ? (systemDark ? "dark" : "light") : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem("theme", choice);
  }, [resolved, choice]);

  return resolved;
}
