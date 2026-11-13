#!/usr/bin/env python3
"""Walk the app through the iPhone Duo's poses and screenshot every screen.

The test build carries duo-probe.js, which posts each step to a small server
here and waits for the answer. The server answers only after it has taken the
screenshot or made the tap the step asks for, so each screenshot shows what the
probe checked. This script puts the Duo in each pose, writes a report, and
exits 1 if any check failed.

  duo-run.py --udid <udid> --bundle-id <id> --shots <dir>
"""

import argparse
import http.server
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

RUNNER_ADDRESS = ("127.0.0.1", 8723)
ANSWER_TIMEOUT_SECONDS = 60
ROUND_START_TIMEOUT_SECONDS = 90
ROUND_TIMEOUT_SECONDS = 240
TAP_SETTLE_SECONDS = 0.5
# Each pose, and the duoctl commands that move the Duo into it from the last.
POSES = (
    ("folded", ()),
    ("unfolded", (("open", "--duration", "1"),)),
    ("portrait", (("rotate", "portrait"),)),
    ("tent", (("close", "--duration", "1"), ("rotate", "landscape"),
              ("hinge", "70", "--duration", "1"))),
)


class ProbeStep:
    """One step the probe posted; it waits until answer() is called."""

    def __init__(self, line):
        _, number, size, *parts = line.strip().split("|")
        self.round_number = int(number)
        self.size = size
        self.parts = parts
        self._answered = threading.Event()

    def answer(self):
        self._answered.set()

    def wait_for_answer(self):
        return self._answered.wait(ANSWER_TIMEOUT_SECONDS)


def make_handler(steps):
    class StepHandler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            step = ProbeStep(self.rfile.read(length).decode("utf-8"))
            steps.put(step)
            step.wait_for_answer()
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

        def log_message(self, *args):
            pass

    return StepHandler


def start_server(steps):
    server = http.server.ThreadingHTTPServer(RUNNER_ADDRESS, make_handler(steps))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_duoctl(udid, *args):
    result = subprocess.run(["duoctl", "-d", udid, *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"duoctl {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def launch_app(udid, bundle_id, log_path):
    subprocess.run(
        ["xcrun", "simctl", "launch", "--terminate-running-process",
         f"--stdout={log_path}", f"--stderr={log_path}", udid, bundle_id],
        check=True)


def next_step(steps, deadline):
    remaining = deadline - time.time()
    try:
        return steps.get(timeout=max(remaining, 0.1))
    except queue.Empty as error:
        raise TimeoutError("the app stopped sending steps") from error


def wait_for_round(steps, after_round):
    """Return the number of the first round newer than after_round."""
    deadline = time.time() + ROUND_START_TIMEOUT_SECONDS
    while True:
        step = next_step(steps, deadline)
        step.answer()
        if step.round_number > after_round and step.parts[0] == "round-start":
            print(f"  round {step.round_number} at {step.size}: {step.parts[1]}")
            return step.round_number


def tap_screen(udid, pose, x, y, report):
    """Tap where the probe asks; a point off the screen is a failed check."""
    try:
        run_duoctl(udid, "tap", x, y)
    except RuntimeError as error:
        report.append((pose, "FAIL", "tap", str(error)))
        print(f"  FAIL tap: {error}")
        return
    time.sleep(TAP_SETTLE_SECONDS)


def carry_out(udid, shots_dir, pose, parts, report):
    kind = parts[0]
    if kind == "scene":
        shot = shots_dir / f"{pose}-{parts[1]}.png"
        run_duoctl(udid, "screenshot", str(shot))
        print(f"  {parts[1]}: {parts[2]} failed checks -> {shot.name}")
    elif kind == "tap":
        tap_screen(udid, pose, parts[1], parts[2], report)
    elif kind == "check":
        report.append((pose, *parts[1:]))
        print(f"  {parts[1]} {parts[2]}: {parts[3]}")
    elif kind == "skip":
        print(f"  skipped {parts[1]}: {parts[2]}")


def follow_round(udid, steps, round_number, shots_dir, pose, report):
    """Carry out one round's steps until it ends; return True if it finished."""
    deadline = time.time() + ROUND_TIMEOUT_SECONDS
    while True:
        step = next_step(steps, deadline)
        try:
            if step.round_number != round_number:
                continue
            if step.parts[0] in ("round-done", "round-abort"):
                print(f"  {step.parts[0]}: {step.parts[1]}")
                return step.parts[0] == "round-done"
            carry_out(udid, shots_dir, pose, step.parts, report)
        finally:
            step.answer()


def run_pose(udid, steps, last_round, shots_dir, pose, moves, report):
    print(f"== {pose}")
    for move in moves:
        run_duoctl(udid, *move)
    print(run_duoctl(udid, "state").strip())
    while True:
        round_number = wait_for_round(steps, last_round)
        if follow_round(udid, steps, round_number, shots_dir, pose, report):
            return round_number
        last_round = round_number


def write_report(report, path):
    failures = [row for row in report if row[1] == "FAIL"]
    rows = [f"| {pose} | {level} | {scene} | {message} |"
            for pose, level, scene, message in report]
    text = "\n".join([
        f"## iPhone Duo checks: {len(failures)} failed",
        "",
        "| Pose | Result | Screen | What |",
        "| --- | --- | --- | --- |",
        *rows,
        "",
    ])
    path.write_text(text, encoding="utf-8")
    return len(failures)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--udid", required=True)
    parser.add_argument("--bundle-id", required=True)
    parser.add_argument("--shots", required=True, type=Path)
    args = parser.parse_args()
    args.shots.mkdir(parents=True, exist_ok=True)
    steps = queue.Queue()
    server = start_server(steps)
    launch_app(args.udid, args.bundle_id, args.shots / "app-console.log")
    report = []
    last_round = 0
    try:
        for pose, moves in POSES:
            last_round = run_pose(args.udid, steps, last_round, args.shots, pose, moves, report)
    except (TimeoutError, RuntimeError) as error:
        report.append(("-", "FAIL", "runner", str(error)))
        print(f"FAIL runner: {error}")
    finally:
        server.shutdown()
    failures = write_report(report, args.shots / "report.md")
    print(f"{failures} failed checks")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
