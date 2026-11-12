#!/bin/bash
# Remove a Etiqueta Térmica 10x15 deste usuário: para os serviços e apaga a pasta do programa.
set -uo pipefail
ROTULO="${ROTULO:-br.local.etiqueta-ml}"
DEST="${DEST:-$HOME/Library/Application Support/EtiquetaTermica}"
for r in "$ROTULO" "$ROTULO.bluetooth"; do
  launchctl bootout "gui/$(id -u)/$r" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$r.plist"
done
case "$DEST" in *EtiquetaTermica*) rm -rf "$DEST";; esac
echo "Removido. A fila de impressão do macOS (se foi criada) continua em Ajustes do Sistema, Impressoras."
