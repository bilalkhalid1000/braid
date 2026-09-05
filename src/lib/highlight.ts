import Prism from "prismjs";

/** The grammars beyond the four Prism core carries -- markup, css, clike and
 *  javascript -- each fetched the first time a file needs it. Loading all of
 *  them at startup was a fifth of the bundle parsed and held for languages
 *  most repositories never show. */
const LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("prismjs/components/prism-typescript"),
  jsx: () => import("prismjs/components/prism-jsx"),
  tsx: () => import("prismjs/components/prism-tsx"),
  rust: () => import("prismjs/components/prism-rust"),
  json: () => import("prismjs/components/prism-json"),
  yaml: () => import("prismjs/components/prism-yaml"),
  toml: () => import("prismjs/components/prism-toml"),
  bash: () => import("prismjs/components/prism-bash"),
  python: () => import("prismjs/components/prism-python"),
  go: () => import("prismjs/components/prism-go"),
  java: () => import("prismjs/components/prism-java"),
  c: () => import("prismjs/components/prism-c"),
  cpp: () => import("prismjs/components/prism-cpp"),
  csharp: () => import("prismjs/components/prism-csharp"),
  sql: () => import("prismjs/components/prism-sql"),
  scss: () => import("prismjs/components/prism-scss"),
  markdown: () => import("prismjs/components/prism-markdown"),
  ini: () => import("prismjs/components/prism-ini"),
  docker: () => import("prismjs/components/prism-docker"),
};

/** A grammar that extends another has to come after it. */
const NEEDS: Record<string, string[]> = {
  tsx: ["jsx", "typescript"],
  cpp: ["c"],
};

const loading = new Map<string, Promise<void>>();

/** Make sure a language's grammar is present, fetching it if not. Resolves
 *  at once for a core language or one already loaded, and for a language
 *  there is no grammar for, which then highlights as nothing. */
export function ensureGrammar(language: string): Promise<void> {
  if (Prism.languages[language]) return Promise.resolve();
  const load = LOADERS[language];
  if (!load) return Promise.resolve();

  let pending = loading.get(language);
  if (!pending) {
    pending = Promise.all((NEEDS[language] ?? []).map(ensureGrammar))
      .then(load)
      .then(() => undefined);
    loading.set(language, pending);
  }
  return pending;
}

/** A run of characters that share a colour. `type` is Prism's own class name,
 *  or undefined for ordinary code. */
export interface Token {
  text: string;
  type?: string;
}

/** Past this, highlighting is skipped and the file is shown as plain text.
 *
 *  Tokenizing is one pass over the whole file — it has to be, see below — and it
 *  blocks, so the ceiling is a budget for how long the window may freeze rather
 *  than a guess at what counts as big. Measured at roughly 0.4ms/KB, which puts
 *  this at about 50ms in the worst case; the largest files in this repo are a
 *  third of it. A vendored bundle or a generated lockfile is exactly what this
 *  is here to refuse, and nobody reads one line by line anyway. */
const MAX_BYTES = 128 * 1024;

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  rs: "rust",
  json: "json",
  jsonc: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sql: "sql",
  css: "css",
  scss: "scss",
  sass: "scss",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  md: "markdown",
  markdown: "markdown",
  ini: "ini",
  cfg: "ini",
};

/** Files whose whole name decides the language. */
const BY_NAME: Record<string, string> = {
  dockerfile: "docker",
  makefile: "bash",
  ".gitignore": "bash",
  ".gitattributes": "bash",
  ".env": "bash",
};

/** The Prism language for a path, or null if we have no grammar for it. */
export function languageOf(path: string): string | null {
  const file = path.slice(path.lastIndexOf("/") + 1).toLowerCase();

  const byName = BY_NAME[file];
  if (byName) return byName;

  const dot = file.lastIndexOf(".");
  if (dot <= 0) return null;

  const language = BY_EXTENSION[file.slice(dot + 1)];
  return language && (Prism.languages[language] || LOADERS[language]) ? language : null;
}

