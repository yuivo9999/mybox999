#!/usr/bin/env python3
"""Small local-only static server for browser visual tests."""
from __future__ import annotations
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve a directory for local browser tests")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (defaults to loopback only)")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--root", type=Path, default=HERE / "demo", help="Directory to serve")
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"--root is not a directory: {root}")
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    try:
        server = ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as exc:
        parser.error(f"Cannot start HTTP server at {args.host}:{args.port}: {exc}")
    print(f"Serving {root}\nURL: http://{args.host}:{args.port}/\nPress Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local test server.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
