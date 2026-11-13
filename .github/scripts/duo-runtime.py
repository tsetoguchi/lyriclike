"""Prints the newest available iOS simulator runtime that supports a device type.

Reads `xcrun simctl list runtimes -j` on stdin; the device type identifier is
the only argument. Exits with an error when no runtime supports it.
"""
import json
import sys


def supports(runtime, device_type):
    types = runtime.get("supportedDeviceTypes", [])
    return any(entry.get("identifier") == device_type for entry in types)


def main():
    device_type = sys.argv[1]
    runtimes = json.load(sys.stdin)["runtimes"]
    matches = [
        runtime for runtime in runtimes
        if runtime.get("isAvailable") and runtime.get("platform") == "iOS"
        and supports(runtime, device_type)
    ]
    if not matches:
        sys.exit(f"No available iOS runtime supports {device_type}")
    print(matches[-1]["identifier"])


if __name__ == "__main__":
    main()
