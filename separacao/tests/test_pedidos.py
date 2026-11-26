import copy
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pedidos import (ErroImportacao, extrair_xlsx, importar_documento, mesclar,
                     pacotes_parciais, quantidade, selecionar_codigo)
from pdf_checklist import gerar_pdf


ML = ['N.º de venda', 'Estado', 'Pacote de diversos produtos', 'Unidades',
      'Título do anúncio', 'Variação', 'SKU', '# de anúncio', 'Comprador',
      'Identificador do envio', 'Número de rastreamento', 'Unidades']
TT = ['Order ID', 'Package ID', 'Order Status', 'Product Name', 'Variation',
      'Seller SKU', 'SKU ID', 'Quantity', 'Recipient', 'Tracking ID']


def documento(linhas):
    return {'tables': [{'data': {'num_rows': len(linhas), 'num_cols': len(linhas[0]),
            'table_cells': [{'start_row_offset_idx': r, 'start_col_offset_idx': c, 'text': v}
                            for r, linha in enumerate(linhas) for c, v in enumerate(linha)]}}]}


def pacote_ml():
    return documento([ML,
        ['200000000000001', 'Pacote de 2 produtos', '', '', '', '', '', '', 'Cliente Exemplo', '48000000001', 'MEL48000000001FMDOF01', ''],
        ['200000000000002', 'Etiqueta impressa', 'Sim', '1.0', 'Kit 3 brinquedos', 'Azul', 'KIT3', 'MLB001', '', '', '', '99'],
        ['200000000000003', 'Etiqueta impressa', 'Sim', '2.0', 'Carrinho', 'Verde', 'CAR1', 'MLB002', '', '', '', '99'],
        ['200000000000004', 'Etiqueta impressa', 'Não', '1.0', 'Bola', 'Rosa', 'BOLA', 'MLB003', 'Outra Cliente', '48000000002', 'MEL48000000002FMDOF01', '99']])


def tiktok():
    return documento([TT, ['Platform unique order ID.'] + [''] * 9,
        ['587000000000000001', '1220000000000000001', 'A ser enviado', 'Brinquedo <A> & B', 'Azul', '',
         '1738000000000000001', '1', 'Cliente Teste', '3320000000001']])


