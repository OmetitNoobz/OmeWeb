#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OmeRyth Web - Serveur Local Autonome Multi-Appareils
Héberge l'application OmeRyth Web sur votre réseau local (Wi-Fi / LAN).
Génère un QR Code dans la console pour connexion instantanée depuis smartphone ou tablette.
Supporte le streaming vidéo partiel (Range Requests) pour une lecture fluide sur iOS/Android/PC.
"""

import os
import sys
import socket
import threading
import uuid
import json
import subprocess
import shutil
import time
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PORT = 8080
TASKS = {}
TASK_LOCK = threading.Lock()
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_transcribe")
os.makedirs(TEMP_DIR, exist_ok=True)

def get_base_dir():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def get_ffmpeg_path():
    base = get_base_dir()
    local_ffmpeg = os.path.join(base, "ffmpeg", "ffmpeg.exe")
    if os.path.exists(local_ffmpeg):
        return local_ffmpeg
    which = shutil.which("ffmpeg")
    return which or local_ffmpeg

def check_whisper_engine():
    base = get_base_dir()
    worker_script = os.path.join(base, "whisperx_engine", "whisperx_worker.py")
    has_worker = os.path.exists(worker_script)
    has_ffmpeg = os.path.exists(get_ffmpeg_path())
    try:
        import faster_whisper
        has_whisper = True
    except Exception:
        has_whisper = False
    return has_worker and has_ffmpeg and has_whisper

def _run_transcription(task_id, temp_media_path, lang, model, num_speakers, target_band):
    task = TASKS[task_id]
    temp_wav = os.path.join(TEMP_DIR, f"{task_id}.wav")
    temp_json = os.path.join(TEMP_DIR, f"{task_id}_out.json")
    temp_report = os.path.join(TEMP_DIR, f"{task_id}_report.json")

    try:
        # 1. Extraction audio 16kHz mono via FFmpeg
        task["message"] = "Extraction audio haute vitesse via FFmpeg..."
        task["progress"] = 10

        ffmpeg_bin = get_ffmpeg_path()
        cmd_ffmpeg = [
            ffmpeg_bin, "-y",
            "-i", temp_media_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            temp_wav
        ]

        res = subprocess.run(cmd_ffmpeg, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
        if res.returncode != 0 or not os.path.exists(temp_wav):
            task["status"] = "error"
            task["error"] = f"Échec extraction audio FFmpeg : {res.stderr.decode('utf-8', errors='ignore')[:300]}"
            return

        # 2. Exécution du moteur Whisper IA
        base = get_base_dir()
        worker_script = os.path.join(base, "whisperx_engine", "whisperx_worker.py")
        task["message"] = f"Initialisation Whisper IA ({model.upper()})..."
        task["progress"] = 20

        cmd_worker = [
            sys.executable, "-u", worker_script,
            "--audio", temp_wav,
            "--output", temp_json,
            "--report", temp_report,
            "--lang", lang,
            "--model", model,
            "--num-speakers", str(max(0, num_speakers)),
            "--threads", "4",
            "--device", "auto"
        ]

        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"

        proc = subprocess.Popen(cmd_worker, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", env=env)
        task["process"] = proc

        for raw_line in proc.stdout:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("PROGRESS:"):
                parts = line.split(":", 3)
                if len(parts) >= 4:
                    try:
                        cur = int(parts[1])
                        total = int(parts[2])
                        msg = parts[3]
                        task["progress"] = max(task["progress"], int((cur * 100) / total))
                        task["message"] = msg
                    except Exception:
                        pass
            elif line.startswith("LIVE_SEGMENT:"):
                try:
                    seg = json.loads(line[13:].strip())
                    task["live_segments"].append(seg)
                except Exception:
                    pass
            elif line.startswith("SEGMENT:"):
                try:
                    seg = json.loads(line[8:].strip())
                    task["segments"].append(seg)
                except Exception:
                    pass
            elif line.startswith("ERROR:"):
                task["error"] = line[6:].strip()

        proc.wait()

        # 3. Récupération des résultats finaux
        final_segments = []
        if os.path.exists(temp_json):
            try:
                with open(temp_json, "r", encoding="utf-8") as f:
                    payload = json.load(f)
                    final_segments = payload.get("segments", [])
            except Exception:
                pass

        if not final_segments:
            final_segments = task["segments"] if task["segments"] else task["live_segments"]

        if not final_segments and proc.returncode != 0:
            task["status"] = "error"
            task["error"] = task.get("error") or f"Erreur du moteur de transcription (code {proc.returncode})"
            return

        task["segments"] = final_segments
        task["progress"] = 100
        task["message"] = f"Transcription terminée ! {len(final_segments)} répliques détectées."
        task["status"] = "done"

    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)
    finally:
        for p in [temp_media_path, temp_wav, temp_json, temp_report]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass

def get_local_ip():
    """Détecte l'adresse IPv4 locale sur le réseau Wi-Fi/LAN."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def print_ascii_qr(url):
    """Génère un QR Code ASCII textuel directement dans la console."""
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        print("\n  Scannez ce QR Code avec l'appareil photo de votre smartphone :\n")
        qr.print_ascii(invert=True)
        return
    except Exception:
        pass

    print("  " + "─" * 56)
    print(f"  URL d'accès : {url}")
    print("  " + "─" * 56)

