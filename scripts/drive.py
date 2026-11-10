"""Drive Jellyland in real Chrome (WebGPU) and capture evidence.

Usage: uv run --with playwright scripts/drive.py <url> <out-dir> [script]
The script is a comma-separated list of steps: `shot:name`, `zoom:name` (crop around the jelly), `wait:seconds`,
`down:Key`, `up:Key`, `place:s/lateral/lift`, `resize:radius`, `snap` (print the debug snapshot).
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

VIEWPORT = {"width": 1280, "height": 720}
BOOT_TIMEOUT_MS = 60_000
ZOOM_CLIP = {"x": 440, "y": 300, "width": 400, "height": 300}
DEFAULT_SCRIPT = "wait:1,shot:start,snap"
CHROME_ARGS = ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"]


def main() -> int:
    url, out = sys.argv[1], sys.argv[2]
    steps = (sys.argv[3] if len(sys.argv) > 3 else DEFAULT_SCRIPT).split(",")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=CHROME_ARGS)
        page = browser.new_page(viewport=VIEWPORT)
        page.on("console", lambda m: print(f"[console.{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: print(f"[pageerror] {e}"))
        page.goto(url)
        try:
            page.wait_for_function(
                "document.querySelector('#loading').classList.contains('hidden') || document.querySelector('#loading').classList.contains('failed')",
                timeout=BOOT_TIMEOUT_MS,
            )
        except Exception as error:  # still capture what is on screen
            print(f"[boot] {error}")
        if page.evaluate("document.querySelector('#loading').classList.contains('failed')"):
            print("[fatal]", page.evaluate("document.querySelector('#fatal').textContent"))
            page.screenshot(path=f"{out}/fatal.png")
            browser.close()
            return 1
        for step in steps:
            kind, _, arg = step.partition(":")
            if kind == "wait":
                time.sleep(float(arg))
            elif kind == "shot":
                page.screenshot(path=f"{out}/{arg}.png")
            elif kind == "zoom":
                page.screenshot(path=f"{out}/{arg}.png", clip=ZOOM_CLIP)
            elif kind == "down":
                page.keyboard.down(arg)
            elif kind == "up":
                page.keyboard.up(arg)
            elif kind == "place":
                page.evaluate(f"window.__jellyland.place({arg.replace('/', ',')})")
            elif kind == "resize":
                page.evaluate(f"window.__jellyland.resize({arg})")
            elif kind == "snap":
                print("[snap]", json.dumps(page.evaluate("window.__jellyland.snapshot()")))
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
