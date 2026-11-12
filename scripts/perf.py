"""Performance budget for Jellyland: 60 frames a second, full screen, on this machine.

Usage: uv run --with playwright scripts/perf.py <url> [--report-only]

Runs the game in real Chrome at this machine's full-screen size (PERF_W x PERF_H CSS pixels at PERF_DSF, default the
built-in display: 1280 x 832 at 2x) and, in each scene, times frames from their start until the GPU has finished drawing
them (window.__jellyland.bench). That is the true cost of a frame, independent of the display's refresh. A scene passes if
its median frame is within MEDIAN_BUDGET_MS and its 95th percentile within P95_BUDGET_MS. Exit code 1 if any scene fails.

Each scene is: jump somewhere, let the world build, hold W, measure. `toggle` scenes switch one part off, to show what it costs.
Run it with the machine otherwise idle: other work on the GPU or CPU shows up as slow frames here.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

WIDTH, HEIGHT = int(os.environ.get("PERF_W", 1280)), int(os.environ.get("PERF_H", 832))
DEVICE_SCALE = float(os.environ.get("PERF_DSF", 2))
# 60 frames a second is 16.7 ms. The budget leaves room for the browser's own work.
MEDIAN_BUDGET_MS = 13.0
P95_BUDGET_MS = 16.6
FRAMES = 240
SETTLE_MS = 2500
BOOT_TIMEOUT_MS = 90_000
CHROME_ARGS = ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"]
BIOME_LENGTH = 1500
# (name, course distance, keys pressed first, hook calls made first)
SCENES = [
    ("meadow", 0 * BIOME_LENGTH + 700, "", []),
    ("meadow, big pools", 0 * BIOME_LENGTH + 760, "======", []),
    ("scree", 1 * BIOME_LENGTH + 700, "", []),
    ("ice", 2 * BIOME_LENGTH + 700, "", []),
    ("dunes", 3 * BIOME_LENGTH + 700, "", []),
    ("cave mouth", 4 * BIOME_LENGTH - 60, "", []),
    ("cave", 4 * BIOME_LENGTH + 700, "", []),
    ("lava", 5 * BIOME_LENGTH + 700, "", []),
    ("meadow + 4 bees + marble", 700, "", ["bee()", "bee()", "bee()", "bee()", "glass()"]),
]
BREAKDOWN_PARTS = ["probe", "water", "terrain", "mushrooms", "rocks", "holes", "jelly", "bloom"]


def main() -> int:
    url = sys.argv[1]
    report_only = "--report-only" in sys.argv
    breakdown = "--breakdown" in sys.argv
    only = os.environ.get("PERF_ONLY")
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=CHROME_ARGS)
        page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=DEVICE_SCALE)
        page.on("pageerror", lambda e: print(f"[pageerror] {e}"))
        page.goto(url)
        page.wait_for_function("document.querySelector('#loading').classList.contains('hidden') || document.querySelector('#loading').classList.contains('failed')", timeout=BOOT_TIMEOUT_MS)
        page.wait_for_timeout(1000)
        print(f"{'scene':30s} {'median':>7s} {'p95':>7s} {'worst':>7s} {'cpu':>6s}  pixels      CPU parts (mean ms a frame)")
        for name, s, keys, calls in SCENES:
            if only and only not in name:
                continue
            for key in keys:
                page.keyboard.press(key)
            page.evaluate(f"window.__jellyland.place({s}, 0, 0)")
            for call in calls:
                page.evaluate(f"window.__jellyland.{call}")
            page.keyboard.down("w")
            page.wait_for_timeout(SETTLE_MS)
            result = page.evaluate(f"window.__jellyland.bench({FRAMES})")
            parts = sorted(((k, v) for k, v in result["means"].items() if k not in ("steps", "present")), key=lambda kv: -kv[1])[:7]
            ok = result["medianMs"] <= MEDIAN_BUDGET_MS and result["p95Ms"] <= P95_BUDGET_MS
            if not ok:
                failures.append(name)
            print(f"{name:30s} {result['medianMs']:7.1f} {result['p95Ms']:7.1f} {result['worstMs']:7.1f} {result['cpuMedianMs']:6.1f}  {result['pixels'][0]}x{result['pixels'][1]}  "
                  + ", ".join(f"{k} {v:.2f}" for k, v in parts) + ("" if ok else "   OVER BUDGET"))
            if breakdown:
                for part in BREAKDOWN_PARTS:
                    page.evaluate(f"window.__jellyland.toggle('{part}', false)")
                    off = page.evaluate(f"window.__jellyland.bench({FRAMES // 3})")
                    page.evaluate(f"window.__jellyland.toggle('{part}', true)")
                    print(f"    without {part:10s} median {off['medianMs']:6.1f}  (saves {result['medianMs'] - off['medianMs']:5.1f} ms)")
            page.keyboard.up("w")
            for key in keys:
                page.keyboard.press("-")
        browser.close()
    print(f"\nbudget: median <= {MEDIAN_BUDGET_MS} ms and p95 <= {P95_BUDGET_MS} ms per frame at {WIDTH}x{HEIGHT} @{DEVICE_SCALE:g}x")
    if failures:
        print("OVER BUDGET: " + ", ".join(failures))
        return 0 if report_only else 1
    print("all scenes within budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
