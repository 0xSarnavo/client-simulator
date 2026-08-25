/**
 * Zero-dependency interactive prompts.
 *
 * Arrow-key menus when a real TTY is attached; silent defaults otherwise so
 * CI and piped invocations never hang waiting for a human that isn't there.
 */
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

const ESC = "\x1b[";
const HIDE = `${ESC}?25l`;
const SHOW = `${ESC}?25h`;
const DIM = `${ESC}2m`;
const CYAN = `${ESC}36m`;
const GREEN = `${ESC}32m`;
const RESET = `${ESC}0m`;

export class PromptCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "PromptCancelled";
  }
}

export interface Choice<T> {
  value: T;
  label: string;
  /** Right-hand column: version, description, availability */
  hint?: string;
  /** Non-empty string renders the row greyed out and unselectable */
  disabled?: string;
}

/** True when we can draw an interactive menu (both ends of the pipe are a terminal). */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Usable row width. Guards against terminals reporting 0 columns. */
function rowWidth(): number {
  return Math.max(40, process.stdout.columns || 80) - 1;
}

/**
 * Fit a row into the terminal by trimming the decorative hint column first and
 * the value only as a last resort, so model ids stay readable when space runs out.
 */
function fitRow(label: string, hint: string, labelWidth: number) {
  const PREFIX = 4; // "  > "
  const width = rowWidth();
  let pad = hint ? labelWidth : 0;

  const room = width - PREFIX - Math.max(label.length, pad) - 2;
  if (hint && room < hint.length) hint = room > 3 ? hint.slice(0, room) : "";
  if (!hint) pad = 0;
  if (PREFIX + label.length > width) label = label.slice(0, Math.max(1, width - PREFIX));

  return { label: pad ? label.padEnd(pad) : label, hint };
}

/**
 * Arrow-key single select. Auto-resolves without prompting when only one
 * choice is selectable, and returns the default when there is no TTY.
 */
export async function select<T>(opts: {
  message: string;
  choices: Choice<T>[];
  /** Index to start on; falls forward to the first enabled row */
  initial?: number;
}): Promise<T> {
  const { choices, message } = opts;
  const enabled = choices.filter((c) => !c.disabled);
  if (enabled.length === 0) {
    throw new Error(`Nothing selectable for "${message}".`);
  }

  const startAt = (() => {
    const want = opts.initial ?? 0;
    if (choices[want] && !choices[want].disabled) return want;
    return choices.indexOf(enabled[0]);
  })();

  if (!isInteractive()) return choices[startAt].value;

  if (enabled.length === 1) return enabled[0].value;

  const hinted = choices.filter((c) => c.hint || c.disabled);
  const labelWidth = hinted.length ? Math.max(...hinted.map((c) => c.label.length)) : 0;
  let cursor = startAt;
  let drawn = 0;
  const out = process.stdout;

  const render = () => {
    const lines = [
      "",
      `  ${message}`,
      "",
      ...choices.map((c, i) => {
        const active = i === cursor;
        const pointer = active ? `${CYAN}❯${RESET}` : " ";
        const { label, hint } = fitRow(c.label, c.disabled ?? c.hint ?? "", labelWidth);
        const body = c.disabled
          ? `${DIM}${label}  ${hint}${RESET}`
          : `${active ? CYAN : ""}${label}${active ? RESET : ""}${hint ? `  ${DIM}${hint}${RESET}` : ""}`;
        return `  ${pointer} ${body}`;
      }),
      "",
      `  ${DIM}↑↓ move · enter select · ctrl-c quit${RESET}`,
    ];
    if (drawn > 0) out.write(`${ESC}${drawn}A${ESC}0J`);
    out.write(lines.join("\n") + "\n");
    drawn = lines.length;
  };

  const move = (step: number) => {
    let next = cursor;
    for (let i = 0; i < choices.length; i++) {
      next = (next + step + choices.length) % choices.length;
      if (!choices[next].disabled) break;
    }
    cursor = next;
  };

  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw ?? false;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  out.write(HIDE);

  try {
    return await new Promise<T>((resolve, reject) => {
      const onKey = (_str: string, key: { name?: string; ctrl?: boolean }) => {
        if (key.ctrl && key.name === "c") return finish(() => reject(new PromptCancelled()));
        switch (key.name) {
          case "up":
          case "k":
            move(-1);
            render();
            break;
          case "down":
          case "j":
            move(1);
            render();
            break;
          case "return":
          case "enter":
            return finish(() => resolve(choices[cursor].value));
        }
      };

      const finish = (settle: () => void) => {
        process.stdin.off("keypress", onKey);
        // collapse the menu into a single confirmation line
        if (drawn > 0) out.write(`${ESC}${drawn}A${ESC}0J`);
        settle();
      };

      process.stdin.on("keypress", onKey);
      render();
    });
  } finally {
    out.write(SHOW);
    process.stdin.setRawMode(wasRaw);
    process.stdin.pause();
  }
}

/** Free-text input. Returns fallback when there is no TTY or the answer is blank. */
export async function text(opts: {
  message: string;
  fallback?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string> {
  if (!isInteractive()) return opts.fallback ?? "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question(`  ${opts.message} `)).trim();
      if (!answer) {
        if (opts.fallback !== undefined) return opts.fallback;
        console.log(`  ${DIM}required${RESET}`);
        continue;
      }
      const problem = opts.validate?.(answer);
      if (problem) {
        console.log(`  ${DIM}${problem}${RESET}`);
        continue;
      }
      return answer;
    }
  } finally {
    rl.close();
  }
}

/** Echo a resolved choice in the same shape select() would have shown. */
export function confirmed(label: string, value: string, note?: string) {
  console.log(`  ${GREEN}✓${RESET} ${label.padEnd(8)} ${value}${note ? `  ${DIM}${note}${RESET}` : ""}`);
}

export function heading(title: string) {
  console.log(`\n  ${title}\n  ${DIM}${"─".repeat(Math.max(title.length, 30))}${RESET}`);
}
