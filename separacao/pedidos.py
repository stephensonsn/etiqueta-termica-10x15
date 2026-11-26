"""Importação local via Docling e normalização dos dois relatórios de vendas."""
from collections import Counter
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
import zipfile
from zoneinfo import ZoneInfo


class ErroImportacao(ValueError):
    pass


def normalizar(value):
    text = unicodedata.normalize('NFKD', str(value or ''))
    return ' '.join(''.join(c for c in text if not unicodedata.combining(c)).lower().split())


MESES = {m: n for n, m in enumerate(['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
                                       'setembro', 'outubro', 'novembro', 'dezembro'], 1)}
SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo']


def hoje():
    return datetime.now(ZoneInfo('America/Sao_Paulo')).date()


def data_relatorio(documento):
    # O Mercado Livre escreve no topo: "Status das suas vendas em 25 de novembro de 2026, às 09:33 hs."
    textos = [t.get('text', '') for t in documento.get('texts', [])]
    for grade in grades(documento):
        for linha in grade[:10]:
            textos.extend(linha)
    for texto in textos:
        achou = re.search(r'status das suas vendas em (\d{1,2}) de ([a-z]+) de (\d{4})', normalizar(texto))
        if achou and achou[2] in MESES:
            return date(int(achou[3]), MESES[achou[2]], int(achou[1]))
    return None


def prazo_despacho(texto, base):
    """Lê o prazo de despacho escrito pelo Mercado Livre. Devolve (data ISO ou '', atrasado)."""
    t = normalizar(texto)
    if not t or not base:
        return '', False
    if re.search(r'atras|venceu|expirou', t) and not re.search(r'para nao ter atras|evitar atras', t):
        return base.isoformat(), True
    if re.search(r'\bhoje\b', t):
        return base.isoformat(), False
    if re.search(r'\bamanha\b', t):
        return (base + timedelta(days=1)).isoformat(), False
    def ajustar(dia, mes):
        alvo = date(base.year, mes, dia)
        return date(base.year + 1, mes, dia) if alvo < base - timedelta(days=60) else alvo
    achou = re.search(r'\b(\d{1,2}) de (' + '|'.join(MESES) + r')\b', t)
    if achou:
        return ajustar(int(achou[1]), MESES[achou[2]]).isoformat(), False
    abrev = {m[:3]: n for m, n in MESES.items()}
    achou = re.search(r'\b(\d{1,2})/(\d{1,2}|' + '|'.join(abrev) + r')\b', t)
    if achou:
        mes = int(achou[2]) if achou[2].isdigit() else abrev[achou[2]]
        if 1 <= mes <= 12:
            return ajustar(int(achou[1]), mes).isoformat(), False
    achou = re.search(r'\b(' + '|'.join(SEMANA) + r')\b', t)
    if achou:
        return (base + timedelta(days=(SEMANA.index(achou[1]) - base.weekday()) % 7)).isoformat(), False
    return '', False


def grades(documento):
    for tabela in documento.get('tables', []):
        dados = tabela['data']
        if dados['num_rows'] * dados['num_cols'] > 2_000_000:
            raise ErroImportacao('Planilha muito grande. Exporte um lote menor de pedidos.')
        grade = [[''] * dados['num_cols'] for _ in range(dados['num_rows'])]
        for celula in dados['table_cells']:
            grade[celula['start_row_offset_idx']][celula['start_col_offset_idx']] = celula['text'].strip()
        yield grade


@lru_cache(maxsize=1)
def comando_docling():
    caminhos = [os.environ.get('DOCLING_CLI'),
                str(Path.home() / 'DEV/01-Tools/docling/.venv-imep/bin/docling'),
                shutil.which('docling')]
    for caminho in caminhos:
        if caminho and Path(caminho).is_file():
            ajuda = subprocess.run([caminho, '--help'], capture_output=True, text=True, timeout=30)
            # Compatível com o CLI novo (convert) e o CLI antigo.
            return [caminho, 'convert'] if 'convert-remote' in ajuda.stdout else [caminho]
    raise ErroImportacao('Docling não encontrado. Configure DOCLING_CLI com o caminho do executável local.')


def extrair_xlsx(conteudo):
    if len(conteudo) > 12 * 1024 * 1024:
        raise ErroImportacao('Cada planilha pode ter no máximo 12 MB.')
    with tempfile.TemporaryDirectory(prefix='separacao-docling-') as pasta:
        entrada = Path(pasta) / 'entrada.xlsx'
        entrada.write_bytes(conteudo)
        try:
            with zipfile.ZipFile(entrada) as arquivo:
                if '[Content_Types].xml' not in arquivo.namelist():
                    raise ErroImportacao('O arquivo não é uma planilha XLSX válida.')
                if sum(z.file_size for z in arquivo.infolist()) > 120 * 1024 * 1024:
                    raise ErroImportacao('Planilha expandida muito grande. Exporte um lote menor.')
        except zipfile.BadZipFile as exc:
            raise ErroImportacao('XLSX inválido ou corrompido. Exporte novamente a planilha.') from exc
        saida = Path(pasta) / 'extraido'
        resultado = subprocess.run(
            comando_docling() + [str(entrada), '--to', 'json', '--to', 'md', '--output', str(saida)],
            capture_output=True, text=True, timeout=180,
        )
        caminho = saida / 'entrada.json'
        if resultado.returncode or not caminho.exists():
            raise ErroImportacao('O Docling não conseguiu ler a planilha. Verifique se o XLSX abre normalmente e não tem senha.')
        return json.loads(caminho.read_text())


