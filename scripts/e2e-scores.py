"""End-to-end check of the world table in real Chrome, against the local stack.

Usage: uv run --with playwright scripts/e2e-scores.py <game-url> <out-dir>
The score server's flood limit allows 5 scores per address per 10 minutes, and only the top ten rolls make the leaderboard, so this
clears the local flood, score and run tables first.
Needs `npm run stack` (the score server, port 8787) and the game's dev server, whose /api proxies to it.
Covers: a registered run that checks in and is accepted (story 1), the table with the player's row highlighted (story 2),
giant letters with a nine-letter limit (story 3), and a blocked name then a good one (story 4); plus a run with the server
down and a run that used a debug key.
"""
import json
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

BOOT_TIMEOUT_MS = 90_000
WEAR_OUT_RADIUS = 0.04
CHROME_ARGS = ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"]
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def boot(browser, url, out, requests=None, down=False):
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.on("pageerror", lambda e: print(f"[pageerror] {e}"))
    if requests is not None:
        page.on("request", lambda r: requests.append((r.method, r.url.split("/api")[-1])) if "/api/" in r.url else None)
    if down:
        page.route("**/api/**", lambda route: route.abort())
    page.goto(url)
    page.wait_for_function("document.querySelector('#loading').classList.contains('hidden')", timeout=BOOT_TIMEOUT_MS)
    return page


def wear_out(page):
    page.keyboard.down("w")
    time.sleep(3)
    page.keyboard.up("w")
    page.evaluate(f"window.__jellyland.resize({WEAR_OUT_RADIUS})")
    page.wait_for_function("window.__jellyland.snapshot().wornOut", timeout=30_000)


def letters(page) -> int:
    """How many jelly letters are standing in the game scene."""
    return page.evaluate("window.__jellyland.letters().count")


def sql(command: str) -> None:
    subprocess.run(["npx", "wrangler", "d1", "execute", "jellyroll-scores", "--local", "--config", "worker/wrangler.toml", "--command", command], check=True, capture_output=True)


