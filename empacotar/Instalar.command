#!/bin/bash
# Instalador da Etiqueta Térmica 10x15 para macOS. Dê dois cliques.
# Copia o programa para a sua pasta de usuário e liga os serviços (não pede senha de administrador).
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
DEST="${DEST:-$HOME/Library/Application Support/EtiquetaTermica}"
# ---------- checagem do computador: o que tem, o que falta e como resolver ----------
ok()    { echo "  [ok]    $*"; }
falta() { echo "  [falta] $*"; FALTAS=$((FALTAS + 1)); }
FALTAS=0
echo "Checando este computador..."
VER="$(sw_vers -productVersion 2>/dev/null || echo 0)"
[ "${VER%%.*}" -ge 12 ] 2>/dev/null && ok "macOS $VER" || falta "macOS $VER é antigo: este instalador precisa do macOS 12 ou mais novo"
ARQ="$(uname -m)"; [ "$ARQ" = "arm64" ] || ARQ="x64"
if [ -x "$AQUI/runtime/$ARQ/node" ]; then ok "Node.js já vem no instalador"
elif curl -fsI --max-time 15 https://nodejs.org/dist/ >/dev/null 2>&1; then ok "Node.js será baixado do site oficial durante a instalação (conferido pela soma SHA-256)"
else falta "Sem internet para baixar o Node.js: conecte e rode o instalador de novo"; fi
if lipo -archs "$AQUI/app/conector-bluetooth/conector-bluetooth" 2>/dev/null | grep -qw "$(uname -m)"; then ok "Conector Bluetooth pronto para este Mac"
elif command -v swiftc >/dev/null 2>&1; then ok "Conector Bluetooth será compilado agora"
else falta "Bluetooth sem navegador indisponível neste Mac: use o cabo, ou o Bluetooth pelo Google Chrome (o painel explica)"; fi
[ -d "/Applications/Google Chrome.app" ] && ok "Google Chrome instalado (usado para escolher a impressora Bluetooth)" || falta "Google Chrome não encontrado: só é preciso para Bluetooth. Baixe em https://www.google.com/chrome"
lpstat -r >/dev/null 2>&1 && ok "Sistema de impressão do macOS ativo" || falta "Sistema de impressão do macOS parado: reinicie o computador"
if [ -e /Library/Printers/LabelPOS/rastertodlabel ] || ls /Library/Printers/PPDs/Contents/Resources/Label_TSPL* >/dev/null 2>&1; then
  ok "Driver do fabricante instalado: o assistente reconhece e só liga a impressão direta"
else
  ok "Driver do fabricante não instalado: as etiquetas do Mercado Livre e da Shopee imprimem sem ele"
  echo "          (opcional, para imprimir de outros programas: o painel tem o botão Baixar e instalar,"
  echo "           ou rode: bash \"\$HOME/Library/Application Support/EtiquetaTermica/driver-mac/baixar-driver-fabricante.sh\")"
fi
[ "$FALTAS" -eq 0 ] && echo "Tudo certo para instalar." || echo "$FALTAS item(ns) acima pedem atenção; a instalação continua com o que está disponível."
echo
echo "Instalando em: $DEST"
mkdir -p "$DEST"
# atualiza o programa sem apagar a sua configuração
rsync -a --delete --exclude config.json --exclude logs --exclude recebidos --exclude previa --exclude runtime "$AQUI/app/" "$DEST/"
ARQ="$(uname -m)"; [ "$ARQ" = "arm64" ] || ARQ="x64"
mkdir -p "$DEST/runtime"
if [ -x "$AQUI/runtime/$ARQ/node" ]; then cp -p "$AQUI/runtime/$ARQ/node" "$DEST/runtime/node"
else bash "$DEST/baixar-node.sh" "$DEST/runtime" >/dev/null || { echo "Não deu para baixar o Node.js. Confira a internet e rode o instalador de novo."; exit 1; }; fi
# o macOS marca o que vem da internet; sem tirar a marca os serviços não sobem
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
# conector Bluetooth pronto só serve se for da arquitetura deste Mac; senão o instalador tenta compilar
lipo -archs "$DEST/conector-bluetooth/conector-bluetooth" 2>/dev/null | grep -qw "$(uname -m)" || rm -f "$DEST/conector-bluetooth/conector-bluetooth"
chmod +x "$DEST/instalar.sh" "$DEST/runtime/node" "$DEST/conector-bluetooth/conector-bluetooth" 2>/dev/null || true
NODE="$DEST/runtime/node" bash "$DEST/instalar.sh"
echo
echo "Pronto. O painel abre no navegador: escolha a conexão e imprima a etiqueta de teste."
echo "Pode fechar esta janela."
