#!/bin/bash
# Monta o instalador do macOS (.dmg) com tudo dentro: programa, dependências, Node.js oficial
# (Apple Silicon e Intel) e o conector Bluetooth já compilado para os dois.
# Uso: ./empacotar-mac.sh        Saída: dist/EtiquetaTermica-<versão>.dmg
# Idempotente: reaproveita o que já foi baixado em build/cache.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")" && pwd)"
VERSAO="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$RAIZ/package.json" | head -1)"
NODE_V="v22.21.1"
CACHE="$RAIZ/build/cache"; PALCO="$RAIZ/build/dmg/Etiqueta Termica 10x15"
REG="$RAIZ/build/empacotar.log"
mkdir -p "$CACHE" "$RAIZ/dist"; : > "$REG"
passo() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$REG"; }

baixar() { # $1 = url, $2 = destino; até 4 tentativas com espera crescente e tempo máximo por tentativa
  [ -s "$2" ] && return 0
  for t in 1 2 3 4; do
    curl -fL --max-time 300 -o "$2.parcial" "$1" >>"$REG" 2>&1 && mv "$2.parcial" "$2" && return 0
    passo "falha ao baixar $1 (tentativa $t)"; sleep $((t * 3))
  done
  return 1
}

passo "Node.js $NODE_V oficial para arm64 e x64"
baixar "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt" "$CACHE/SHASUMS256-$NODE_V.txt"
for a in arm64 x64; do
  arq="node-$NODE_V-darwin-$a.tar.gz"
  baixar "https://nodejs.org/dist/$NODE_V/$arq" "$CACHE/$arq"
  esperado="$(grep " $arq\$" "$CACHE/SHASUMS256-$NODE_V.txt" | cut -d' ' -f1)"
  obtido="$(shasum -a 256 "$CACHE/$arq" | cut -d' ' -f1)"
  [ -n "$esperado" ] && [ "$esperado" = "$obtido" ] || { passo "ERRO: soma de verificação não confere para $arq"; rm -f "$CACHE/$arq"; exit 1; }
done

passo "montando a pasta do instalador"
rm -rf "$RAIZ/build/dmg"; mkdir -p "$PALCO/app" "$PALCO/runtime/arm64" "$PALCO/runtime/x64"
for a in arm64 x64; do
  tar -xzf "$CACHE/node-$NODE_V-darwin-$a.tar.gz" -C "$CACHE" "node-$NODE_V-darwin-$a/bin/node" "node-$NODE_V-darwin-$a/LICENSE"
  cp -p "$CACHE/node-$NODE_V-darwin-$a/bin/node" "$PALCO/runtime/$a/node"
done
cp -p "$CACHE/node-$NODE_V-darwin-arm64/LICENSE" "$PALCO/runtime/LICENCA-NODE.txt"
( cd "$RAIZ" && git ls-files -z | grep -zv -E '^(empacotar|docs|teste)/|^empacotar-mac\.sh$|^\.gitignore$' | xargs -0 -I{} rsync -R {} "$PALCO/app/" )
( cd "$PALCO/app" && "$(command -v npm)" ci --omit=dev --no-audit --no-fund >>"$REG" 2>&1 )

passo "conector Bluetooth universal (Apple Silicon + Intel)"
BT="$PALCO/app/conector-bluetooth"
compilar() { # $1 = arquitetura
  swiftc -swift-version 5 -O -target "$1-apple-macos14" "$BT/main.swift" -o "$RAIZ/build/conector-$1" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$BT/Info.plist" >>"$REG" 2>&1
}
compilar arm64
if compilar x86_64; then
  lipo -create "$RAIZ/build/conector-arm64" "$RAIZ/build/conector-x86_64" -output "$BT/conector-bluetooth"
else
  # este compilador não gera Intel: em Mac Intel o instalador compila na hora, se houver swiftc, ou usa o Chrome
  passo "aviso: conector Bluetooth só para Apple Silicon (o compilador local não gerou a versão Intel)"
  cp "$RAIZ/build/conector-arm64" "$BT/conector-bluetooth"
fi
codesign --force --sign - "$BT/conector-bluetooth" >>"$REG" 2>&1
touch "$BT/conector-bluetooth" # mais novo que o fonte: o instalador não tenta recompilar

cp "$RAIZ/empacotar/Instalar.command" "$RAIZ/empacotar/Desinstalar.command" "$RAIZ/empacotar/LEIA-ME.txt" "$PALCO/"
chmod +x "$PALCO/Instalar.command" "$PALCO/Desinstalar.command" "$PALCO/app/instalar.sh"

SAIDA="$RAIZ/dist/EtiquetaTermica-$VERSAO.dmg"
rm -f "$SAIDA"
passo "gerando $SAIDA"
hdiutil create -volname "Etiqueta Termica 10x15" -srcfolder "$RAIZ/build/dmg" -ov -format UDZO "$SAIDA" >>"$REG" 2>&1
passo "pronto: $(du -h "$SAIDA" | cut -f1) em $SAIDA"
