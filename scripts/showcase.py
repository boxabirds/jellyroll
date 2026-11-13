"""Record the showcase videos: the demo scenes, in real Chrome, portrait and landscape, one exact frame at a time.

Usage: uv run --with playwright python scripts/showcase.py <game-url> <out-dir> [portrait|landscape ...]

Recording a game as it runs live drops frames (the browser cannot draw and capture 1080p at 30 fps at once) and the game slows down
when a frame is late. So the page's clock is replaced: time only moves when this script says so, 1/30 s at a time, and after each
step the picture is captured. Nothing is ever late, and every frame of the video is a frame of the game. It takes longer than the
video lasts; that is the price of a smooth one. The videos have no sound (the game's sound cannot be captured this way); add music
in the platform's own editor.
"""
import base64
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

CHROME_ARGS = ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"]
FORMATS = {"landscape": (1920, 1080), "portrait": (1080, 1920)}
FPS = 30
JPEG_QUALITY = 94
BOOT_TIMEOUT_MS = 120_000
# The scenes to show, in order (numbers are positions in SCENES in src/app/demo.ts), and how long each plays (seconds).
SCENES = "0,1,2,3,9,5,6,8"
SECONDS = 8
FADE_SECONDS = 0.6
# A video this many times longer than the scenes add up to means the game has stalled.
RUNAWAY = 2

# Time moves only when __step is called: the clock, the animation frames, the timers and the CSS animations all follow it.
VIRTUAL_CLOCK = """
() => {
  const realFrame = window.requestAnimationFrame.bind(window);
  let now = performance.now();
  const epoch = Date.now() - now;
  const frames = new Map(), timers = new Map();
  let nextId = 1;
  performance.now = () => now;
  Date.now = () => epoch + now;
  window.requestAnimationFrame = callback => { const id = nextId++; frames.set(id, callback); return id; };
  window.cancelAnimationFrame = id => { frames.delete(id); };
  window.setTimeout = (callback, delay = 0, ...args) => { const id = nextId++; timers.set(id, { at: now + delay, callback, args, every: 0 }); return id; };
  window.setInterval = (callback, delay = 0, ...args) => { const id = nextId++; timers.set(id, { at: now + delay, callback, args, every: Math.max(1, delay) }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.__done = false;
  window.addEventListener('demo-done', () => { window.__done = true; });
  window.__step = async milliseconds => {
    now += milliseconds;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now) continue;
      if (timer.every) timer.at += timer.every; else timers.delete(id);
      timer.callback(...timer.args);
    }
    for (const animation of document.getAnimations()) {
      if (animation.playState === 'running') animation.pause();
      animation.currentTime = (animation.currentTime ?? 0) + milliseconds;
    }
    const due = [...frames.values()]; frames.clear();
    for (const callback of due) callback(now);
    // Let what was just drawn reach the screen before it is captured.
    await new Promise(resolve => realFrame(() => realFrame(resolve)));
  };
}
"""


def record(p, name: str, url: str, out: Path) -> Path:
    width, height = FORMATS[name]
    work = out / f"frames-{name}"
    work.mkdir(parents=True, exist_ok=True)
    for old in work.glob("*.jpg"):
        old.unlink()
    browser = p.chromium.launch(channel="chrome", headless=True, args=CHROME_ARGS)
    page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
    # The demo waits on black (wait=1) until told to go, so scene one starts when the recording does.
    page.goto(f"{url}?demo=true&wait=1&scenes={SCENES}&seconds={SECONDS}&intensity=100")
    page.wait_for_function("document.querySelector('#loading').classList.contains('hidden')", timeout=BOOT_TIMEOUT_MS)
    page.evaluate(VIRTUAL_CLOCK)
    cdp = page.context.new_cdp_session(page)
    # A few steps on black, so the first scene's world is ready, then go.
    for _ in range(6):
        page.evaluate(f"window.__step({1000 / FPS})")
    page.evaluate("window.dispatchEvent(new Event('demo-go'))")
    scenes = len(SCENES.split(","))
    limit = int(scenes * (SECONDS + FADE_SECONDS * 2) * FPS * RUNAWAY)
    count = 0
    while count < limit and not page.evaluate("window.__done"):
        page.evaluate(f"window.__step({1000 / FPS})")
        shot = cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": JPEG_QUALITY, "fromSurface": True})
        (work / f"{count:06d}.jpg").write_bytes(base64.b64decode(shot["data"]))
        count += 1
        if count % (FPS * 5) == 0:
            print(f"{name}: {count / FPS:.0f} s", flush=True)
    browser.close()
    if count >= limit:
        raise RuntimeError(f"{name}: the demo did not finish within {limit} frames")
    video = out / f"jellyland-{name}.mp4"
    # Social platforms recompress, so a high but not huge bitrate: CRF 20, capped at 10 Mbit/s.
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(work / "%06d.jpg"),
        "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-maxrate", "10M", "-bufsize", "20M", "-movflags", "+faststart", str(video),
    ], check=True)
    print(f"{name}: {count} frames, {count / FPS:.1f} s -> {video}")
    return video


def main() -> int:
    url, out = sys.argv[1], Path(sys.argv[2])
    names = sys.argv[3:] or list(FORMATS)
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        for name in names:
            record(p, name, url, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
