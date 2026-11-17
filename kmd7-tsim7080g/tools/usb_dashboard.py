#!/usr/bin/env python3
"""Local dashboard for K-MD7 firmware serial diagnostics; no Wi-Fi required."""
import argparse
import json
from pathlib import Path
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import serial
from serial.tools import list_ports

TARGET = re.compile(r'id=(\d+) range=([-\d.]+)m speed=([-\d.]+)km/h .* angle=([-\d.]+)deg')

class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.usb = False
        self.last = None
        self.live = []
        self.pending = []
        self.expected = None
        self.frames = 0
        self.detections = 0

    def line(self, text):
        with self.lock:
            if text.startswith('[TARGETS] '):
                try:
                    count = int(text.split()[1])
                except ValueError:
                    count = -1
                self.expected = count if 0 <= count <= 8 else None
                self.pending = []
            elif text.startswith('id='):
                m = TARGET.fullmatch(text.split(' signal=')[0])
                if m and self.expected is not None:
                    self.pending.append(dict(id=int(m[1]), distance_m=float(m[2]),
                                             speed_kmh=float(m[3]), angle_deg=float(m[4])))
            elif text.startswith('[FRAME] '):
                if self.expected is not None and len(self.pending) == self.expected:
                    self.live = self.pending[:]
                    self.last = time.monotonic()
                    self.frames += 1
                    self.detections += bool(self.live)
                self.expected = None
                self.pending = []
            elif text.startswith(('[ERROR]', '[WAIT]', '[VERSION]')):
                self.last = None
                self.expected = None
                self.live = []

    def disconnect(self):
        with self.lock:
            self.usb = False
            self.last = None
            self.live = []
            self.expected = None
            self.pending = []

    def snapshot(self):
        with self.lock:
            age = None if self.last is None else int((time.monotonic()-self.last)*1000)
            online = self.usb and age is not None and age < 2500
            return dict(usb_connected=self.usb, online=online, age_ms=age,
                        frames=self.frames, detection_frames=self.detections,
                        targets=self.live[:] if online else [])

def reader(state, specified_port):
    while True:
        port = specified_port
        if not port:
            matches = [p.device for p in list_ports.comports()
                       if p.vid == 0x303A and p.pid == 0x1001]
            port = matches[0] if len(matches) == 1 else None
        if not port:
            state.disconnect()
            time.sleep(1)
            continue
        try:
            with serial.Serial(port, 115200, timeout=.3) as device:
                with state.lock:
                    state.usb = True
                print('USB connected: '+port, flush=True)
                buf = bytearray()
                while True:
                    data = device.read(device.in_waiting or 1)
                    if data:
                        buf.extend(data)
                        while b'\n' in buf:
                            line, _, buf = buf.partition(b'\n')
                            state.line(line.decode(errors='replace').strip())
                        if len(buf) > 4096:
                            buf.clear()
        except (serial.SerialException, OSError) as exc:
            print('Waiting for USB: '+str(exc), flush=True)
            state.disconnect()
            time.sleep(1)

def page():
    header = (Path(__file__).resolve().parents[1]/'include/Dashboard.h').read_text()
    html = header.split('R"HTML(', 1)[1].split(')HTML"', 1)[0]
    html = html.replace('Stay connected to CheckIt-KMD7 Wi-Fi. This page works without internet.',
                        'USB connection · keep the LilyGO connected to this computer. No Wi-Fi change needed.')
    html = html.replace('Board connection lost · reconnect to CheckIt-KMD7 Wi-Fi',
                        'Local dashboard server unavailable · restart the USB dashboard')
    html = html.replace("'No recent radar reply · check power and RX/TX wiring'",
                        "(s.usb_connected ? 'USB connected · waiting for radar reply; check power and RX/TX' : 'USB disconnected · connect the LilyGO USB-C data cable and turn it on')")
    return html.encode()

def main():
    args = argparse.ArgumentParser()
    args.add_argument('--serial-port', help='Optional explicit serial device')
    args.add_argument('--port', type=int, default=8765)
    options = args.parse_args()
    state = State()
    html = page()
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/api/status':
                body, kind = json.dumps(state.snapshot()).encode(), 'application/json'
            elif self.path == '/':
                body, kind = html, 'text/html; charset=utf-8'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', options.port), Handler)
    threading.Thread(target=reader, args=(state, options.serial_port), daemon=True).start()
    print(f'Open http://127.0.0.1:{options.port} — waiting for LilyGO USB if absent.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()

if __name__ == '__main__':
    main()
