"""Checklist A4 com paginação legível, sem alterar as quantidades comerciais."""
from collections import Counter
from datetime import datetime
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Margens de impressão (26/11/2026: com 10 mm o conteúdo e o rodapé ficavam colados na borda e
# a impressora cortava). Toda impressora comum imprime com folga a partir de ~6 mm da borda.
LADO = 15 * mm     # esquerda e direita
TOPO = 15 * mm
RODAPE = 12 * mm   # linha de texto do rodapé (a régua fica 4 mm acima)
BASE = 24 * mm     # fim do conteúdo: acima da régua do rodapé, com folga


INK = colors.HexColor('#172B35')
MUTED = colors.HexColor('#465D67')
LINE = colors.HexColor('#CCD5D9')


def fontes():
    pasta = Path('/System/Library/Fonts/Supplemental')
    if (pasta / 'Arial.ttf').exists():
        if 'Checklist' not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont('Checklist', str(pasta / 'Arial.ttf')))
            pdfmetrics.registerFont(TTFont('Checklist-Bold', str(pasta / 'Arial Bold.ttf')))
            pdfmetrics.registerFontFamily('Checklist', normal='Checklist', bold='Checklist-Bold')
        return 'Checklist', 'Checklist-Bold'
    return 'Helvetica', 'Helvetica-Bold'


class Check(Flowable):
    def __init__(self):
        super().__init__()
        self.width = self.height = 11

    def draw(self):
        self.canv.setStrokeColor(INK)
        self.canv.setLineWidth(.8)
        self.canv.rect(0, 0, 11, 11, stroke=1, fill=0)


