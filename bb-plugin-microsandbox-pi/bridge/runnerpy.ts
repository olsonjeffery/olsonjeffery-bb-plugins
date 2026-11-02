// bb-plugin-microsandbox-pi — the in-box runner shim, embedded so the
// host bundle stages it into the plugin data dir at bridge start
// (bundle assets are not emitted by bb's build).
export const RUNNER_PY = String.raw`#!/usr/bin/env python3
# bb to msb in-box relay shim.
# msb --vsock HOST_PATH:PORT means the guest connects to that host socket
# (the listener lives host-side). This shim connects all routes, spawns
# the bridge child with real pipes (node cannot adopt AF_VSOCK fds) and
# pumps each lane thread-to-thread. Child stderr is teed to
# /w/child-stderr.log AND the err lane, so a dead child is diagnosable
# in-box and on the host at the same time.
import json
import os
import socket
import subprocess
import sys
import threading
import time

AF_VSOCK = getattr(socket, "AF_VSOCK", 40)
HOST_CID = 2
BUF = 65536


def die(msg):
    sys.stderr.write(f"microsandbox-pi runner: {msg}\n")
    sys.stderr.flush()
    sys.exit(1)


def connect_port(port, tries=240, delay=0.5):
    last = None
    for _ in range(tries):
        sock = socket.socket(AF_VSOCK, socket.SOCK_STREAM)
        try:
            sock.connect((HOST_CID, port))
            return sock
        except OSError as cause:
            last = cause
            sock.close()
            time.sleep(delay)
    die(f"cannot connect vsock port {port}: {last}")


def to_child(sock, stdin_pipe):
    try:
        while True:
            data = sock.recv(BUF)
            if not data:
                break
            stdin_pipe.write(data)
            stdin_pipe.flush()
    except (OSError, ValueError, BrokenPipeError):
        pass
    finally:
        for thing in (sock, stdin_pipe):
            try:
                thing.close()
            except (OSError, ValueError):
                pass


def from_child(reader, sock):
    try:
        while True:
            data = reader()
            if not data:
                break
            sock.sendall(data)
    except OSError:
        pass
    finally:
        try:
            sock.close()
        except OSError:
            pass


def err_pump(child_stderr, err_sock, err_file):
    """Child stderr -> tee to the log file and the err vsock lane."""
    keep_fwd = [True]
    try:
        while True:
            data = child_stderr.read1(BUF)
            if not data:
                break
            try:
                err_file.write(data)
                err_file.flush()
            except OSError:
                pass
            try:
                err_sock.sendall(data)
            except OSError:
                keep_fwd[0] = False
    finally:
        try:
            child_stderr.close()
        except OSError:
            pass


def main(argv):
    if "--" not in argv:
        die("usage: runner.py <in_port> <out_port> <err_port> -- <command args...>")
    split = argv.index("--")
    if len(argv[:split]) < 3 or len(argv[split + 1:]) == 0:
        die("need three route ports and a child command")
    in_port, out_port, err_port = (int(p) for p in argv[:split][:3])
    cmd = argv[split + 1:]

    child_env = dict(os.environ)
    try:
        with open("/w/env.json", "r") as handle:
            for key, value in json.load(handle).items():
                child_env[str(key)] = str(value)
    except (FileNotFoundError, ValueError):
        pass

    try:
        os.makedirs("/w/bridge-data", exist_ok=True)
    except OSError:
        pass

    stdin_sock = connect_port(in_port)
    stdout_sock = connect_port(out_port)
    stderr_sock = connect_port(err_port)

    err_file = open("/w/child-stderr.log", "wb")
    try:
        child = subprocess.Popen(
            cmd,
            env=child_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as cause:
        die(f"cannot spawn {cmd!r}: {cause}")

    threads = [
        threading.Thread(target=to_child, args=(stdin_sock, child.stdin), daemon=True),
        threading.Thread(target=from_child, args=(lambda: child.stdout.read1(BUF), stdout_sock), daemon=True),
        threading.Thread(target=err_pump, args=(child.stderr, stderr_sock, err_file), daemon=True),
    ]
    for thread in threads:
        thread.start()
    code = child.wait()
    for thread in threads:
        thread.join(timeout=10)
    try:
        with open("/w/runner-final.log", "a") as handle:
            handle.write(f"{time.time():.0f} bridge exited {code}\n")
    except OSError:
        pass
    sys.stderr.write(f"microsandbox-pi runner: bridge exited {code}\n")
    sys.exit(0)


if __name__ == "__main__":
    main(sys.argv[1:])
`;
