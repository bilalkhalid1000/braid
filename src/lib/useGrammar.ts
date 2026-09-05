import { useEffect, useState } from "react";

import Prism from "prismjs";

import { ensureGrammar } from "./highlight";

/** True once `language`'s grammar is loaded, so a view can highlight. A
 *  language with no grammar, or none at all, is ready at once. */
export function useGrammar(language: string | null): boolean {
  const [ready, setReady] = useState(() => !language || Boolean(Prism.languages[language]));

  useEffect(() => {
    if (!language || Prism.languages[language]) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void ensureGrammar(language).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return ready;
}
