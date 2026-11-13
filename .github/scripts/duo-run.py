#!/usr/bin/env python3
"""Walk the app through the iPhone Duo's poses and screenshot every screen.

The test build carries duo-probe.js, which logs a DUO line when a screen is
ready or needs a real tap. This script launches the app, puts the Duo in each
pose, and answers those lines, so each screenshot matches what the probe
checked. It writes a report and exits 1 if any check failed.

  duo-run.py --udid <udid> --bundle-id <id> --shots <dir>
"""

import argparse
import os
import pty
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

PROBE_LINE = re.compile(r"DUO\|(\d+)\|([0-9x]*)\|(.*)$")
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


def run_duoctl(udid, *args):
    result = subprocess.run(["duoctl", "-d", udid, *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"duoctl {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def start_app(udid, bundle_id, log_path):
    """Launch the app and follow its console.

    simctl holds back output written to a pipe until it has a full block, which
    made every screenshot late. A pty makes it pass each line on as it prints.
    """
    reader_fd, writer_fd = pty.openpty()
    app = subprocess.Popen(
        ["xcrun", "simctl", "launch", "--console-pty", "--terminate-running-process",
         udid, bundle_id],
        stdin=subprocess.DEVNULL, stdout=writer_fd, stderr=writer_fd)
    os.close(writer_fd)
    stream = os.fdopen(reader_fd, "r", encoding="utf-8", errors="replace")
    lines = queue.Queue()
    threading.Thread(target=pump_lines, args=(stream, lines, log_path), daemon=True).start()
    return app, lines


def pump_lines(stream, lines, log_path):
    with open(log_path, "a", encoding="utf-8") as log:
        for line in iter_lines(stream):
            log.write(line)
            log.flush()
            match = PROBE_LINE.search(line)
            if match:
                lines.put((int(match.group(1)), match.group(2), match.group(3).split("|")))


def iter_lines(stream):
    """Yield lines until the app's console closes; a closed pty raises EIO."""
    while True:
        try:
            line = stream.readline()
        except OSError:
            return
        if not line:
            return
        yield line


def next_line(lines, deadline):
    remaining = deadline - time.time()
    if remaining <= 0:
        raise TimeoutError("the app stopped answering")
    try:
        return lines.get(timeout=remaining)
    except queue.Empty as error:
        raise TimeoutError("the app stopped answering") from error


def wait_for_round(lines, after_round):
    """Return the number and size of the first round newer than after_round."""
    deadline = time.time() + ROUND_START_TIMEOUT_SECONDS
    while True:
        number, size, parts = next_line(lines, deadline)
        if number > after_round and parts[0] == "round-start":
            print(f"  round {number} at {size}: {parts[1]}")
            return number, size


def tap_screen(udid, pose, x, y, report):
    """Tap where the probe asks; a point off the screen is a failed check."""
    try:
        run_duoctl(udid, "tap", x, y)
    except RuntimeError as error:
        report.append((pose, "FAIL", "tap", str(error)))
        print(f"  FAIL tap: {error}")
        return
    time.sleep(TAP_SETTLE_SECONDS)


def answer_line(udid, shots_dir, pose, parts, report):
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


def follow_round(udid, lines, round_number, shots_dir, pose, report):
    """Answer one round's lines until it ends; return True if it finished."""
    deadline = time.time() + ROUND_TIMEOUT_SECONDS
    while True:
        number, _, parts = next_line(lines, deadline)
        if number != round_number:
            continue
        if parts[0] in ("round-done", "round-abort"):
            print(f"  {parts[0]}: {parts[1]}")
            return parts[0] == "round-done"
        answer_line(udid, shots_dir, pose, parts, report)


def run_pose(udid, lines, last_round, shots_dir, pose, steps, report):
    print(f"== {pose}")
    for step in steps:
        run_duoctl(udid, *step)
    print(run_duoctl(udid, "state").strip())
    while True:
        round_number, _ = wait_for_round(lines, last_round)
        if follow_round(udid, lines, round_number, shots_dir, pose, report):
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
    app, lines = start_app(args.udid, args.bundle_id, args.shots / "app-console.log")
    report = []
    last_round = 0
    try:
        for pose, steps in POSES:
            last_round = run_pose(args.udid, lines, last_round, args.shots, pose, steps, report)
    finally:
        app.terminate()
    failures = write_report(report, args.shots / "report.md")
    print(f"{failures} failed checks")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
