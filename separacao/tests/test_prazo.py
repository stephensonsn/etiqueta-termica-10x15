from datetime import date
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pedidos import data_relatorio, mesclar, prazo_despacho, importar_documento
from pdf_checklist import gerar_pdf
from test_pedidos import documento

BASE = date(2026, 11, 25)  # quarta-feira


class TestPrazo(unittest.TestCase):
    def test_textos_do_mercado_livre(self):
        casos = {
            'Você deve despachar o pacote hoje antes das 16 h em uma Agência Mercado Livre para não ter atrasos.': ('2026-11-25', False),
            'Despache amanhã antes das 11 h': ('2026-11-26', False),
            'Você deve despachar o pacote até 28 de novembro': ('2026-11-28', False),
            'Despachar: qui 27/nov, antes das 11:00 h': ('2026-11-27', False),
            'Despache até 02/12': ('2026-12-02', False),
            'Despache na sexta-feira': ('2026-11-27', False),
            'O despacho está atrasado': ('2026-11-25', True),
            'Aguardando o comprador': ('', False),
            '': ('', False),
        }
        for texto, esperado in casos.items():
            self.assertEqual(prazo_despacho(texto, BASE), esperado, texto)

    def test_virada_de_ano(self):
        self.assertEqual(prazo_despacho('Despache até 05 de janeiro', date(2026, 12, 30)), ('2027-01-05', False))

    def test_data_do_relatorio_e_itens(self):
        cab = ['N.º de venda', 'Estado', 'Descrição do status', 'Unidades', 'Título do anúncio', 'Comprador', 'Identificador do envio']
        doc = documento([['Vendas  Status das suas vendas em 25 de novembro de 2026, às 09:33 hs.'] + [''] * 6, cab,
                         ['2000000000001', 'Etiqueta impressa', 'Você deve despachar o pacote hoje antes das 16 h', '1', 'Bola', 'Ana', '48000000001'],
                         ['2000000000002', 'Pronto para enviar', 'Despache amanhã', '1', 'Carro', 'Bia', '48000000002'],
                         ['2000000000003', 'Pronto para enviar', 'Texto novo do ML', '1', 'Pião', 'Caio', '48000000003']])
        self.assertEqual(data_relatorio(doc), BASE)
        itens, avisos = importar_documento(doc, 'ml.xlsx')
        self.assertEqual([i['ship_date'] for i in itens], ['2026-11-25', '2026-11-26', ''])
        self.assertEqual(len(avisos), 1)
        self.assertIn('2000000000003', avisos[0])

    def test_relatorio_novo_atualiza_prazo_sem_divergir(self):
        a = {'id': 'x', 'order': '1', 'source': 'a', 'ship_date': '2026-11-26', 'ship_late': False, 'ship_text': 'amanhã'}
        b = dict(a, source='b', ship_date='2026-11-25', ship_text='hoje')
        juntos, dup = mesclar([a], [b])
        self.assertEqual((dup, juntos[0]['ship_date'], a['ship_date']), (1, '2026-11-25', '2026-11-26'))

    def test_pdf_com_as_duas_conferencias(self):
        item = dict(channel='Mercado Livre', order='1', package='', buyer='Ana', code='4800', tracking='', title='Bola',
                    sku='B', product_id='', variation='', quantity=1, status='', group='g', ship_date='2026-01-01', ship_late=True)
        self.assertTrue(gerar_pdf([item]).startswith(b'%PDF'))


if __name__ == '__main__':
    unittest.main()