/** Tokenize a whole file and hand back one token list per line.
 *
 *  Whole file rather than line by line, which is the entire difficulty here.
 *  Prism has no incremental API and a line carries no memory of the one above
 *  it, so highlighting each separately reopens every construct that spans more
 *  than one: a block comment would colour its first line and nothing else, and
 *  a template literal would turn the rest of the file into a string. So the
 *  file is tokenized once and the token stream is cut at the newlines, which
 *  splits the runs without ever losing the parser's place.
 *
 *  Returns null when highlighting is skipped, so callers render plain text
 *  rather than an empty file.
 */
export function highlightLines(text: string, language: string | null): Token[][] | null {
  if (!language) return null;

  const grammar = Prism.languages[language];
  if (!grammar) return null;
  if (text.length > MAX_BYTES) return null;

  return split(text, grammar);
}

/** One line of a diff, as far as highlighting cares. */
export interface HunkLine {
  kind: string;
  content: string;
}

/** Tokenize each hunk of a diff, one entry per line, aligned with the input.
 *
 *  A diff is not a file, which is what makes this different from the above. Its
 *  hunks are fragments with gaps between them, so tokenizing the lot as one
 *  document would carry a construct straight across a boundary -- a comment
 *  opened in one hunk and closed in a region the diff skipped would swallow
 *  everything after it.
 *
 *  Nor is a diff one version of anything: removed lines belong to the old file
 *  and added lines to the new, so a single pass would be reading one of them in
 *  the wrong context. Each hunk is therefore rebuilt twice -- context plus
 *  removed for the old side, context plus added for the new -- and each side
 *  tokenized on its own.
 *
 *  It stays an approximation, because a hunk carries only the few lines of
 *  context the diff included. An unterminated string colours to the end of its
 *  hunk rather than the end of the file. Every diff viewer has this; bounding
 *  the damage to one hunk is the point.
 */
export function highlightHunks(
  hunks: Array<{ lines: HunkLine[] }>,
  language: string | null,
): Array<Array<Token[] | undefined>> | null {
  if (!language) return null;

  const grammar = Prism.languages[language];
  if (!grammar) return null;

  const size = hunks.reduce(
    (total, hunk) =>
      total + hunk.lines.reduce((n, line) => n + line.content.length + 1, 0),
    0,
  );
  if (size > MAX_BYTES) return null;

  return hunks.map((hunk) => {
    const before: string[] = [];
    const after: string[] = [];

    for (const line of hunk.lines) {
      if (line.kind === "meta") continue;
      if (line.kind !== "added") before.push(line.content);
      if (line.kind !== "removed") after.push(line.content);
    }

    const oldSide = split(before.join("\n"), grammar);
    const newSide = split(after.join("\n"), grammar);

    let o = 0;
    let n = 0;

    return hunk.lines.map((line) => {
      // The "no newline at end of file" marker is not code and has no side.
      if (line.kind === "meta") return undefined;
      if (line.kind === "added") return newSide[n++];
      if (line.kind === "removed") return oldSide[o++];

      // Context is in both, and identical in both. Taking the new side is
      // arbitrary; advancing both counters is not.
      o++;
      return newSide[n++];
    });
  });
}

/** Tokenize, then cut the stream at the newlines. */
function split(text: string, grammar: Prism.Grammar): Token[][] {
  const flat: Token[] = [];
  collect(Prism.tokenize(text, grammar), undefined, flat);

  const lines: Token[][] = [[]];
  for (const token of flat) {
    // A run that straddles a newline becomes one run per line, all keeping the
    // type they were tokenized with.
    const parts = token.text.split("\n");

    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== "") lines[lines.length - 1]!.push({ text: part, type: token.type });
    });
  }

  return lines;
}

/** Flatten Prism's nested token tree into runs of text.
 *
 *  Nested tokens keep the innermost type, which is the specific one — the
 *  string inside an attribute is a string, and colouring it as the attribute
 *  would lose the distinction the grammar just made. */
function collect(
  tokens: Array<string | Prism.Token>,
  type: string | undefined,
  out: Token[],
): void {
  for (const token of tokens) {
    if (typeof token === "string") {
      if (token !== "") out.push({ text: token, type });
      continue;
    }

    const alias = Array.isArray(token.alias) ? token.alias.join(" ") : token.alias;
    const own = alias ? `${token.type} ${alias}` : token.type;

    if (typeof token.content === "string") {
      out.push({ text: token.content, type: own });
    } else {
      collect(
        Array.isArray(token.content) ? token.content : [token.content],
        own,
        out,
      );
    }
  }
}
