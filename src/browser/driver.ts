import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import type { Decision } from "../types.js";

/**
 * Pick the recording that is the actual journey.
 *
 * Playwright writes one file per page, so popups and off-screen email renders
 * each produce their own. The main session is always the longest, and file size
 * is a reliable proxy for length at a fixed resolution.
 */
export function chooseRecording<T extends { file: string; size: number }>(
  clips: T[],
): T | null {
  if (clips.length === 0) return null;
  return clips.reduce((best, c) => (c.size > best.size ? c : best));
}

export interface PageSnapshot {
  ariaYaml: string;
  url: string;
}

export class BrowserDriver {
  private browser!: import("playwright").Browser;
  private context!: import("playwright").BrowserContext;
  page!: import("playwright").Page;
  shotsDir!: string;
  private videoDir?: string;
  private videoSaved = false;

  async launch(opts: {
    headless: boolean;
    shotsDir: string;
    mobile?: boolean;
    /** Where Playwright writes raw per-page recordings. Omit to skip recording entirely. */
    videoDir?: string;
  }) {
    const { chromium } = await import("playwright");
    this.shotsDir = opts.shotsDir;
    this.videoDir = opts.videoDir;
    const viewport = opts.mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 800 };
    this.browser = await chromium.launch({ headless: opts.headless });
    this.context = await this.browser.newContext({
      viewport,
      isMobile: !!opts.mobile,
      hasTouch: !!opts.mobile,
      userAgent: opts.mobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
      ...(opts.videoDir
        ? { recordVideo: { dir: opts.videoDir, size: viewport } }
        : {}),
    });
    this.page = await this.context.newPage();

    // Bulletproof popup/new-tab handling: always follow the newest page,
    // return to the previous live page when a popup closes or crashes,
    // and never strand the session on a dead page.
    const pageStack: import("playwright").Page[] = [];
    this.context.on("page", (page) => {
      if (page === this.page || page.isClosed()) return;
      pageStack.push(this.page);
      this.page = page;
      const revert = () => {
        if (this.page !== page) return; // a newer page already took over
        while (pageStack.length > 0) {
          const prev = pageStack.pop()!;
          if (!prev.isClosed()) {
            this.page = prev;
            return;
          }
        }
        // every page is gone — open a fresh one so the session can continue
        this.context
          .newPage()
          .then((p) => {
            this.page = p;
          })
          .catch(() => {});
      };
      page.once("close", revert);
      page.once("crash", revert);
    });
  }

  async goto(url: string) {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.page.waitForTimeout(1500); // let hydration settle
  }

  async snapshot(): Promise<PageSnapshot> {
    let ariaYaml: string;
    try {
      ariaYaml = await this.page
        .locator("body")
        .ariaSnapshot({ mode: "ai", timeout: 5000 });
    } catch {
      ariaYaml = "(failed to capture accessibility snapshot)";
    }
    if (!ariaYaml.trim()) ariaYaml = "(page appears blank)";

    return { ariaYaml, url: this.page.url() };
  }

  async screenshotPath(stepNumber: number): Promise<string> {
    const path = `${this.shotsDir}/step-${String(stepNumber).padStart(3, "0")}.png`;
    try {
      await this.page.screenshot({ path, fullPage: false });
      return path;
    } catch {
      return "";
    }
  }

  async act(decision: Decision): Promise<void> {
    const a = decision.action;

    switch (a.type) {
      case "click": {
        const el = this.page.locator(`aria-ref=${a.target}`);
        try {
          await el.click({ timeout: 10_000 });
        } catch {
          // element may be offscreen or overlapped — scroll to it and retry
          await el.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
          await el.click({ timeout: 10_000 });
        }
        break;
      }
      case "type": {
        const el = this.page.locator(`aria-ref=${a.target}`);
        await el.fill(a.text, { timeout: 10_000 });
        break;
      }
      case "select": {
        const el = this.page.locator(`aria-ref=${a.target}`);
        try {
          await el.selectOption({ label: a.value }, { timeout: 10_000 });
        } catch {
          await el.selectOption(a.value, { timeout: 10_000 });
        }
        break;
      }
      case "scroll": {
        await this.page.mouse.wheel(0, a.direction === "down" ? 600 : -600);
        break;
      }
      case "back": {
        await this.page.goBack({ timeout: 15_000 }).catch(() => {});
        break;
      }
      case "wait": {
        await this.page.waitForTimeout(a.seconds * 1000);
        break;
      }
      default:
        break; // complete / abandon handled by session loop
    }

    // settle after navigation-triggering actions
    await this.page
      .waitForLoadState("domcontentloaded", { timeout: 15_000 })
      .catch(() => {});
    // let XHR/fetch traffic finish before we snapshot
    await this.page
      .waitForLoadState("networkidle", { timeout: 6_000 })
      .catch(() => {});
    await this.page.waitForTimeout(1000);
  }

  /**
   * Finalize the session video. Safe to call from a `finally` — it runs at most
   * once and tolerates an already-closed context.
   *
   * Playwright writes one recording per page, so popups and off-screen email
   * renders each produce their own file. The main journey is always the longest
   * one, so that is the file we keep; the rest are discarded. The winner is
   * *moved* rather than copied, so no duplicate is left behind.
   */
  async saveVideo(path: string) {
    if (this.videoSaved || !this.videoDir) return;
    this.videoSaved = true;

    await this.context?.close().catch(() => {}); // recordings finalize on context close
    if (!existsSync(this.videoDir)) return;

    const clips = readdirSync(this.videoDir)
      .filter((f) => f.endsWith(".webm"))
      .map((f) => `${this.videoDir}/${f}`)
      .map((file) => ({ file, size: statSync(file).size }));

    const main = chooseRecording(clips);
    if (main) {
      try {
        renameSync(main.file, path);
      } catch {
        // cross-device or racing writer — leave the raw file rather than lose it
        return;
      }
    }
    rmSync(this.videoDir, { recursive: true, force: true });
  }

  /**
   * Render an email's HTML off-screen and screenshot it — lets the brain SEE any OTP format.
   *
   * Email content is untrusted: render it in a throwaway context with JavaScript
   * disabled and all network requests aborted, so a hostile mail cannot run
   * scripts, beacon the operator, or hijack the journey via popup promotion.
   */
  async emailScreenshot(html: string, path: string): Promise<string> {
    let context: import("playwright").BrowserContext | null = null;
    try {
      context = await this.browser.newContext({ javaScriptEnabled: false });
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load", timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.screenshot({ path, fullPage: true });
      await page.close();
      return path;
    } catch {
      return "";
    } finally {
      await context?.close().catch(() => {});
    }
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
