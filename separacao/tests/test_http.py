import base64
from http.client import HTTPConnection
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app
from test_pedidos import pacote_ml, tiktok
from pedidos import importar_documento


class TestHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        cls.port = cls.server.server_port
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        app.STATE.update(items=[], files=[], warnings=[])

    def call(self, route, data=None, token=True, origin=None, host=None):
        connection = HTTPConnection('127.0.0.1', self.port, timeout=10)
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['X-Session-Token'] = app.TOKEN
        if origin:
            headers['Origin'] = origin
        if host:
            headers['Host'] = host
        connection.request('POST' if data is not None else 'GET', route,
                           json.dumps(data) if data is not None else None, headers)
        result = connection.getresponse()
        status, content_type, raw = result.status, result.getheader('Content-Type'), result.read()
        connection.close()
        return status, raw if content_type == 'application/pdf' else json.loads(raw)

    def test_health(self):
        status, data = self.call('/api/health')
        self.assertEqual(status, 200)
        self.assertEqual(data['app'], app.APP)

    def test_no_token(self):
        self.assertEqual(self.call('/api/reset', {}, token=False)[0], 403)

    def test_bad_origin(self):
        self.assertEqual(self.call('/api/reset', {}, origin='https://site.example')[0], 403)

    def test_bad_host(self):
        self.assertEqual(self.call('/api/health', host='evil.example')[0], 403)

    def test_empty_and_stale_selection(self):
        self.assertEqual(self.call('/api/pdf', {'ids': []})[0], 422)
        self.assertEqual(self.call('/api/pdf', {'ids': ['missing']})[0], 422)

    def test_partial_requires_confirmation(self):
        app.STATE['items'], _ = importar_documento(pacote_ml(), 'ml.xlsx')
        data = {'ids': [app.STATE['items'][0]['id']]}
        self.assertEqual(self.call('/api/pdf', data)[0], 422)
        status, pdf = self.call('/api/pdf', dict(data, allow_partial=True))
        self.assertEqual(status, 200)
        self.assertTrue(pdf.startswith(b'%PDF-'))

    def test_import_atomic(self):
        data = {'files': [{'name': 'ok.xlsx', 'data': base64.b64encode(b'fake').decode()},
                          {'name': 'invalid.txt', 'data': ''}]}
        with patch.object(app, 'extrair_xlsx', return_value=tiktok()):
            self.assertEqual(self.call('/api/import', data)[0], 422)
        self.assertEqual(app.STATE['items'], [])

    def test_import_duplicate_and_reset(self):
        data = {'files': [{'name': 'ok.xlsx', 'data': base64.b64encode(b'fake').decode()}]}
        with patch.object(app, 'extrair_xlsx', return_value=tiktok()):
            status, first = self.call('/api/import', data)
            self.assertEqual((status, first['added']), (200, 1))
            status, second = self.call('/api/import', data)
            self.assertEqual((status, second['duplicates'], second['added']), (200, 1, 0))
        self.assertEqual(self.call('/api/reset', {})[0], 200)
        self.assertEqual(app.STATE['items'], [])


if __name__ == '__main__':
    unittest.main()
