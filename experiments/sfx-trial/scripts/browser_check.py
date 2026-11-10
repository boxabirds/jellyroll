"""Clicks every button on the trial page in headless system Chrome and checks
that sound reaches the output node. No autoplay override: the only thing that
unlocks audio is the click itself, as for a real visitor.

    uv run --with playwright python experiments/sfx-trial/scripts/browser_check.py
"""
import functools
import http.server
import json
import pathlib
import threading

from playwright.sync_api import sync_playwright

TRIAL_DIR = pathlib.Path(__file__).resolve().parent.parent
POLL_INTERVAL_MS = 10
POLL_COUNT = 150
SETTLE_MS = 400


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    handler = functools.partial(QuietHandler, directory=str(TRIAL_DIR))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    results = []
    with sync_playwright() as p:
        # --mute-audio keeps the machine quiet; the analyser sits before the output device.
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--mute-audio"])
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(url)
        before = page.evaluate("sfxTrial.state()")
        for effect_id in page.eval_on_selector_all("button[data-effect]", "bs => bs.map(b => b.dataset.effect)"):
            page.click(f'button[data-effect="{effect_id}"]')
            peak = page.evaluate(
                """async ([interval, count]) => {
                    let peak = 0;
                    for (let i = 0; i < count; i++) {
                        peak = Math.max(peak, sfxTrial.outputPeak());
                        await new Promise(r => setTimeout(r, interval));
                    }
                    return peak;
                }""",
                [POLL_INTERVAL_MS, POLL_COUNT],
            )
            state = page.evaluate("sfxTrial.state()")
            results.append({"effect": effect_id, "outputPeak": round(peak, 3), "context": state["context"], "played": state["played"]})
            page.wait_for_timeout(SETTLE_MS)
        user_agent = page.evaluate("navigator.userAgent")
        browser.close()
    server.shutdown()
    print(json.dumps({"userAgent": user_agent, "beforeAnyClick": before, "results": results, "pageErrors": errors}, indent=2))
    silent = [r["effect"] for r in results if r["outputPeak"] <= 0 or r["context"] != "running"]
    if silent or errors:
        raise SystemExit(f"FAILED: silent={silent} errors={errors}")
    print("OK: every button produced output")


if __name__ == "__main__":
    main()
