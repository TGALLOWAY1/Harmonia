// Marketing screenshot capture script
// Run with: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/screenshots.mjs
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve("public/marketing");
mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.HARMONIA_URL || "http://localhost:3000";

async function settle(page, ms = 600) {
  await page.waitForTimeout(ms);
}

// Wait until the Loading button text disappears (synth piano sample loaded)
async function waitForSynthReady(page) {
  try {
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll("button")).some((b) =>
        /loading/i.test(b.textContent || "")
      ),
      { timeout: 60000 }
    );
  } catch {
    // best effort
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  // ── 1) Generator hero ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await settle(page, 1500);

  const genBtn = page.getByRole("button", { name: /gen chords/i });
  await genBtn.first().waitFor({ state: "visible", timeout: 15000 });
  await genBtn.first().click();
  await settle(page, 1200);

  // Wait for synth preset to finish loading so the "Loading" pill disappears
  await waitForSynthReady(page);
  await settle(page, 600);

  // Re-roll a couple of times after synth is ready so playback can be primed,
  // and to land on a visually pleasant progression
  await genBtn.first().click().catch(() => {});
  await settle(page, 900);

  await page.screenshot({
    path: resolve(OUT_DIR, "01-chord-generator.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: resolve(OUT_DIR, "01-chord-generator-full.png"),
    fullPage: true,
  });
  console.log("✓ 01-chord-generator");

  // ── 2) Generate melody overlay ──
  const genMelody = page.getByRole("button", { name: /gen melody/i });
  await genMelody.first().click().catch(() => {});
  await settle(page, 1500);
  await waitForSynthReady(page);
  await settle(page, 500);

  await page.screenshot({
    path: resolve(OUT_DIR, "02-chord-melody-engine.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: resolve(OUT_DIR, "02-chord-melody-engine-full.png"),
    fullPage: true,
  });
  console.log("✓ 02-chord-melody-engine");

  // ── 3) Substitution panel ──
  // The substitute trigger is a small Shuffle icon in the top-right of each
  // chord card with title="Substitute chord". Use a precise selector.
  const subTrigger = page.locator('button[title="Substitute chord"]').first();
  await subTrigger.waitFor({ state: "visible", timeout: 10000 });
  await subTrigger.click();
  await settle(page, 1000);

  // Find the actual substitution panel container (it includes "Substitute Chord" header)
  const subPanel = page.locator('text="Substitute Chord"').first();
  let subBox = null;
  if ((await subPanel.count()) > 0) {
    await subPanel.scrollIntoViewIfNeeded().catch(() => {});
    await settle(page, 500);
    // Scroll up a touch so the chord cards remain visible above the panel
    await page.evaluate(() => window.scrollBy(0, -200));
    await settle(page, 400);
    subBox = await subPanel.boundingBox();
  }

  await page.screenshot({
    path: resolve(OUT_DIR, "03-substitution-panel.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: resolve(OUT_DIR, "03-substitution-panel-full.png"),
    fullPage: true,
  });

  // Bonus tight crop on the substitution panel itself
  if (subBox) {
    await page.screenshot({
      path: resolve(OUT_DIR, "03b-substitution-panel-detail.png"),
      clip: {
        x: Math.max(0, subBox.x - 20),
        y: Math.max(0, subBox.y - 20),
        width: Math.min(800, 600),
        height: 700,
      },
    });
  }
  console.log("✓ 03-substitution-panel");

  // ── 4) Sketchpad workspace ──
  await page.goto(`${BASE}/sketchpad`, { waitUntil: "networkidle" });
  await settle(page, 1500);

  // If we land on the empty state, create a sketch and add a couple of sections
  const createBtn = page.getByRole("button", { name: /create new sketch/i });
  if ((await createBtn.count()) > 0) {
    await createBtn.first().click();
    await settle(page, 600);
    // Set title
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill("Late Night Drive").catch(() => {});
    await settle(page, 200);
    // Confirm create
    await page.getByRole("button", { name: /^create$/i }).first().click();
    await settle(page, 1000);
  }

  // Add a few sections — must click "Add Section" first to reveal the picker
  for (const sec of ["Intro", "Verse", "Chorus", "Bridge"]) {
    const addSection = page.getByRole("button", { name: /^add section$/i }).first();
    if ((await addSection.count()) > 0) {
      await addSection.click().catch(() => {});
      await settle(page, 250);
    }
    const sectionBtn = page.getByRole("button", { name: new RegExp(`^${sec}$`, "i") }).first();
    if ((await sectionBtn.count()) > 0) {
      await sectionBtn.click().catch(() => {});
      await settle(page, 350);
    }
  }

  // Click on the Verse section to make it active
  const verseSec = page.getByRole("button", { name: /verse/i }).first();
  if ((await verseSec.count()) > 0) {
    await verseSec.click().catch(() => {});
    await settle(page, 500);
  }

  // Add diatonic chords by clicking palette buttons (I, V, vi, IV)
  // The palette uses small flex-col buttons — click them by chord symbol text
  for (const sym of ["C", "Am", "F", "G"]) {
    const btn = page
      .locator("button")
      .filter({ has: page.locator(`text=/^${sym}$/`) })
      .first();
    if ((await btn.count()) > 0) {
      await btn.click().catch(() => {});
      await settle(page, 250);
    }
  }

  await settle(page, 800);
  await page.screenshot({
    path: resolve(OUT_DIR, "04-harmonic-sketchpad.png"),
    fullPage: false,
  });
  await page.screenshot({
    path: resolve(OUT_DIR, "04-harmonic-sketchpad-full.png"),
    fullPage: true,
  });
  console.log("✓ 04-harmonic-sketchpad");

  await browser.close();
  console.log("\nScreenshots written to", OUT_DIR);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