def main() -> int:
    url, out = sys.argv[1], sys.argv[2]
    sql("delete from flood; delete from scores; delete from runs")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=CHROME_ARGS)

        # 1. The happy path: a registered run, heartbeats, giant letters, the table.
        requests: list = []
        page = boot(browser, url, out, requests)
        page.wait_for_timeout(11_000)  # at least two check-ins (not time.sleep: that would hold back the page's events)
        beats = [r for r in requests if r[1] == "/run/beat"]
        check("the run was registered when the game started", ("POST", "/run") in requests)
        check("the game checks in while it is played", len(beats) >= 2, f"{len(beats)} check-ins")
        wear_out(page)
        page.wait_for_selector("#name-entry.shown", timeout=15_000)
        check("the name entry opens when the roll makes the leaderboard", "leaderboard" in page.inner_text("#name-entry .ne-prompt"), page.inner_text("#name-entry .ne-prompt"))
        page.keyboard.type("jelly", delay=350)
        page.wait_for_timeout(900)
        check("five typed letters show as five giant letters", letters(page) == 5, str(letters(page)))
        page.screenshot(path=f"{out}/name-jelly.png")
        page.keyboard.press("Enter")
        page.wait_for_selector("#scoreboard.shown .sb-row.mine", timeout=15_000)
        mine = page.inner_text("#scoreboard .sb-row.mine")
        check("the table opens with the player's row highlighted", "JELLY" in mine, mine)
        page.screenshot(path=f"{out}/table.png")
        table = page.evaluate("fetch('/api/scores').then(r => r.json())")
        check("the score is on the server's table", any(r["name"] == "JELLY" for r in table["rows"]))
        page.keyboard.press("Escape")
        page.wait_for_function("!document.querySelector('#scoreboard').classList.contains('shown')")

        # 2. A new run: nine letters at most, then a name that is not allowed, then a good one.
        page.keyboard.press("r")
        time.sleep(1.5)
        wear_out(page)
        page.wait_for_selector("#name-entry.shown", timeout=15_000)
        page.keyboard.type("ABCDEFGHIJK", delay=120)
        page.wait_for_timeout(900)
        check("a name stops at nine letters", letters(page) == 9, str(letters(page)))
        page.screenshot(path=f"{out}/name-nine.png")
        page.wait_for_function("window.__jellyland.letters().settled", timeout=20_000)
        page.wait_for_timeout(3000)  # a letter that toppled lies still for a moment, then stands back up
        page.wait_for_function("window.__jellyland.letters().settled", timeout=20_000)
        boxes = page.evaluate("window.__jellyland.letters().boxes.letters")
        standing = [b["character"] for b in boxes if (b["hi"][1] - b["lo"][1]) / 0.07 < 0.6]
        check("every letter has landed and is standing once they settle", not standing, f"lying: {standing}")
        page.screenshot(path=f"{out}/name-nine-settled.png")
        for _ in range(9):
            page.keyboard.press("Backspace")
            time.sleep(0.05)
        time.sleep(0.4)
        check("backspace takes the letters off", letters(page) == 0, str(letters(page)))
        page.keyboard.press("Enter")
        time.sleep(0.3)
        check("Enter with no letters asks for one", "at least one" in page.inner_text("#name-entry .ne-message"))
        page.keyboard.type("fuck", delay=100)
        time.sleep(0.8)
        page.keyboard.press("Enter")
        page.wait_for_function("document.querySelector('#name-entry .ne-message').textContent.includes('Try another')", timeout=15_000)
        check("a name that is not allowed is refused and the letters are kept", letters(page) == 4, str(letters(page)))
        page.screenshot(path=f"{out}/name-blocked.png")
        for _ in range(4):
            page.keyboard.press("Backspace")
            time.sleep(0.05)
        time.sleep(0.4)
        page.keyboard.type("zoe", delay=100)
        time.sleep(0.8)
        page.keyboard.press("Enter")
        page.wait_for_selector("#scoreboard.shown .sb-row.mine", timeout=15_000)
        check("the same run is accepted with another name", "ZOE" in page.inner_text("#scoreboard .sb-row.mine"))
        page.keyboard.press("Enter")

        # 2b. With the leaderboard full of long rolls, a short roll is not offered the name screen, and is told why.
        sql("delete from scores")
        values = ",".join(f"('{i:032x}', '{i:032x}', 'TOP{i}', {5000 - i}, {1000 + i}, NULL)" for i in range(1, 11))
        sql(f"insert into scores (id, run_id, name, distance, created_ms, removed_ms) values {values}")
        page.keyboard.press("r")
        page.wait_for_timeout(1500)
        wear_out(page)
        page.wait_for_function("document.querySelector('#score-note').textContent.length > 0", timeout=15_000)
        page.wait_for_timeout(2500)
        check("a roll that does not make the top ten is not offered the name screen", not page.evaluate("document.querySelector('#name-entry').classList.contains('shown')"))
        note = page.inner_text("#score-note")
        check("and the player is told where it would have ranked", "11th" in note and "top 10" in note, note)
        page.screenshot(path=f"{out}/not-top-ten.png")
        sql("delete from scores")

        # 3. A run that used a debug key is not offered to the table.
        page.keyboard.press("r")
        time.sleep(1.5)
        page.keyboard.press(",")
        wear_out(page)
        time.sleep(2.5)
        check("a run that used a debug key is not offered for signing", not page.evaluate("document.querySelector('#name-entry').classList.contains('shown')"))
        check("and the player is told", "debug" in page.inner_text("#score-note").lower(), page.inner_text("#score-note"))
        page.close()

        # 4. The server is down from the start: the game plays on, the end says so.
        page = boot(browser, url, out, down=True)
        time.sleep(2)
        wear_out(page)
        time.sleep(2.5)
        check("with the server down the name entry does not open", not page.evaluate("document.querySelector('#name-entry').classList.contains('shown')"))
        note = page.inner_text("#score-note")
        check("with the server down the end screen says the roll cannot count", "can't reach" in note.lower(), note)
        page.screenshot(path=f"{out}/server-down.png")
        page.keyboard.press("t")
        page.wait_for_selector("#scoreboard.shown", timeout=10_000)
        time.sleep(0.5)
        check("with the server down the table says so", "can't be reached" in page.inner_text("#scoreboard .sb-status"), page.inner_text("#scoreboard .sb-status"))
        page.screenshot(path=f"{out}/table-down.png")
        page.close()
        browser.close()

    print(json.dumps({"failures": failures}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