def gerar_pdf(itens, parciais=()):
    if not itens:
        raise ValueError('Selecione pelo menos um produto.')
    normal, negrito = fontes()
    estilo = ParagraphStyle('body', fontName=normal, fontSize=8.5, leading=10.5, textColor=INK)
    pequeno = ParagraphStyle('small', parent=estilo, fontSize=7.1, leading=8.8, textColor=MUTED)
    etiqueta = ParagraphStyle('label', parent=estilo, fontSize=8, leading=10.1)
    numero = ParagraphStyle('quantity', parent=estilo, fontName=negrito, fontSize=13, leading=15, alignment=TA_CENTER)
    cabecalho = ParagraphStyle('head', parent=pequeno, fontName=negrito, fontSize=7.5, leading=9, textColor=colors.white)
    cabecalho_c = ParagraphStyle('headc', parent=cabecalho, fontSize=6.6, leading=7.8, alignment=TA_CENTER)
    p = lambda text, style=estilo: Paragraph(text, style)
    seguro = lambda text: escape(' '.join(str(text).split()))
    grupos = Counter(i['group'] for i in itens)
    indices = {key: n for n, key in enumerate(grupos, 1)}
    agora = datetime.now(ZoneInfo('America/Sao_Paulo'))
    plataformas = ' e '.join(dict.fromkeys(i['channel'] for i in itens))
    hoje_iso = agora.date().isoformat()

    def despacho(item):
        data = item.get('ship_date') or ''
        if not data:
            return 'Despacho: confira o prazo'
        if item.get('ship_late') or data < hoje_iso:
            return '<b>DESPACHO ATRASADO</b>'
        return 'Despachar: <b>hoje</b>' if data == hoje_iso else f'Despachar: {data[8:]}/{data[5:7]}'
    so_hoje = all(i.get('ship_date') and (i.get('ship_late') or i['ship_date'] <= hoje_iso) for i in itens)
    historia = [p('Separação e conferência', ParagraphStyle('title', parent=estilo, fontName=negrito, fontSize=20, leading=23)),
                Spacer(1, 4), p(f'{"Despacho de hoje, " if so_hoje else ""}{agora:%d/%m/%Y} · {seguro(plataformas)}'), Spacer(1, 11),
                p(f'<b>{len(grupos)} pacotes</b> &nbsp; / &nbsp; <b>{len(itens)} itens de pedido</b> &nbsp; / &nbsp; '
                  f'<b>{sum(i["quantity"] for i in itens)} unidades de venda</b>'), Spacer(1, 5),
                p('Compare o envio/rastreio com a etiqueta. Marque <b>Separado e embalado</b> ao fechar o pacote e <b>Despachado</b> ao entregar na agência ou na coleta.', pequeno), Spacer(1, 9)]
    if parciais:
        historia += [p(f'<b>SELEÇÃO PARCIAL: {len(parciais)} pacote(s) com produtos não incluídos neste checklist.</b>', estilo), Spacer(1, 7)]
    dados = [[p('Plataforma / etiqueta / destinatário', cabecalho), p('Produto / variação / referência', cabecalho),
              p('Qtd.', cabecalho), p('Separado e embalado', cabecalho_c), p('Despa-<br/>chado', cabecalho_c)]]
    for item in itens:
        chave = item['group']
        tipo = 'envio' if item['channel'] == 'Mercado Livre' else 'rastreio'
        tag = f'<b>{indices[chave]:02d} &nbsp; {seguro(item["channel"])} · {tipo}</b>'
        if grupos[chave] > 1:
            tag += f' <font size="7">({grupos[chave]} itens)</font>'
        if chave in parciais:
            tag += '<br/><b>PACOTE INCOMPLETO</b>'
        rotulo = p(f'{tag}<br/><b>{seguro(item["code"] or "SEM CÓDIGO")}</b><br/>{seguro(item["buyer"] or "Destinatário não informado")}<br/>'
                   f'<font size="7" color="#465D67">Venda: {seguro(item["order"])}</font><br/><font size="7">{despacho(item)}</font>', etiqueta)
        referencia = ('SKU: ' + item['sku'] if item['sku'] else
                      ('Anúncio: ' if item['channel'] == 'Mercado Livre' else 'ID SKU: ') + (item['product_id'] or 'não informado'))
        detalhe = (seguro(item['variation']) + '<br/>' if item['variation'] else '') + seguro(referencia)
        produto = [p(seguro(item['title'])), Spacer(1, 3), p(detalhe, pequeno)]
        dados.append([rotulo, produto, p(str(item['quantity']), numero), Check(), Check()])
    largura = A4[0] - 2 * LADO
    tabela = Table(dados, colWidths=[148, largura - 268, 30, 50, 40], repeatRows=1, hAlign='LEFT')
    comandos = [('BACKGROUND', (0, 0), (-1, 0), INK), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ('ALIGN', (2, 0), (-1, -1), 'CENTER')]
    for n, item in enumerate(itens, 1):
        if indices[item['group']] % 2:
            comandos.append(('BACKGROUND', (0, n), (-1, n), colors.HexColor('#F1F5F6')))
        comandos.append(('LINEBELOW', (0, n), (-1, n), .35, LINE))
    tabela.setStyle(TableStyle(comandos))
    historia += [tabela, Spacer(1, 9), p('<b>Atenção:</b> linhas com o mesmo número pertencem ao mesmo pacote. '
                 'Quantidade é a unidade vendida: um kit conta como 1 unidade, não como suas peças internas.', pequeno),
                 Spacer(1, 9), p('Separado e embalado por: ______________________ &nbsp; Despachado por: ______________________ &nbsp; Hora: ________')]

    def rodape(canvas, doc):
        canvas.setStrokeColor(LINE)
        canvas.line(LADO, RODAPE + 4 * mm, A4[0] - LADO, RODAPE + 4 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont(normal, 7)
        canvas.drawString(LADO, RODAPE, f'Gerado em {agora:%d/%m/%Y %H:%M}. Dados das planilhas; confira a etiqueta física.')
        canvas.drawRightString(A4[0] - LADO, RODAPE, f'Página {doc.page}')

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=LADO, leftMargin=LADO,
                            topMargin=TOPO, bottomMargin=BASE, title='Checklist de separação', author='')
    doc.build(historia, onFirstPage=rodape, onLaterPages=rodape)
    return buffer.getvalue()