def quantidade(valor):
    try:
        numero = Decimal(valor.replace(',', '.'))
        if not numero.is_finite() or numero <= 0 or numero != int(numero):
            raise InvalidOperation
        return int(numero)
    except (InvalidOperation, ValueError):
        raise ErroImportacao(f'Quantidade inválida: {valor!r}. Nenhum item deste arquivo foi importado.')


def chave_item(item):
    # Identidade comercial; não usa arquivo/linha, para reconhecer reimportações.
    return (item['channel'], item['order'], item['package'],
            item['product_id'] or item['sku'] or item['title'], item['variation'])


def chave_pacote(item):
    return item['channel'] + ':' + (item['code'] or item['package'] or item['order'])


def completar(item):
    item['id'] = hashlib.sha256(json.dumps(chave_item(item), ensure_ascii=False).encode()).hexdigest()[:24]
    item['group'] = chave_pacote(item)
    return item


def importar_documento(documento, origem):
    itens, avisos = [], []
    reconhecidas = 0
    base_ml = data_relatorio(documento)
    for grade in grades(documento):
        for inicio, cabecalho in enumerate(grade[:25]):
            if 'N.º de venda' in cabecalho and 'Título do anúncio' in cabecalho:
                canal = 'Mercado Livre'
                break
            if 'Order ID' in cabecalho and 'Product Name' in cabecalho:
                canal = 'TikTok Shop'
                break
        else:
            continue
        reconhecidas += 1
        indices = {}
        for n, nome in enumerate(cabecalho):
            indices.setdefault(nome, n)  # Primeiro campo de Unidades/Estado = venda, não devolução/UF.
        com_prazo = canal == 'TikTok Shop' or 'Descrição do status' in indices
        if not com_prazo:
            avisos.append('Mercado Livre: relatório sem a coluna "Descrição do status"; os prazos de despacho '
                          'não foram lidos e nenhum pacote entra marcado como do dia.')
        elif canal == 'Mercado Livre' and not base_ml:
            avisos.append('Mercado Livre: data do relatório não encontrada; "hoje" foi contado como a data de hoje.')
        obrigatorias = (['N.º de venda', 'Título do anúncio', 'Unidades', 'Estado'] if canal == 'Mercado Livre'
                        else ['Order ID', 'Product Name', 'Quantity', 'Order Status'])
        faltam = [c for c in obrigatorias if c not in indices]
        if faltam:
            raise ErroImportacao('Colunas ausentes: ' + ', '.join(faltam))
        pacote = None

        def finalizar_pacote():
            if pacote and pacote['count'] != pacote['expected']:
                raise ErroImportacao(f"Pacote {pacote['order']}: esperado(s) {pacote['expected']} produto(s), "
                                     f"mas foram encontradas {pacote['count']} linhas. Reexporte o relatório completo.")

        for numero_linha, linha in enumerate(grade[inicio + 1:], inicio + 2):
            def obter(nome):
                return linha[indices[nome]].strip() if nome in indices else ''
            if not any(v.strip() for v in linha):
                continue
            if linha == cabecalho:
                continue
            if canal == 'Mercado Livre':
                titulo, pedido, estado = obter('Título do anúncio'), obter('N.º de venda'), obter('Estado')
                resumo = re.fullmatch(r'Pacote de (\d+) produtos?', estado, re.I)
                if not titulo and resumo:
                    finalizar_pacote()
                    pacote = {'order': pedido, 'buyer': obter('Comprador'), 'code': obter('Identificador do envio'),
                              'tracking': obter('Número de rastreamento'), 'expected': int(resumo[1]), 'count': 0}
                    continue
                if not titulo or not pedido.isdigit():
                    raise ErroImportacao(f'{origem}: linha de venda não reconhecida ({numero_linha}).')
                codigo, rastreio, comprador = obter('Identificador do envio'), obter('Número de rastreamento'), obter('Comprador')
                herdar = bool(pacote and not codigo and not rastreio and obter('Pacote de diversos produtos') == 'Sim')
                if herdar:
                    pacote['count'] += 1
                    codigo, rastreio, comprador = pacote['code'], pacote['tracking'], pacote['buyer']
                else:
                    finalizar_pacote()
                    pacote = None
                item = dict(channel=canal, order=pedido, package=pacote['order'] if herdar else '',
                            buyer=comprador, code=codigo or rastreio, tracking=rastreio, title=titulo,
                            sku=obter('SKU'), product_id=obter('# de anúncio'), variation=obter('Variação'),
                            quantity=quantidade(obter('Unidades')), status=estado)
                item['ship_text'] = obter('Descrição do status')
                item['ship_date'], item['ship_late'] = prazo_despacho(item['ship_text'], base_ml or hoje())
            else:
                pedido = obter('Order ID')
                if pedido == 'Platform unique order ID.':
                    continue  # Linha de explicações do TikTok.
                if not pedido.isdigit() or not obter('Product Name'):
                    raise ErroImportacao(f'{origem}: pedido inválido na linha {numero_linha}. Preserve os IDs como texto.')
                item = dict(channel=canal, order=pedido, package=obter('Package ID'),
                            buyer=obter('Recipient') or obter('Buyer Username'), code=obter('Tracking ID'),
                            tracking=obter('Tracking ID'), title=obter('Product Name'),
                            sku=obter('Seller SKU'), product_id=obter('SKU ID'), variation=obter('Variation'),
                            quantity=quantidade(obter('Quantity')), status=obter('Order Status'))
                # O relatório do TikTok não traz prazo: pedido "A ser enviado" sai no dia.
                item.update(ship_text='TikTok: a planilha não traz prazo; pedido a ser enviado conta como do dia',
                            ship_date=hoje().isoformat(), ship_late=False)
            estado_normal = normalizar(item['status'])
            # Exclui status não elegíveis com aviso, nunca como um envio pronto.
            prontos = ['etiqueta impressa', 'pronto para enviar', 'pronto para envio', 'pronto para imprimir',
                       'etiqueta pronta', 'a ser enviado', 'para enviar', 'aguardando coleta', 'awaiting shipment']
            if estado_normal not in prontos:
                avisos.append(f"{canal}: pedido {item['order']} não incluído (status: {item['status'] or 'ausente'}).")
                continue
            item['source'] = origem
            if not item['code']:
                avisos.append(f"{canal}: pedido {item['order']} sem código de envio/rastreio. Confira manualmente.")
            if canal == 'Mercado Livre' and com_prazo and not item['ship_date']:
                avisos.append(f"Mercado Livre: pedido {item['order']} sem prazo de despacho reconhecido "
                              f"({item['ship_text'] or 'descrição vazia'}). Confira se é para hoje.")
            itens.append(completar(item))
        finalizar_pacote()
    if not reconhecidas:
        raise ErroImportacao('Formato não reconhecido. Use o relatório de vendas do Mercado Livre ou de pedidos do TikTok Shop em XLSX.')
    return itens, avisos