class RangeRequestHandler(SimpleHTTPRequestHandler):
    """
    Gestionnaire HTTP supportant les requêtes Range (HTTP 206 Partial Content)
    et API de transcription IA intégrée.
    """
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Range, Content-Type, X-Filename')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        # 1. API Statut de la transcription
        if parsed.path == '/api/status':
            is_ready = check_whisper_engine()
            payload = {
                "status": "ok",
                "transcription_available": is_ready,
                "has_ffmpeg": os.path.exists(get_ffmpeg_path()),
                "local_ip": get_local_ip()
            }
            body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 2. API Suivi de progression de la transcription
        if parsed.path == '/api/transcribe/status':
            qs = urllib.parse.parse_qs(parsed.query)
            task_id = qs.get('task_id', [''])[0]
            with TASK_LOCK:
                task = TASKS.get(task_id)

            if not task:
                self.send_error(404, "Tâche introuvable")
                return

            resp = {
                "task_id": task_id,
                "status": task.get("status", "running"),
                "progress": task.get("progress", 0),
                "message": task.get("message", ""),
                "live_count": len(task.get("live_segments", [])),
                "segments": task.get("segments", []),
                "error": task.get("error")
            }
            body = json.dumps(resp, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        # 1. Lancement de la transcription
        if parsed.path == '/api/transcribe':
            qs = urllib.parse.parse_qs(parsed.query)
            lang = qs.get('lang', ['fr'])[0]
            model = qs.get('model', ['small'])[0]
            speakers = int(qs.get('speakers', ['0'])[0])
            band = int(qs.get('band', ['0'])[0])

            content_len = int(self.headers.get('Content-Length', 0))
            if content_len <= 0:
                self.send_error(400, "Aucun contenu média envoyé")
                return

            task_id = uuid.uuid4().hex
            temp_file = os.path.join(TEMP_DIR, f"{task_id}_upload.tmp")

            # Réception en streaming par paquets de 64 Ko
            with open(temp_file, "wb") as f:
                remaining = content_len
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)

            # Enregistrement et lancement du worker dans un thread dédié
            with TASK_LOCK:
                TASKS[task_id] = {
                    "task_id": task_id,
                    "status": "starting",
                    "progress": 5,
                    "message": "Fichier média reçu, préparation de l'extraction...",
                    "segments": [],
                    "live_segments": [],
                    "error": None,
                    "process": None
                }

            threading.Thread(
                target=_run_transcription,
                args=(task_id, temp_file, lang, model, speakers, band),
                daemon=True
            ).start()

            resp = {"task_id": task_id, "status": "started"}
            body = json.dumps(resp, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 2. Annulation de transcription
        if parsed.path == '/api/transcribe/cancel':
            qs = urllib.parse.parse_qs(parsed.query)
            task_id = qs.get('task_id', [''])[0]
            with TASK_LOCK:
                task = TASKS.get(task_id)
                if task and task.get("process"):
                    try:
                        task["process"].kill()
                    except Exception:
                        pass
                    task["status"] = "cancelled"
                    task["message"] = "Transcription annulée."

            resp = {"status": "cancelled"}
            body = json.dumps(resp, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_error(404, "Endpoint non trouvé")

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    local_ip = get_local_ip()
    local_url = f"http://localhost:{PORT}"
    network_url = f"http://{local_ip}:{PORT}"

    print("=" * 66)
    print("        OmeRyth Web - Serveur Studio Multi-Appareils")
    print("=" * 66)
    print(f"  Accès Local (ce PC)  : {local_url}")
    print(f"  Accès Réseau (Mobile): \033[1;32m{network_url}\033[0m")
    print("=" * 66)

    print_ascii_qr(network_url)

    print("\n  [Prêt] Ouvrez cette adresse sur n'importe quel téléphone, tablette ou PC.")
    print("  Appuyez sur Ctrl+C pour arrêter le serveur à tout moment.\n")

    server_address = ('0.0.0.0', PORT)
    try:
        httpd = HTTPServer(server_address, RangeRequestHandler)
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur OmeRyth Web.")
        sys.exit(0)
    except OSError as e:
        if e.errno == 10048 or 'Address already in use' in str(e):
            print(f"\n[Port occupé] Le port {PORT} est déjà utilisé. Essai sur le port {PORT + 1}...")
            httpd = HTTPServer(('0.0.0.0', PORT + 1), RangeRequestHandler)
            print(f"  Accès Réseau : http://{local_ip}:{PORT + 1}")
            httpd.serve_forever()
        else:
            raise e

if __name__ == '__main__':
    run_server()
