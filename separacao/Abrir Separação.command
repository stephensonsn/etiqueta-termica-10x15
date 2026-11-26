#!/bin/zsh
set -u
cd -- "$(dirname -- "$0")" || exit 1
RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
PYTHON=""
for candidato in "${SEPARACAO_PYTHON:-}" "$PWD/.venv/bin/python3" "$RUNTIME" /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [[ -n "$candidato" && -x "$candidato" ]] && "$candidato" -c 'import reportlab; from zoneinfo import ZoneInfo' >/dev/null 2>&1; then
    PYTHON="$candidato"
    break
  fi
done
if [[ -z "$PYTHON" ]]; then
  echo "Python com ReportLab não encontrado. Consulte README.md nesta pasta."
  read '?Pressione Enter para fechar.'
  exit 1
fi
echo "Abrindo a tela de upload local…"
"$PYTHON" "$PWD/app.py" "$@"
RESULTADO=$?
if [[ "$RESULTADO" -ne 0 ]]; then
  echo "Não foi possível abrir. Leia a mensagem acima."
  read '?Pressione Enter para fechar.'
fi
exit "$RESULTADO"
