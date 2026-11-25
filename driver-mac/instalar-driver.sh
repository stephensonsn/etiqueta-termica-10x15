#!/bin/bash
# Instala o driver de sistema: a impressora passa a aparecer no "Imprimir" de qualquer programa.
# Precisa de senha de administrador, porque grava em /Library/Printers.
# Uso:   sudo ./driver-mac/instalar-driver.sh           (instala)
#        sudo ./driver-mac/instalar-driver.sh remover   (desfaz tudo)
# Idempotente: pode rodar de novo; guarda cópia do que substituir e desfaz se a conferência falhar.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
FILA="Etiqueta_Termica"
DIR="/Library/Printers/EtiquetaTermica"
PPD="/Library/Printers/PPDs/Contents/Resources/EtiquetaTermica-TSPL.ppd"
REG="/tmp/etiqueta-termica-driver.log"
passo() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$REG"; }
[ "$(id -u)" -eq 0 ] || { echo "Rode com sudo: sudo $0" >&2; exit 1; }

remover() {
  lpadmin -x "$FILA" 2>/dev/null || true
  rm -rf "$DIR"; rm -f "$PPD"
  passo "driver removido"
}
if [ "${1:-}" = "remover" ]; then remover; exit 0; fi

# backup do que já está instalado: se a conferência falhar, volta exatamente como estava
# (antes, a falha removia a impressora que funcionava; 25/11/2026)
BKP="$(mktemp -d /tmp/etiqueta-driver-backup.XXXXXX)"
TINHA_FILA=0
if lpstat -p "$FILA" >/dev/null 2>&1 && [ -f "/etc/cups/ppd/$FILA.ppd" ]; then
  TINHA_FILA=1; cp "/etc/cups/ppd/$FILA.ppd" "$BKP/fila.ppd"
  lpoptions -p "$FILA" 2>/dev/null | grep -o "device-uri=[^ ]*" | cut -d= -f2- > "$BKP/uri" || true
fi
[ -d "$DIR" ] && cp -R "$DIR" "$BKP/dir"
[ -f "$PPD" ] && cp "$PPD" "$BKP/modelo.ppd"
passo "backup do driver atual em $BKP"
desfazer() {
  passo "desfazendo: voltando o driver anterior"
  lpadmin -x "$FILA" 2>/dev/null || true
  rm -rf "$DIR"; rm -f "$PPD"
  [ -d "$BKP/dir" ] && cp -R "$BKP/dir" "$DIR"
  [ -f "$BKP/modelo.ppd" ] && cp "$BKP/modelo.ppd" "$PPD"
  if [ "$TINHA_FILA" = 1 ]; then
    lpadmin -p "$FILA" -E -v "$(cat "$BKP/uri" 2>/dev/null || echo socket://127.0.0.1:9102)" -P "$BKP/fila.ppd" -D "Etiqueta Termica 10x15" -o printer-error-policy=abort-job -o fit-to-page-default=true 2>>"$REG" \
      && passo "impressora anterior restaurada" || passo "ERRO: não deu para restaurar a impressora anterior; cópia em $BKP"
  fi
}

passo "copiando o filtro e o modelo"
[ -x "$AQUI/rastertotspl" ] || clang -O2 -Wno-deprecated-declarations "$AQUI/rastertotspl.c" -o "$AQUI/rastertotspl" -lcups
mkdir -p "$DIR" "$(dirname "$PPD")"
install -o root -g wheel -m 755 "$AQUI/rastertotspl" "$DIR/rastertotspl"
# ZPL aberto e mandado imprimir sai como etiqueta: filtro de PDF/texto + leitor de PDF (Swift/PDFKit).
# Sem o compilador Swift, o texto puro já funciona; o PDF segue como antes (sai a página desenhada).
[ -x "$AQUI/zpldopdf" ] || swiftc -O "$AQUI/zpldopdf.swift" -o "$AQUI/zpldopdf" 2>>"$REG" || passo "aviso: sem o Swift; ZPL dentro de PDF não será reconhecido"
install -o root -g wheel -m 755 "$AQUI/etiquetatexto" "$DIR/etiquetatexto"
[ -x "$AQUI/zpldopdf" ] && install -o root -g wheel -m 755 "$AQUI/zpldopdf" "$DIR/zpldopdf"
install -o root -g wheel -m 644 "$AQUI/EtiquetaTermica-TSPL.ppd" "$PPD"

passo "criando a impressora $FILA"
lpadmin -p "$FILA" -E -v "socket://127.0.0.1:9102" -P "$PPD" -D "Etiqueta Termica 10x15" -o PageSize=w283h425 -o printer-error-policy=abort-job -o fit-to-page-default=true 2>>"$REG" || { passo "ERRO ao criar a impressora"; desfazer; exit 1; }

# conferência: a fila existe e aceita trabalhos, e o filtro separa ZPL de documento comum
CONF="$(mktemp -d)"
printf '^XA^FO50,50^A0N,40,40^FDteste^FS^XZ\n' > "$CONF/zpl.txt"; printf 'documento comum\n' > "$CONF/comum.txt"
FILTRO_OK=1
cupsfilter -e -p "$PPD" -m printer/Etiqueta_Termica "$CONF/zpl.txt" 2>/dev/null | head -c 20 | grep -q 'ETIQUETA-ZPL' || FILTRO_OK=0
cupsfilter -e -p "$PPD" -m printer/Etiqueta_Termica "$CONF/comum.txt" 2>/dev/null | grep -aq 'SIZE ' || FILTRO_OK=0
rm -rf "$CONF"
[ "$FILTRO_OK" = 1 ] || { passo "ERRO: o filtro não separou ZPL de documento comum"; desfazer; exit 1; }
if lpstat -p "$FILA" >/dev/null 2>&1 && lpstat -a "$FILA" >/dev/null 2>&1; then
  passo "pronto: a impressora \"Etiqueta Termica 10x15\" aparece no Imprimir de qualquer programa"
  passo "ela envia pela conexão escolhida no painel (http://127.0.0.1:9100/painel)"
else
  passo "ERRO: a impressora não ficou disponível"; desfazer; exit 1
fi
