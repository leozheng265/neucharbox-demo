"""Local preview server for the demo with caching disabled, so edits show up on a
plain refresh. Usage:  python demo/serve.py  [port]   (default 8765)"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter console
        if '404' in (args[1] if len(args) > 1 else ''):
            super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # the default backlog of 5 refuses connections when several tabs load at once
    daemon_threads = True


if __name__ == '__main__':
    Handler.extensions_map.update({'.js': 'text/javascript', '.mjs': 'text/javascript'})
    with Server(('', PORT), Handler) as httpd:
        print(f'NeuCharBox demo: http://localhost:{PORT}/  (Ctrl+C to stop)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
