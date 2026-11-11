"""Drive Jellyland in real Chrome (WebGPU) and capture evidence.

Usage: uv run --with playwright scripts/drive.py <url> <out-dir> [script]
The script is a comma-separated list of steps: `shot:name`, `zoom:name` (crop around the jelly), `wait:seconds`,
`down:Key`, `up:Key`, `place:s/lateral/lift`, `resize:radius`, `magnet` (switch the magnet on), `seeds` (spray a seed packet), `tdown:id/x/y`, `tmove:id/x/y`, `tup:id` (touches, with MOBILE=1), `tap:selector`, `orient:alpha/beta/gamma`, `bbox:selector`, `ctl` (print the control values), `probe:kind/radius` (play a merge sound, report source and peak), `samples`, `toggle:part/0|1`, `frames:seconds` (frame-time statistics; env VIEW_W, VIEW_H, DSF set the window), `fps:seconds`, `demo:kind/radius/look` (start a merge on the jelly's right), `snap` (print the debug snapshot).
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

VIEWPORT = {"width": int(os.environ.get("VIEW_W", 1280)), "height": int(os.environ.get("VIEW_H", 720))}
DEVICE_SCALE = float(os.environ.get("DSF", 1))
BOOT_TIMEOUT_MS = 60_000
ZOOM_CLIP = {"x": 440, "y": 300, "width": 400, "height": 300}
DEFAULT_SCRIPT = "wait:1,shot:start,snap"
CHROME_ARGS = ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"]


def main() -> int:
    url, out = sys.argv[1], sys.argv[2]
    steps = (sys.argv[3] if len(sys.argv) > 3 else DEFAULT_SCRIPT).split(",")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=CHROME_ARGS)
        mobile = os.environ.get("MOBILE") == "1"
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=DEVICE_SCALE, is_mobile=mobile, has_touch=mobile)
        touches: dict[int, tuple[float, float]] = {}
        cdp = page.context.new_cdp_session(page) if mobile else None

        def send_touch(kind: str) -> None:
            points = [{"x": x, "y": y, "id": i} for i, (x, y) in touches.items()]
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})
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
            elif kind == "tdown":
                i, x, y = (float(v) for v in arg.split("/"))
                touches[int(i)] = (x, y); send_touch("touchStart")
            elif kind == "tmove":
                i, x, y = (float(v) for v in arg.split("/"))
                touches[int(i)] = (x, y); send_touch("touchMove")
            elif kind == "tup":
                touches.pop(int(arg), None); send_touch("touchEnd")
            elif kind == "tap":
                page.tap(arg)
            elif kind == "orient":
                alpha, beta, gamma = (float(v) for v in arg.split("/"))
                page.evaluate(f"window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {{alpha: {alpha}, beta: {beta}, gamma: {gamma}}}))")
            elif kind == "bbox":
                box = page.locator(arg).bounding_box()
                print("[bbox]", arg, {k: round(v) for k, v in box.items()})
            elif kind == "ctl":
                print("[ctl]", page.evaluate("(() => { const s = window.__jellyland.snapshot(); return { throttle: +s.throttle.toFixed(2), steer: +s.steer.toFixed(2), jump: s.jump, speed: +s.speed.toFixed(1) }; })()"))
            elif kind == "probe":
                kind_id, _, radius = arg.partition("/")
                print("[probe]", page.evaluate(f"window.__jellyland.probeMerge({kind_id}, {radius})"))
            elif kind == "samples":
                print("[samples]", page.evaluate("window.__jellyland.samples()"))
            elif kind == "toggle":
                name, _, state = arg.partition("/")
                page.evaluate(f"window.__jellyland.toggle('{name}', {state == '1'})".replace("True", "true").replace("False", "false"))
            elif kind == "fps":
                before = page.evaluate("window.__jellyland.snapshot().frames")
                time.sleep(float(arg))
                after = page.evaluate("window.__jellyland.snapshot().frames")
                print(f"[fps] {(after - before) / float(arg):.1f}")
            elif kind == "frames":
                stats = page.evaluate("""async (seconds) => {
                    const deltas = [];
                    let last = performance.now();
                    const end = last + seconds * 1000;
                    await new Promise(resolve => {
                        const tick = now => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(); };
                        requestAnimationFrame(tick);
                    });
                    deltas.shift();
                    const sorted = [...deltas].sort((a, b) => a - b);
                    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
                    return { fps: 1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length), p50: at(0.5), p95: at(0.95), worst: sorted[sorted.length - 1], over33: deltas.filter(d => d > 33).length, n: deltas.length };
                }""", float(arg))
                print(f"[frames] fps {stats['fps']:.1f}  median {stats['p50']:.1f} ms  p95 {stats['p95']:.1f} ms  worst {stats['worst']:.1f} ms  frames>33ms {stats['over33']}/{stats['n']}")
            elif kind == "demo":
                page.evaluate(f"window.__jellyland.mergeDemo({arg.replace('/', ',')})")
            elif kind == "seeds":
                page.evaluate("window.__jellyland.seeds()")
            elif kind == "magnet":
                page.evaluate("window.__jellyland.magnet()")
            elif kind == "resize":
                page.evaluate(f"window.__jellyland.resize({arg})")
            elif kind == "snap":
                print("[snap]", json.dumps(page.evaluate("window.__jellyland.snapshot()")))
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
