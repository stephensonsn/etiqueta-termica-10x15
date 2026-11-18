#!/bin/bash
# Baixa o Node.js oficial (nodejs.org) para a arquitetura deste Mac e grava em <destino>/node.
# Confere a soma SHA-256 publicada pelo próprio Node.js antes de usar. Idempotente: se o Node
# certo já estiver lá, não baixa de novo. Nova tentativa com espera crescente em cada download.
# Uso: bash baixar-node.sh <pasta-destino>      (sai 0 e imprime o caminho do node; sai 1 se falhar)
set -euo pipefail
NODE_V="v22.21.1"
DEST="${1:?informe a pasta de destino}"
ARQ="$(uname -m)"; [ "$ARQ" = "arm64" ] || ARQ="x64"
mkdir -p "$DEST"
if [ -x "$DEST/node" ] && [ "$("$DEST/node" --version 2>/dev/null)" = "$NODE_V" ]; then echo "$DEST/node"; exit 0; fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
baixar() { # $1 = url, $2 = destino
  for t in 1 2 3 4; do
    curl -fsSL --max-time 300 -o "$2" "$1" && return 0
    echo "  falha ao baixar $1 (tentativa $t de 4)" >&2; sleep $((t * 5))
  done
  return 1
}
ARQUIVO="node-$NODE_V-darwin-$ARQ.tar.gz"
echo "  baixando o Node.js $NODE_V ($ARQ) do site oficial..." >&2
baixar "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt" "$TMP/SHASUMS256.txt" || { echo "  não deu para baixar a lista de somas do Node.js" >&2; exit 1; }
baixar "https://nodejs.org/dist/$NODE_V/$ARQUIVO" "$TMP/$ARQUIVO" || { echo "  não deu para baixar o Node.js (sem internet?)" >&2; exit 1; }
ESPERADO="$(grep " $ARQUIVO\$" "$TMP/SHASUMS256.txt" | cut -d' ' -f1)"
OBTIDO="$(shasum -a 256 "$TMP/$ARQUIVO" | cut -d' ' -f1)"
[ -n "$ESPERADO" ] && [ "$ESPERADO" = "$OBTIDO" ] || { echo "  a soma do Node.js não confere: arquivo recusado" >&2; exit 1; }
tar -xzf "$TMP/$ARQUIVO" -C "$TMP" "node-$NODE_V-darwin-$ARQ/bin/node"
mv "$TMP/node-$NODE_V-darwin-$ARQ/bin/node" "$DEST/node"
chmod +x "$DEST/node"
echo "$DEST/node"
