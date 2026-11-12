#!/bin/bash
# Instala (ou reinstala) a ponte como serviço do usuário: sobe no login e volta sozinha se cair.
# Idempotente: pode rodar de novo a qualquer momento.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")" && pwd)"
NODE="${NODE:-$(command -v node || true)}"
[ -x "$NODE" ] || { echo "Node.js nao encontrado. Instale em https://nodejs.org e rode de novo." >&2; exit 1; }
ROTULO="${ROTULO:-br.local.etiqueta-ml}"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
# (re)instala um serviço do usuário; espera o anterior sair de verdade antes de subir o novo
subir() { # $1 = rótulo, $2 = plist
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1 || break; sleep 0.5; done
  for i in 1 2 3; do launchctl bootstrap "gui/$(id -u)" "$2" 2>/dev/null && return 0; sleep "$i"; done
  echo "nao consegui subir o servico $1" >&2; return 1
}
mkdir -p "$RAIZ/logs" "$HOME/Library/LaunchAgents"
[ -f "$RAIZ/config.json" ] || cp "$RAIZ/config.exemplo.json" "$RAIZ/config.json"
PORTA="$(sed -n 's/.*"porta": *\([0-9]*\).*/\1/p' "$RAIZ/config.json" | head -1)"; PORTA="${PORTA:-9100}"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ROTULO</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$RAIZ/src/servidor.js</string></array>
  <key>WorkingDirectory</key><string>$RAIZ</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$RAIZ/logs/servico.log</string>
  <key>StandardErrorPath</key><string>$RAIZ/logs/servico.log</string>
</dict></plist>
PL
subir "$ROTULO" "$PLIST"
# conector Bluetooth nativo (opcional: precisa do compilador Swift das Ferramentas de Linha de Comando)
BT="$RAIZ/conector-bluetooth"
if [ ! -x "$BT/conector-bluetooth" ] || { [ "$BT/main.swift" -nt "$BT/conector-bluetooth" ] && command -v swiftc >/dev/null 2>&1; }; then
  command -v swiftc >/dev/null 2>&1 && \
    swiftc -swift-version 5 -O "$BT/main.swift" -o "$BT/conector-bluetooth" -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$BT/Info.plist"
fi
if [ -x "$BT/conector-bluetooth" ]; then
  PBT="$HOME/Library/LaunchAgents/$ROTULO.bluetooth.plist"
  cat > "$PBT" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ROTULO.bluetooth</string>
  <key>ProgramArguments</key><array><string>$BT/conector-bluetooth</string><string>$RAIZ/config.json</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$RAIZ/logs/bluetooth.log</string>
  <key>StandardErrorPath</key><string>$RAIZ/logs/bluetooth.log</string>
</dict></plist>
PL
  subir "$ROTULO.bluetooth" "$PBT"
else
  echo "sem o conector Bluetooth: use o cabo, ou instale o compilador com: xcode-select --install"
fi
# conferência de saúde: até 10 tentativas com espera crescente
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 2 http://127.0.0.1:$PORTA/saude >/dev/null 2>&1; then
    echo "ponte no ar. Painel e configuracao: http://127.0.0.1:$PORTA/painel"
    # na primeira instalacao, abre o assistente de configuracao no navegador
    grep -q '"configurado": true' "$RAIZ/config.json" 2>/dev/null || open "http://127.0.0.1:$PORTA/painel" 2>/dev/null || true
    exit 0
  fi
  sleep "$i"
done
echo "a ponte nao respondeu; veja $RAIZ/logs/servico.log" >&2; exit 1
