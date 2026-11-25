#!/bin/bash
# Atualiza a ponte instalada com o código deste repositório (só os arquivos versionados de src/).
# Backup datado antes; reinicia o serviço; confere /saude. Não subiu em 30 s: restaura o backup.
# Log com data e hora em <instalação>/logs/atualizar-ponte.log. Rodar de novo é seguro (idempotente).
# Uso: bash scripts/atualizar-ponte.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
INST="$HOME/Library/Application Support/EtiquetaTermica"
SERV="gui/$(id -u)/br.local.etiqueta-ml"
REG="$INST/logs/atualizar-ponte.log"
mkdir -p "$INST/logs"
passo() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$REG"; }
saude() { for _ in $(seq 1 30); do curl -sf --max-time 2 http://127.0.0.1:9100/saude >/dev/null && return 0; sleep 1; done; return 1; }

[ -d "$INST/src" ] || { passo "ERRO: ponte não instalada em $INST"; exit 1; }
cd "$REPO"
if git ls-files src | while read -r f; do cmp -s "$f" "$INST/$f" || exit 1; done; then passo "já está atualizada; nada a fazer"; exit 0; fi
B="$INST/backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$B" && cp -R "$INST/src" "$B/src" || { passo "ERRO: backup falhou; nada mudou"; exit 1; }
passo "backup em $B"
git ls-files src | while read -r f; do mkdir -p "$INST/$(dirname "$f")"; cp "$f" "$INST/$f"; done
passo "código copiado ($(git rev-parse --short HEAD)); reiniciando"
launchctl kickstart -k "$SERV"
if saude; then passo "ponte no ar com o código novo"; exit 0; fi
passo "ERRO: a ponte não respondeu em 30 s; restaurando o backup"
rm -rf "$INST/src" && cp -R "$B/src" "$INST/src"
launchctl kickstart -k "$SERV"
saude && passo "restaurada a versão anterior" || passo "ERRO: nem a versão anterior subiu; veja $INST/logs/servico.log"
exit 1
