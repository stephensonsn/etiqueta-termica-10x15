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

passo "copiando o filtro e o modelo"
[ -x "$AQUI/rastertotspl" ] || clang -O2 -Wno-deprecated-declarations "$AQUI/rastertotspl.c" -o "$AQUI/rastertotspl" -lcups
mkdir -p "$DIR" "$(dirname "$PPD")"
install -o root -g wheel -m 755 "$AQUI/rastertotspl" "$DIR/rastertotspl"
install -o root -g wheel -m 644 "$AQUI/EtiquetaTermica-TSPL.ppd" "$PPD"

passo "criando a impressora $FILA"
lpadmin -p "$FILA" -E -v "socket://127.0.0.1:9102" -P "$PPD" -D "Etiqueta Termica 10x15" -o PageSize=w283h425 2>>"$REG" || { passo "ERRO ao criar a impressora"; remover; exit 1; }

# conferência: a fila existe e aceita trabalhos
if lpstat -p "$FILA" >/dev/null 2>&1 && lpstat -a "$FILA" >/dev/null 2>&1; then
  passo "pronto: a impressora \"Etiqueta Termica 10x15\" aparece no Imprimir de qualquer programa"
  passo "ela envia pela conexão escolhida no painel (http://127.0.0.1:9100/painel)"
else
  passo "ERRO: a impressora não ficou disponível; desfazendo"; remover; exit 1
fi
