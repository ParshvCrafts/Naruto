"""
No-cache HTTP server for local development.
Run: python serve.py
Then open: http://localhost:8765/app/
"""
import http.server
import sys

PORT = 8765

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # Keep-alive: one connection serves many requests. With HTTP/1.0 every asset opened
    # a new TCP connection, and the page's burst of parallel loads intermittently failed
    # on Windows with net::ERR_NO_BUFFER_SPACE.
    protocol_version = 'HTTP/1.1'

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
    # socketserver's default listen backlog is 5; the app opens bursts of parallel
    # requests (sign images, cards, video preloads) and Windows then refused some
    # with ERR_NO_BUFFER_SPACE.
    request_queue_size = 128

    def handle_error(self, request, client_address):
        # Browsers routinely drop keep-alive and video-range sockets mid-response; that is
        # normal, so don't print a scary traceback for it.
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)

with Server(('', PORT), NoCacheHandler) as httpd:
    print(f'Serving at http://localhost:{PORT}/')
    print(f'Open app at http://localhost:{PORT}/app/')
    httpd.serve_forever()
