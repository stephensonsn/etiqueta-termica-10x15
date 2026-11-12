#!/bin/bash
# Instala (ou reinstala) a ponte como serviço do usuário: sobe no login e volta sozinha se cair.
# Idempotente: pode rodar de novo a qualquer momento.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)"
ROTULO="br.local.etiqueta-ml"
PLIST="$HOME/Library/LaunchAgents/$ROTULO.plist"
# (re)instala um serviço do usuário; espera o anterior sair de verdade antes de subir o novo
subir() { # $1 = rótulo, $2 = plist
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1 || break; sleep 0.5; done
  for i in 1 2 3; do launchctl bootstrap "gui/$(id -u)" "$2" 2>/dev/null && return 0; sleep "$i"; done
  echo "nao consegui subir o servico $1" >&2; return 1
}
mkdir -p "$RAIZ/logs" "$HOME/Library/LaunchAgents"
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
if command -v swiftc >/dev/null 2>&1; then
  [ -x "$BT/conector-bluetooth" ] && [ "$BT/conector-bluetooth" -nt "$BT/main.swift" ] || \
    swiftc -swift-version 5 -O "$BT/main.swift" -o "$BT/conector-bluetooth" -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$BT/Info.plist"
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
  echo "sem swiftc: o Bluetooth sem navegador fica desligado (instale com: xcode-select --install)"
fi
# conferência de saúde: até 10 tentativas com espera crescente
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 2 http://127.0.0.1:9100/saude >/dev/null 2>&1; then
    echo "ponte no ar. Painel e configuracao: http://127.0.0.1:9100/painel"
    # na primeira instalacao, abre o assistente de configuracao no navegador
    grep -q '"configurado": true' "$RAIZ/config.json" 2>/dev/null || open "http://127.0.0.1:9100/painel" 2>/dev/null || true
    exit 0
  fi
  sleep "$i"
done
echo "a ponte nao respondeu; veja $RAIZ/logs/servico.log" >&2; exit 1
