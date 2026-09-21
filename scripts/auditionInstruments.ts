/**
 * Instrument audition harness.
 *
 * Renders every instrument in the catalog offline, in a real browser audio
 * stack, and measures it — because nobody can listen to the sandbox, and "it
 * sounds better" has to be backed by numbers.
 *
 * Each instrument is rendered in both roles (chords: C3 E3 G3 C4, melody: E5)
 * at velocities 0.3 / 0.7 / 1.0. Per render it reports peak dBFS, sustained
 * RMS dBFS, spectral centroid (brightness), attack time and tail length, plus
 * silent / NaN / clipping flags.
 *
 * Usage:
 *   npx tsx scripts/auditionInstruments.ts [--check] [--wav <dir>] [--json <file>]
 *                                          [--seconds <n>] [--only <id,id>]
 *
 *   --check    exit non-zero if anything is silent, NaN or clipping, if a tail
 *              runs past 6s, or if loudness/brightness fail to rise with
 *              velocity on an instrument marked velocity-sensitive
 *   --wav      write 16-bit PCM WAVs (one per render) for human listening
 *   --json     write the full measurement set as JSON
 *   --seconds  render length (default 7.5s: note + a tail long enough to fail)
 *   --space    reverb space to render through: dry | room | hall (default room)
 *   --volume   master volume 0–1 (default 0.8, the app's default)
 *   --only     restrict to a comma-separated list of instrument ids
 *
 * Requires headless Chromium (Playwright's, already on this machine) — an
 * OfflineAudioContext is the only way to render Tone.js without ears.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_SPACE,
  clampMasterVolume,
  resolveSpaceId,
  type SpaceId,
} from "../lib/audio/audioSpace";
import { checkResults, renderBalanceTable, renderMarkdownTable } from "./audition/report";
import {
  DEFAULT_RENDER_SEC,
  CHANNELS,
  SAMPLE_RATE,
  VELOCITIES,
  renderKey,
  type AuditionRole,
  type RenderResult,
  type RenderSpec,
} from "./audition/specs";
import { wavFromPcm16 } from "./audition/wav";

const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(REPO_ROOT, "scripts", "audition", "harnessEntry.ts");
const ESBUILD = path.join(REPO_ROOT, "node_modules", ".bin", "esbuild");
/** Playwright lives in the global node install, not in this project. */
const PLAYWRIGHT_ROOT = "/opt/node22/lib/node_modules/playwright";
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/* ─── CLI ─── */

interface Options {
  check: boolean;
  wavDir: string | null;
  jsonFile: string | null;
  seconds: number;
  only: string[] | null;
  space: SpaceId;
  masterVolume: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    check: false,
    wavDir: null,
    jsonFile: null,
    seconds: DEFAULT_RENDER_SEC,
    only: null,
    space: DEFAULT_SPACE,
    masterVolume: DEFAULT_MASTER_VOLUME,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--wav") options.wavDir = path.resolve(argv[++i] ?? "");
    else if (arg === "--json") options.jsonFile = path.resolve(argv[++i] ?? "");
    else if (arg === "--seconds") options.seconds = Number(argv[++i]);
    else if (arg === "--only") options.only = (argv[++i] ?? "").split(",").map((s) => s.trim());
    else if (arg === "--space") options.space = resolveSpaceId(argv[++i]);
    else if (arg === "--volume") options.masterVolume = clampMasterVolume(Number(argv[++i]));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.seconds) || options.seconds <= 2) {
    throw new Error("--seconds must be a number greater than 2");
  }
  return options;
}

/* ─── Browser harness ─── */

