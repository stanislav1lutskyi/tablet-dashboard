#!/usr/bin/env python3
"""Локальний сервер для табло (Windows/Linux/macOS). Запуск: python server.py [порт]
Роздає файли програми. Окрім того, працює як проксі до alerts.in.ua (/proxy/alerts/...),
що вирішує проблему CORS: у налаштуваннях табло вкажіть адресу API  http://<IP-комп'ютера>:8080/proxy/alerts
"""
import sys, http.server, socketserver, urllib.request, urllib.error, socket, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
UPSTREAM = 'https://api.alerts.in.ua'
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/proxy/alerts/'):
            url = UPSTREAM + self.path[len('/proxy/alerts'):]
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'smart-dashboard'})
                with urllib.request.urlopen(req, timeout=15) as r:
                    body = r.read(); code = r.status
            except urllib.error.HTTPError as e:
                body = e.read(); code = e.code
            except Exception as e:
                body = str(e).encode('utf-8'); code = 502
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body)
            return
        super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *a): pass

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(('8.8.8.8', 80)); return s.getsockname()[0]
    except Exception: return '127.0.0.1'
    finally: s.close()

if __name__ == '__main__':
    print('Табло запущено.')
    print('  На цьому комп\'ютері:  http://localhost:%d' % PORT)
    print('  З планшета (Wi-Fi):    http://%s:%d' % (lan_ip(), PORT))
    print('  Проксі тривог:         http://%s:%d/proxy/alerts' % (lan_ip(), PORT))
    print('Закрийте вікно або натисніть Ctrl+C, щоб зупинити.')
    try: Server(('', PORT), Handler).serve_forever()
    except KeyboardInterrupt: pass
