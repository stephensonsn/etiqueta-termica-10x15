#!/bin/bash
# Atualiza a ponte instalada com o código deste repositório (só os arquivos versionados de src/ e separacao/).
# src/web é o app (build do React em web/): rode `npm run build` em web/ e versione antes.
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
PASTAS="src separacao"
if git ls-files $PASTAS | while read -r f; do cmp -s "$f" "$INST/$f" || exit 1; done; then passo "já está atualizada; nada a fazer"; exit 0; fi
B="$INST/backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$B" && cp -R "$INST/src" "$B/src" || { passo "ERRO: backup falhou; nada mudou"; exit 1; }
[ -d "$INST/separacao" ] && cp -R "$INST/separacao" "$B/separacao"
passo "backup em $B"
# o build do app troca o nome dos arquivos a cada versão: limpa o antigo (o backup guarda a cópia)
rm -rf "$INST/src/web"
git ls-files $PASTAS | while read -r f; do mkdir -p "$INST/$(dirname "$f")"; cp "$f" "$INST/$f"; done
passo "código copiado ($(git rev-parse --short HEAD)); reiniciando"
launchctl kickstart -k "$SERV"
# abre as páginas que o navegador pede (painel, ícone) e confere de novo: pega queda que só vem na 1ª visita
visita() { for r in / /fila /painel /favicon.ico /icone.svg; do curl -s --max-time 3 -o /dev/null "http://127.0.0.1:9100$r"; done; sleep 2; curl -sf --max-time 2 http://127.0.0.1:9100/saude >/dev/null; }
if saude && visita; then passo "ponte no ar com o código novo (app, painel e ícone conferidos)"; exit 0; fi
passo "ERRO: a ponte não respondeu em 30 s; restaurando o backup"
rm -rf "$INST/src" && cp -R "$B/src" "$INST/src"
if [ -d "$B/separacao" ]; then rm -rf "$INST/separacao" && cp -R "$B/separacao" "$INST/separacao"; else rm -rf "$INST/separacao"; fi
launchctl kickstart -k "$SERV"
saude && passo "restaurada a versão anterior" || passo "ERRO: nem a versão anterior subiu; veja $INST/logs/servico.log"
exit 1
