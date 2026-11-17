#!/usr/bin/env python3
"""Exercise the repository Nginx config against a real HTTP receiver.

This tests proxy forwarding, not Spring authentication or persistence.
"""
import argparse
import http.server
import pathlib
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

MIB = 1024 * 1024


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--nginx', required=True)
    parser.add_argument('--config', type=pathlib.Path,
                        default=pathlib.Path(__file__).resolve().parents[1] / 'frontend/nginx.conf')
    parser.add_argument('--expect-original-limit', action='store_true')
    args = parser.parse_args()
    received = []

    class Receiver(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            received.append(body)
            response = f'UPSTREAM_OK:{len(body)}'.encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, *_args):
            pass

    receiver = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
    thread = threading.Thread(target=receiver.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='napne-nginx-test-') as temporary:
            root = pathlib.Path(temporary)
            with socket.socket() as connection:
                connection.bind(('127.0.0.1', 0))
                proxy_port = connection.getsockname()[1]
            upstream_port = receiver.server_address[1]
            server, listens = re.subn(r'\blisten\s+80\s*;', f'listen 127.0.0.1:{proxy_port};', args.config.read_text())
            server, proxies = re.subn(r'proxy_pass\s+http://backend:9000\s*;',
                                     f'proxy_pass http://127.0.0.1:{upstream_port};', server)
            server = server.replace('/usr/share/nginx/html', str(root))
            if listens != 1 or proxies != 1:
                raise RuntimeError('Expected one frontend listener and backend proxy in the supplied config')
            config = root / 'nginx.conf'
            config.write_text(f'pid {root}/nginx.pid; error_log {root}/error.log;\n'
                              'events { worker_connections 32; }\n'
                              f'http {{ access_log off; client_body_temp_path {root}/body; '
                              f'proxy_temp_path {root}/proxy; fastcgi_temp_path {root}/fastcgi; '
                              f'uwsgi_temp_path {root}/uwsgi; scgi_temp_path {root}/scgi;\n{server}\n}}\n')
            command = [str(pathlib.Path(args.nginx).resolve()), '-p', temporary + '/',
                       '-c', str(config), '-g', 'daemon off;']
            with (root / 'startup.log').open('w') as startup:
                process = subprocess.Popen(command, stdout=startup, stderr=startup)
                try:
                    for _attempt in range(100):
                        if process.poll() is not None:
                            raise RuntimeError('Nginx startup failed: ' + (root / 'startup.log').read_text())
                        try:
                            with socket.create_connection(('127.0.0.1', proxy_port), timeout=.1):
                                break
                        except OSError:
                            time.sleep(.05)
                    else:
                        raise RuntimeError('Nginx did not become ready')

                    def check(file_size, expected, envelope_size=None):
                        boundary = 'NAPNE360TestBoundary'
                        prefix = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
                                  'filename="ficticio.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()
                        suffix = f'\r\n--{boundary}--\r\n'.encode()
                        if envelope_size is not None:
                            file_size = envelope_size - len(prefix) - len(suffix)
                        body = prefix + b'%PDF-1.7\n' + b' ' * (file_size - 9) + suffix
                        before = len(received)
                        request = urllib.request.Request(f'http://127.0.0.1:{proxy_port}/api/v1/upload-test', body,
                                                         {'Content-Type': f'multipart/form-data; boundary={boundary}'})
                        try:
                            with urllib.request.urlopen(request, timeout=15) as response:
                                status, response_body = response.status, response.read()
                        except urllib.error.HTTPError as error:
                            status, response_body = error.code, error.read()
                        require(status == expected, f'file={file_size}: expected {expected}, got {status}')
                        if expected == 200:
                            require(len(received) == before + 1 and received[-1] == body, 'Upstream did not receive the complete multipart body')
                            require(response_body == f'UPSTREAM_OK:{len(body)}'.encode(), 'Unexpected upstream response')
                        else:
                            require(len(received) == before, 'Rejected request reached upstream')
                        print(f'PASS file={file_size} body={len(body)} status={status} forwarded={expected == 200}')

                    check(512 * 1024, 200)
                    check(2 * MIB, 413 if args.expect_original_limit else 200)
                    if not args.expect_original_limit:
                        check(10 * MIB, 200)
                        check(10 * MIB + 1, 200)  # Spring, not the proxy, enforces the FILE limit.
                        check(11 * MIB, 413)  # The multipart envelope exceeds 11 MiB.
                        check(0, 200, envelope_size=11 * MIB)
                        check(0, 413, envelope_size=11 * MIB + 1)
                finally:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
    finally:
        receiver.shutdown()
        receiver.server_close()
        thread.join(timeout=5)


if __name__ == '__main__':
    main()