function bundleHarness(outFile: string): void {
  const result = spawnSync(
    ESBUILD,
    [
      ENTRY,
      "--bundle",
      "--format=iife",
      "--platform=browser",
      "--target=es2020",
      `--outfile=${outFile}`,
      "--log-level=warning",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`esbuild failed:\n${result.stderr || result.stdout}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any;

async function launchBrowser(): Promise<Browser> {
  const requireGlobal = createRequire(path.join(PLAYWRIGHT_ROOT, "/"));
  const { chromium } = requireGlobal(PLAYWRIGHT_ROOT);
  return chromium.launch({
    executablePath: CHROMIUM,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-gpu",
      "--mute-audio",
    ],
  });
}

/* ─── Run ─── */

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const workDir = mkdtempSync(path.join(tmpdir(), "harmonia-audition-"));
  const bundlePath = path.join(workDir, "bundle.js");
  const pagePath = path.join(workDir, "harness.html");
  bundleHarness(bundlePath);
  writeFileSync(
    pagePath,
    `<!doctype html><meta charset="utf-8"><title>Harmonia audition</title><script src="bundle.js"></script>`,
  );

  const browser = await launchBrowser();
  const results: RenderResult[] = [];

  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (err: Error) => pageErrors.push(err.message));
    await page.goto(`file://${pagePath}`);
    await page.waitForFunction("typeof window.__audition === 'object'", null, { timeout: 15_000 });
    if (pageErrors.length) throw new Error(`harness page errors: ${pageErrors.join("; ")}`);

    const catalog: {
      id: string;
      label: string;
      category: string;
      velocitySensitive: boolean;
    }[] = await page.evaluate("window.__audition.catalog()");

    const instruments = options.only
      ? catalog.filter((entry) => options.only!.includes(entry.id))
      : catalog;
    if (instruments.length === 0) throw new Error("no instruments matched --only");

    const roles: AuditionRole[] = ["chord", "melody"];
    const specs: RenderSpec[] = [];
    for (const entry of instruments) {
      for (const role of roles) {
        for (const velocity of VELOCITIES) {
          specs.push({
            instrumentId: entry.id,
            label: entry.label,
            role,
            velocity,
            velocitySensitive: entry.velocitySensitive,
          });
        }
      }
    }

    if (options.wavDir) mkdirSync(options.wavDir, { recursive: true });

    const started = Date.now();
    for (const spec of specs) {
      process.stderr.write(`rendering ${renderKey(spec)}…\n`);
      const rendered = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request: any) => window.__audition.render(request),
        {
          instrumentId: spec.instrumentId,
          role: spec.role,
          velocity: spec.velocity,
          seconds: options.seconds,
          masterVolume: options.masterVolume,
          space: options.space,
          wantPcm: Boolean(options.wavDir),
        },
      );
      const result: RenderResult = { ...spec, ...rendered };

      if (options.wavDir && result.pcm16) {
        const pcm = Buffer.from(result.pcm16, "base64");
        const wav = wavFromPcm16(pcm, { sampleRate: SAMPLE_RATE, channels: CHANNELS });
        writeFileSync(path.join(options.wavDir, `${renderKey(spec)}.wav`), wav);
      }
      delete result.pcm16;
      results.push(result);
    }
    process.stderr.write(`rendered ${specs.length} takes in ${((Date.now() - started) / 1000).toFixed(1)}s\n\n`);
  } finally {
    await browser.close();
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(
    `# Instrument audition — ${results.length} renders ` +
      `(${options.seconds}s @ ${SAMPLE_RATE}Hz, lightweight tier, ` +
      `space "${options.space}", master volume ${options.masterVolume})\n`,
  );
  console.log(renderMarkdownTable(results));
  console.log();
  console.log(renderBalanceTable(results));

  if (options.jsonFile) {
    mkdirSync(path.dirname(options.jsonFile), { recursive: true });
    writeFileSync(
      options.jsonFile,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          seconds: options.seconds,
          sampleRate: SAMPLE_RATE,
          space: options.space,
          masterVolume: options.masterVolume,
          results,
        },
        (_key, value) => (value === Infinity ? "Infinity" : value === -Infinity ? "-Infinity" : value),
        2,
      ),
    );
    process.stderr.write(`wrote ${options.jsonFile}\n`);
  }
  if (options.wavDir) process.stderr.write(`wrote WAVs to ${options.wavDir}\n`);

  if (options.check) {
    const failures = checkResults(results);
    if (failures.length > 0) {
      console.log(`\n## Check: FAILED (${failures.length})\n`);
      for (const failure of failures) {
        console.log(`- ${failure.instrumentId} (${failure.role}): ${failure.reason}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log("\n## Check: passed\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
