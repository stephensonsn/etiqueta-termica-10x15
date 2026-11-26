#!/usr/bin/env python3
"""Servidor da tela local. Executar pelo arquivo Abrir Separação.command."""
import argparse
import base64
import binascii
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import subprocess
import threading
from urllib.error import URLError
from urllib.request import urlopen
import webbrowser
from zoneinfo import ZoneInfo

from pedidos import ErroImportacao, extrair_xlsx, importar_documento, mesclar, pacotes_parciais, selecionar_codigo
from pdf_checklist import gerar_pdf
from tela import PAGINA

APP = 'separacao-etiqueta-ml'
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.Lock()
STATE = {'items': [], 'files': [], 'warnings': []}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *args):
        pass  # Não grava nomes de clientes ou conteúdo dos pedidos em logs.

    def send(self, payload, status=200, content_type='application/json; charset=utf-8', extra=None):
        data = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload, (dict, list)) else payload
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', f"default-src 'none'; script-src 'nonce-{TOKEN}'; style-src 'nonce-{TOKEN}'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def local(self):
        port = self.server.server_port
        return self.headers.get('Host') in {f'127.0.0.1:{port}', f'localhost:{port}'}

    def do_GET(self):
        if not self.local():
            return self.send({'error': 'Acesso permitido somente pelo endereço local.'}, 403)
        if self.path == '/':
            return self.send(PAGINA.replace('__TOKEN__', TOKEN).replace('__NONCE__', TOKEN).encode(),
                             content_type='text/html; charset=utf-8')
        if self.path == '/api/health':
            return self.send({'app': APP, 'version': 1})
        if self.path == '/api/state':
            with LOCK:
                return self.send(STATE)
        self.send({'error': 'Página não encontrada.'}, 404)

    def do_POST(self):
        origin = self.headers.get('Origin')
        port = self.server.server_port
        if (not self.local() or self.headers.get('X-Session-Token') != TOKEN or
                (origin and origin not in {f'http://127.0.0.1:{port}', f'http://localhost:{port}'})):
            return self.send({'error': 'Sessão inválida. Reabra a página local.'}, 403)
        if self.headers.get_content_type() != 'application/json':
            return self.send({'error': 'Formato de requisição inválido.'}, 415)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 44 * 1024 * 1024:
                return self.send({'error': 'Envio muito grande. Importe menos arquivos por vez.'}, 413)
            self.connection.settimeout(240)
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Requisição inválida.')
            with LOCK:
                result = self.process(data)
            if isinstance(result, bytes):
                name = datetime.now(ZoneInfo('America/Sao_Paulo')).strftime('Checklist-separacao-%Y-%m-%d-%H%M%S.pdf')
                return self.send(result, content_type='application/pdf',
                                 extra={'Content-Disposition': f'attachment; filename="{name}"', 'X-Filename': name})
            self.send(result)
        except subprocess.TimeoutExpired:
            self.send({'error': 'A leitura excedeu 3 minutos. Exporte um lote menor e tente novamente.'}, 422)
        except (ErroImportacao, ValueError, TypeError, KeyError, binascii.Error) as exc:
            self.send({'error': str(exc) or 'Dados inválidos. Confira o arquivo enviado.'}, 422)
        except Exception:
            self.send({'error': 'Não foi possível concluir. Os dados anteriores foram preservados. Tente um lote menor ou reinicie o aplicativo.'}, 500)

    def process(self, data):
        if self.path == '/api/import':
            arquivos = data.get('files')
            if not isinstance(arquivos, list) or not 1 <= len(arquivos) <= 10:
                raise ErroImportacao('Selecione entre 1 e 10 planilhas XLSX.')
            novos, avisos, nomes = [], [], []
            for arquivo in arquivos:
                nome = Path(str(arquivo['name'])).name
                if not nome.lower().endswith('.xlsx'):
                    raise ErroImportacao('Somente arquivos XLSX são aceitos.')
                documento = extrair_xlsx(base64.b64decode(arquivo['data'], validate=True))
                itens, alertas = importar_documento(documento, nome)
                novos.extend(itens)
                avisos.extend(alertas)
                nomes.append(nome)
            juntos, repetidos = mesclar(STATE['items'], novos)
            if len(juntos) > 5000:
                raise ErroImportacao('Limite de 5.000 itens por lote. Exporte um relatório menor.')
            adicionados = len(juntos) - len(STATE['items'])
            # Atualização atômica: falha em qualquer arquivo não muda o lote existente.
            STATE.update(items=juntos, files=list(dict.fromkeys(STATE['files'] + nomes)),
                         warnings=list(dict.fromkeys(STATE['warnings'] + avisos)))
            return dict(STATE, added=adicionados, duplicates=repetidos)
        if self.path == '/api/match':
            return {'ids': selecionar_codigo(STATE['items'], str(data.get('code', '')))}
        if self.path == '/api/reset':
            STATE.update(items=[], files=[], warnings=[])
            return {'ok': True}
        if self.path == '/api/pdf':
            ids = data.get('ids')
            if not isinstance(ids, list) or not ids or not all(isinstance(x, str) for x in ids):
                raise ErroImportacao('Selecione pelo menos um produto.')
            conjunto = set(ids)
            escolhidos = [i for i in STATE['items'] if i['id'] in conjunto]
            if len(escolhidos) != len(conjunto):
                raise ErroImportacao('Seleção desatualizada. Recarregue a página e selecione novamente.')
            parciais = pacotes_parciais(STATE['items'], escolhidos)
            if parciais and data.get('allow_partial') is not True:
                raise ErroImportacao('Seleção parcial de pacote. Selecione todos os itens ou confirme a geração parcial.')
            return gerar_pdf(escolhidos, parciais)
        raise ErroImportacao('Operação não reconhecida.')


def main():
    parser = argparse.ArgumentParser(description='Checklist de separação local')
    parser.add_argument('--port', type=int, default=9175)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    url = f'http://127.0.0.1:{args.port}'
    try:
        with urlopen(url + '/api/health', timeout=2) as resposta:
            ativo = json.load(resposta).get('app') == APP
    except (URLError, OSError, ValueError):
        ativo = False
    if ativo:
        print('A tela já está aberta. Reabrindo no navegador: ' + url)
        if not args.no_browser:
            webbrowser.open(url)
        return
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError:
        print(f'A porta {args.port} está ocupada por outro programa. Execute com --port 9176.')
        raise SystemExit(1)
    print(f'\nSeparação de pedidos: {url}\n')
    print('Mantenha esta janela aberta enquanto usa a tela. Para encerrar, pressione Control+C.\n', flush=True)
    if not args.no_browser:
        threading.Timer(.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nAplicativo encerrado. Os arquivos originais não foram alterados.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