class TestPedidos(unittest.TestCase):
    def test_ml_pack_e_coluna_unidades_correta(self):
        itens, avisos = importar_documento(pacote_ml(), 'ml.xlsx')
        self.assertEqual(len(itens), 3)
        self.assertEqual([i['quantity'] for i in itens], [1, 2, 1])
        self.assertEqual(itens[0]['group'], itens[1]['group'])
        self.assertNotEqual(itens[1]['group'], itens[2]['group'])
        self.assertEqual(itens[1]['buyer'], 'Cliente Exemplo')
        self.assertEqual(itens[2]['buyer'], 'Outra Cliente')
        self.assertEqual(len(avisos), 1)  # só o aviso de relatório sem prazo de despacho
        self.assertIn('Descrição do status', avisos[0])

    def test_tiktok_ignora_descricao_preserva_ids(self):
        itens, avisos = importar_documento(tiktok(), 'tt.xlsx')
        self.assertEqual(len(itens), 1)
        self.assertEqual(itens[0]['order'], '587000000000000001')
        self.assertEqual(itens[0]['product_id'], '1738000000000000001')
        self.assertEqual(itens[0]['channel'], 'TikTok Shop')
        self.assertEqual(avisos, [])

    def test_reimportar_nao_duplica(self):
        itens, _ = importar_documento(pacote_ml(), 'um.xlsx')
        copia = copy.deepcopy(itens)
        for i in copia:
            i['source'] = 'dois.xlsx'
        final, n = mesclar(itens, copia)
        self.assertEqual(len(final), 3)
        self.assertEqual(n, 3)
        self.assertEqual(sum(i['quantity'] for i in final), 4)

    def test_conflito_nao_altera_original(self):
        itens, _ = importar_documento(tiktok(), 'tt.xlsx')
        copia = copy.deepcopy(itens)
        copia[0]['quantity'] = 3
        with self.assertRaises(ErroImportacao):
            mesclar(itens, copia)
        self.assertEqual(itens[0]['quantity'], 1)

    def test_pacote_faltando_linha(self):
        doc = pacote_ml()
        for cell in doc['tables'][0]['data']['table_cells']:
            if cell['text'] == 'Pacote de 2 produtos':
                cell['text'] = 'Pacote de 3 produtos'
        with self.assertRaisesRegex(ErroImportacao, 'esperado'):
            importar_documento(doc, 'incompleto.xlsx')

    def test_cancelado_avisa_e_exclui(self):
        doc = tiktok()
        for cell in doc['tables'][0]['data']['table_cells']:
            if cell['text'] == 'A ser enviado':
                cell['text'] = 'Cancelado'
        itens, avisos = importar_documento(doc, 'cancelado.xlsx')
        self.assertEqual(itens, [])
        self.assertIn('Cancelado', avisos[0])

    def test_status_desconhecido_nao_aparece_pronto(self):
        doc = tiktok()
        for cell in doc['tables'][0]['data']['table_cells']:
            if cell['text'] == 'A ser enviado':
                cell['text'] = 'Status futuro'
        itens, avisos = importar_documento(doc, 'status.xlsx')
        self.assertEqual(itens, [])
        self.assertEqual(len(avisos), 1)

    def test_qr_e_pedido_filho_selecionam_pacote(self):
        itens, _ = importar_documento(pacote_ml(), 'ml.xlsx')
        for codigo in ['48000000001', 'MEL48000000001FMDOF01', '200000000000001',
                       '200000000000002', 'LA,{"id":"48000000001","t":"lm"}']:
            self.assertEqual(len(selecionar_codigo(itens, codigo)), 2)

    def test_codigo_parcial_ou_nome_nao_casam(self):
        itens, _ = importar_documento(pacote_ml(), 'ml.xlsx')
        for codigo in ['480000', 'Cliente Exemplo', '', 'not-a-code']:
            with self.assertRaises(ErroImportacao):
                selecionar_codigo(itens, codigo)

    def test_parcial(self):
        itens, _ = importar_documento(pacote_ml(), 'ml.xlsx')
        self.assertEqual(len(pacotes_parciais(itens, itens[:1])), 1)
        self.assertEqual(pacotes_parciais(itens, itens[:2]), [])
        self.assertEqual(pacotes_parciais(itens, itens[2:]), [])

    def test_quantidade_invalida(self):
        for valor in ['', 'zero', '0', '-1', '1.5', 'NaN', 'Infinity']:
            with self.assertRaises(ErroImportacao):
                quantidade(valor)

    def test_formato_desconhecido(self):
        with self.assertRaises(ErroImportacao):
            importar_documento(documento([['Outro', 'Layout'], ['1', '2']]), 'outro.xlsx')

    def test_pdf_um_e_varios_itens_xml_seguro(self):
        a, _ = importar_documento(pacote_ml(), 'ml.xlsx')
        b, _ = importar_documento(tiktok(), 'tt.xlsx')
        for lista in [a[:1], a + b, (a + b) * 12]:
            self.assertTrue(gerar_pdf(lista).startswith(b'%PDF-'))
        with self.assertRaises(ValueError):
            gerar_pdf([])

    @unittest.skipUnless(os.getenv('SEPARACAO_TESTAR_ARQUIVOS') == '1', 'Integração real opcional via Docling')
    def test_planilhas_reais_via_docling(self):
        arquivos = [Path.home() / 'Downloads/Para enviar pedido-2026-11-25-11_06.xlsx',
                    Path.home() / 'Downloads/20261125_Vendas_BR_Mercado_Libre_y_Mercado_Shops_2026-11-25_09-33hs_3829758279.xlsx']
        todos = []
        for arquivo in arquivos:
            itens, avisos = importar_documento(extrair_xlsx(arquivo.read_bytes()), arquivo.name)
            self.assertEqual(avisos, [])
            todos, _ = mesclar(todos, itens)
        self.assertEqual(len(todos), 11)
        self.assertEqual(sum(i['quantity'] for i in todos), 12)
        self.assertEqual(len({i['group'] for i in todos}), 10)
        self.assertEqual(len(selecionar_codigo(todos, '48622217652')), 2)


if __name__ == '__main__':
    unittest.main()
