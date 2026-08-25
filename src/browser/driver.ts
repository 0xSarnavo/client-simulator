import type { Decision } from "../types.js";

export interface PageSnapshot {
  ariaYaml: string;
  url: string;
}

export class BrowserDriver {
  private browser!: import("playwright").Browser;
  private context!: import("playwright").BrowserContext;
  page!: import("playwright").Page;
  shotsDir!: string;

  async launch(opts: { headless: boolean; shotsDir: string; mobile?: boolean }) {
    const { chromium } = await import("playwright");
    this.shotsDir = opts.shotsDir;
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
      recordVideo: {
        dir: opts.shotsDir,
        size: viewport,
      },
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

  /** Finalize and save the session video. Call before closing the browser. */
  async saveVideo(path: string) {
    const video = this.page?.video();
    if (!video) return;
    await this.context?.close().catch(() => {}); // video finalizes on context close
    await video.saveAs(path).catch(() => {});
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}
