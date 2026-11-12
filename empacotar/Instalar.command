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
[ -x "$AQUI/runtime/$ARQ/node" ] && ok "Node.js já vem no instalador (não precisa instalar)" || falta "Node.js do instalador não encontrado: baixe o instalador de novo"
if lipo -archs "$AQUI/app/conector-bluetooth/conector-bluetooth" 2>/dev/null | grep -qw "$(uname -m)"; then ok "Conector Bluetooth pronto para este Mac"
elif command -v swiftc >/dev/null 2>&1; then ok "Conector Bluetooth será compilado agora"
else falta "Bluetooth sem navegador indisponível neste Mac: use o cabo, ou o Bluetooth pelo Google Chrome (o painel explica)"; fi
[ -d "/Applications/Google Chrome.app" ] && ok "Google Chrome instalado (usado para escolher a impressora Bluetooth)" || falta "Google Chrome não encontrado: só é preciso para Bluetooth. Baixe em https://www.google.com/chrome"
lpstat -r >/dev/null 2>&1 && ok "Sistema de impressão do macOS ativo" || falta "Sistema de impressão do macOS parado: reinicie o computador"
if lpstat -v 2>/dev/null | grep -q "usb://"; then ok "Driver de impressora USB já instalado: o assistente vai reconhecer e só ligar a impressão direta"
else ok "Sem driver de impressora USB instalado: não precisa, a instalação funciona sem ele"; fi
[ "$FALTAS" -eq 0 ] && echo "Tudo certo para instalar." || echo "$FALTAS item(ns) acima pedem atenção; a instalação continua com o que está disponível."
echo
echo "Instalando em: $DEST"
mkdir -p "$DEST"
# atualiza o programa sem apagar a sua configuração
rsync -a --delete --exclude config.json --exclude logs --exclude recebidos --exclude previa --exclude runtime "$AQUI/app/" "$DEST/"
ARQ="$(uname -m)"; [ "$ARQ" = "arm64" ] || ARQ="x64"
mkdir -p "$DEST/runtime"
cp -p "$AQUI/runtime/$ARQ/node" "$DEST/runtime/node"
# o macOS marca o que vem da internet; sem tirar a marca os serviços não sobem
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
# conector Bluetooth pronto só serve se for da arquitetura deste Mac; senão o instalador tenta compilar
lipo -archs "$DEST/conector-bluetooth/conector-bluetooth" 2>/dev/null | grep -qw "$(uname -m)" || rm -f "$DEST/conector-bluetooth/conector-bluetooth"
chmod +x "$DEST/instalar.sh" "$DEST/runtime/node" "$DEST/conector-bluetooth/conector-bluetooth" 2>/dev/null || true
NODE="$DEST/runtime/node" bash "$DEST/instalar.sh"
echo
echo "Pronto. O painel abre no navegador: escolha a conexão e imprima a etiqueta de teste."
echo "Pode fechar esta janela."
