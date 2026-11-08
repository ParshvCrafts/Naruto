"""
No-cache HTTP server for local development.
Run: python serve.py
Then open: http://localhost:8765/app/
"""
import http.server
import socketserver

PORT = 8765

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        print(fmt % args)

with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
    print(f'Serving at http://localhost:{PORT}/')
    print(f'Open app at http://localhost:{PORT}/app/')
    httpd.serve_forever()
