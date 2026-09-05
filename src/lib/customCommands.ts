import type { Keymap } from "./commands";

/** Where a custom command shows up, and what it can refer to. */
export type CustomContext = "global" | "branch" | "commit" | "file" | "remote" | "stash" | "tag";

export const CUSTOM_CONTEXTS: CustomContext[] = [
  "global",
  "branch",
  "commit",
  "file",
  "remote",
  "stash",
  "tag",
];

export interface CustomPrompt {
  /** Referred to in the command as {{prompt.key}}. */
  key: string;
  label: string;
  /** Offered as choices; anything else can still be typed. */
  options?: string[];
  /** Prefilled, with placeholders allowed. */
  value?: string;
}

/** A command of the user's own, from the settings file.
 *
 *  Modelled on lazygit's, with the same placeholders where the names carry
 *  over: {{branch}}, {{commit}}, {{file}}, {{remote}}, {{stash}}, {{tag}},
 *  plus {{head}} for the checked-out branch, {{repo}} for the repository's
 *  path, and {{prompt.key}} for an answer. */
export interface CustomCommand {
  label: string;
  /** A shell line, run in the repository's root. */
  command: string;
  context: CustomContext;
  /** A key, for a global command. Written the way the keymap writes them. */
  key?: string;
  prompts?: CustomPrompt[];
  /** Ask first, with this message. */
  confirm?: string;
}

/** The id a custom command's key and handler are registered under: its
 *  position in the list, which is the one thing about it that is stable
 *  while the file is being edited. */
export const customId = (index: number) => `custom.${index}`;

/** Substitute every {{name}} the caller has a value for. An unknown name is
 *  left as written, which is what makes a typo visible in the output. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? vars[name]! : whole,
  );
}

/** The keys global custom commands claim, in the keymap's shape. */
export function customKeymap(commands: CustomCommand[]): Keymap {
  const keymap: Keymap = {};
  commands.forEach((command, index) => {
    if (command.context === "global" && command.key?.trim()) {
      keymap[customId(index)] = [command.key.trim()];
    }
  });
  return keymap;
}

/** Whatever the settings file holds, reduced to the commands that are
 *  usable. A malformed entry is dropped rather than taking the rest down. */
export function normalizeCustomCommands(value: unknown): CustomCommand[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw): CustomCommand[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const entry = raw as Record<string, unknown>;

    const label = typeof entry.label === "string" ? entry.label.trim() : "";
    const command = typeof entry.command === "string" ? entry.command.trim() : "";
    const context = CUSTOM_CONTEXTS.includes(entry.context as CustomContext)
      ? (entry.context as CustomContext)
      : "global";
    if (!label || !command) return [];

    const prompts = Array.isArray(entry.prompts)
      ? entry.prompts.flatMap((p): CustomPrompt[] => {
          if (typeof p !== "object" || p === null) return [];
          const prompt = p as Record<string, unknown>;
          if (typeof prompt.key !== "string" || !prompt.key.trim()) return [];
          return [
            {
              key: prompt.key.trim(),
              label: typeof prompt.label === "string" ? prompt.label : prompt.key.trim(),
              options: Array.isArray(prompt.options)
                ? prompt.options.filter((o): o is string => typeof o === "string")
                : undefined,
              value: typeof prompt.value === "string" ? prompt.value : undefined,
            },
          ];
        })
      : undefined;

    return [
      {
        label,
        command,
        context,
        key: typeof entry.key === "string" && entry.key.trim() ? entry.key.trim() : undefined,
        prompts: prompts?.length ? prompts : undefined,
        confirm: typeof entry.confirm === "string" && entry.confirm.trim() ? entry.confirm : undefined,
      },
    ];
  });
}
