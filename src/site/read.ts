/**
 * First-look read of a target site.
 *
 * Runs once, the first time a site is tested, so you can see what the personas
 * will be walking into before spending runs on it.
 */
import { z } from "zod";
import type { Brain } from "../types.js";
import { extractJson } from "../brain/adapters/cli-brain.js";
import { scrapeSiteContext } from "../persona/generate.js";

const SiteReadSchema = z.object({
  product: z.string().min(1).max(200),
  audience: z.string().min(1).max(200),
  cta: z.string().min(1).max(200),
});

export type SiteRead = z.infer<typeof SiteReadSchema>;

/**
 * Ask the brain what the landing page is selling, to whom, and what the primary
 * conversion action is. Returns null on any failure — this is a convenience,
 * never a reason to block a run.
 */
export async function readSite(
  url: string,
  brain: Brain & { ask?(prompt: string): Promise<string> },
): Promise<SiteRead | null> {
  if (!brain.ask) return null;

  const context = await scrapeSiteContext(url).catch(() => "");
  if (!context) return null;

  const prompt = `You are reading a landing page to brief a user-testing team.

PAGE (accessibility snapshot of ${url}):
${context}

Answer three things from what is actually on the page. Be concrete and short —
one line each, no marketing language. If something is genuinely not on the page,
say so plainly rather than guessing.

Reply ONLY with this JSON object:
{
  "product": "what this sells, in plain words",
  "audience": "who it appears to be for",
  "cta": "the primary action the page pushes, and where it leads"
}`;

  try {
    const raw = await brain.ask(prompt);
    const json = extractJson(raw);
    if (!json) return null;
    const parsed = SiteReadSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