def mesclar(atuais, novos):
    resultado = {i['id']: dict(i) for i in atuais}  # cópia: erro no meio não altera o lote atual
    duplicados = 0
    for item in novos:
        anterior = resultado.get(item['id'])
        if anterior:
            # O prazo muda de relatório para relatório ("amanhã" vira "hoje"): não conta como divergência.
            variaveis = {'source', 'ship_text', 'ship_date', 'ship_late'}
            comparar = lambda x: {k: v for k, v in x.items() if k not in variaveis}
            if comparar(anterior) != comparar(item):
                raise ErroImportacao(f"Dados divergentes para o pedido {item['order']}. Inicie um novo lote e importe somente o relatório atualizado.")
            for k in variaveis - {'source'}:
                if k in item:
                    anterior[k] = item[k]
            duplicados += 1
        else:
            resultado[item['id']] = item
    return list(resultado.values()), duplicados


def selecionar_codigo(itens, texto):
    # Igualdade exata. Não tenta deduzir pelo nome, por parte de um ID ou pelo CEP.
    texto = texto.strip()
    if texto.startswith('LA,'):
        texto = texto[3:]
    if texto.startswith('{'):
        try:
            texto = str(json.loads(texto)['id'])
        except (ValueError, KeyError, TypeError):
            raise ErroImportacao('QR inválido. Digite o código de envio ou rastreio completo.')
    encontrados = [i for i in itens if texto and texto.upper() in
                   {str(i[k]).upper() for k in ['code', 'tracking', 'order', 'package']}]
    grupos = {i['group'] for i in encontrados}
    if not grupos:
        raise ErroImportacao('Código não encontrado nas planilhas importadas. Confira o número completo.')
    if len(grupos) > 1:
        raise ErroImportacao('O código identifica mais de um pacote. Use o envio/rastreio específico e confira a plataforma.')
    return [i['id'] for i in itens if i['group'] in grupos]


def pacotes_parciais(todos, escolhidos):
    total = Counter(i['group'] for i in todos)
    parcial = Counter(i['group'] for i in escolhidos)
    return [g for g, n in parcial.items() if n < total[g]]
