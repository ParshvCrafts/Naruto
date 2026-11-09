"""
No-cache HTTP server for local development.
Run: python serve.py
Then open: http://localhost:8765/app/
"""
import http.server

PORT = 8765

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        print(fmt % args)

# Threaded: browsers open speculative (preconnect) sockets that may never send a
# request. A single-threaded TCPServer blocks on such a socket and every other
# request (modules, model, videos) stalls until it times out.
class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a SECOND serve.py bind the same port silently, so a
    # stale instance could keep answering. Fail loudly with 'address in use' instead.
    allow_reuse_address = False

with Server(('', PORT), NoCacheHandler) as httpd:
    print(f'Serving at http://localhost:{PORT}/')
    print(f'Open app at http://localhost:{PORT}/app/')
    httpd.serve_forever()
