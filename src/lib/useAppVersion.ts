import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { releaseChannel, type Channel } from "./version";

export interface AppVersion {
  version: string;
  channel: Channel;
}

/** The version compiled into this build, and what channel it implies.
 *
 *  Read from the binary rather than from package.json, so it is the version
 *  that actually shipped — a frontend bundled into an older installer would
 *  otherwise claim to be whatever the source tree said at build time.
 */
export function useAppVersion(): AppVersion {
  const [version, setVersion] = useState("");

  useEffect(() => {
    let cancelled = false;

    void getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      // Outside a Tauri window there is no version to read; an unknown version
      // is not worth a crash.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return { version, channel: releaseChannel(version) };
}
