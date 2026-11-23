#!/bin/bash
# Baixa e abre o instalador do driver do fabricante da OIA-8370-B (LabelPrinter 2.3.3, macOS).
# O site do fabricante (cnfujun.com/d/73) só tem uma página que redireciona; o arquivo de verdade
# sai deste endereço direto (achado lendo a página, 23/11/2026):
#   macOS:   https://www.cnfujun.com/en/init.php/index/down?id=73  -> Driver software for Mac-73.zip
#   Windows: https://www.cnfujun.com/en/init.php/index/down?id=72  -> Label Printer Driver software for Windows-72.exe
# Uso: bash driver-mac/baixar-driver-fabricante.sh [pasta]   (padrão: ~/Downloads/driver-etiqueta)
#      SO_BAIXAR=1 ... só baixa e confere o zip e o DMG
#      SO_VALIDAR=1 ... baixa e confere tudo (assinatura e conteúdo do pacote), não abre o instalador
# Idempotente: driver já instalado = não faz nada; zip já baixado e conferido = não baixa de novo;
# download interrompido continua de onde parou. A instalação em si é o instalador da Apple
# (pede a senha de administrador na tela; este script nunca pede nem guarda senha).
set -euo pipefail
URL="https://www.cnfujun.com/en/init.php/index/down?id=73"
# soma do zip conferido em 23/11/2026; se o fabricante trocar o arquivo, vale a assinatura do pacote
SHA_CONHECIDO="74ca18d4f65d9ff2a2f247d83a5ad6ea0871eeeadc62fba70186a5bfb3130f86"
ASSINATURA="Developer ID Installer: gonghai wang (W9EBWVXHKB)"
PASTA="${1:-$HOME/Downloads/driver-etiqueta}"
ZIP="$PASTA/Driver software for Mac-73.zip"
REG="$PASTA/baixar-driver.log"
mkdir -p "$PASTA"
passo() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$REG"; }
falhar() { passo "ERRO: $*"; exit 1; }

if [ -z "${SO_BAIXAR:-}${SO_VALIDAR:-}" ] && { [ -e /Library/Printers/LabelPOS/rastertodlabel ] || ls /Library/Printers/PPDs/Contents/Resources/Label_TSPL* >/dev/null 2>&1; }; then
  passo "driver do fabricante já instalado; nada a fazer"; exit 0
fi

# conferência: zip de verdade com o LabelPrinter*.dmg dentro (não página de erro em HTML)
zip_ok() { [ -s "$ZIP" ] && unzip -l "$ZIP" 2>/dev/null | grep -q 'LabelPrinter.*\.dmg'; }

if zip_ok; then
  passo "zip já baixado e conferido: $ZIP"
else
  # tempo limite pelo volume: base 60 s + 10 s por MB esperado (~60 MB), teto 15 min;
  # nova tentativa com espera crescente, continuando de onde parou (-C -)
  LIMITE=$((60 + 60 * 10)); [ "$LIMITE" -gt 900 ] && LIMITE=900
  for t in 1 2 3 4 5; do
    passo "baixando (tentativa $t/5, até ${LIMITE}s): $URL"
    if curl -fL --max-time "$LIMITE" --connect-timeout 20 -C - -A "Mozilla/5.0" -o "$ZIP" "$URL" 2>>"$REG" && zip_ok; then break; fi
    # arquivo que não é zip (página de erro) não serve para continuar: recomeça do zero
    if [ -s "$ZIP" ] && ! file "$ZIP" | grep -qi zip; then rm -f "$ZIP"; fi
    [ "$t" -eq 5 ] && falhar "não deu para baixar o driver depois de 5 tentativas (veja $REG)"
    sleep $((5 * t))
  done
  passo "baixado e conferido: $(du -h "$ZIP" | cut -f1) — $(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
fi

EXTRAIDO="$PASTA/extraido"
rm -rf "$EXTRAIDO"; mkdir -p "$EXTRAIDO"
unzip -q "$ZIP" -d "$EXTRAIDO" || falhar "zip corrompido; apague $ZIP e rode de novo"
DMG="$(find "$EXTRAIDO" -name 'LabelPrinter*.dmg' | head -1)"
[ -n "$DMG" ] || falhar "o zip não tem o LabelPrinter*.dmg"
xattr -dr com.apple.quarantine "$EXTRAIDO" 2>/dev/null || true
hdiutil verify "$DMG" >/dev/null 2>&1 && passo "DMG conferido: $(basename "$DMG")" || falhar "DMG corrompido; apague $ZIP e rode de novo"
[ -n "${SO_BAIXAR:-}" ] && { passo "só baixar: pronto em $DMG"; exit 0; }

VOL="$(hdiutil attach -nobrowse "$DMG" | awk -F'\t' '/\/Volumes\//{print $NF; exit}')"
[ -d "$VOL" ] || falhar "não deu para abrir o DMG"
PKG="$(find "$VOL" -maxdepth 2 \( -name '*.pkg' -o -name '*.mpkg' \) | head -1)"
if [ -n "$PKG" ]; then
  # segurança: só abre pacote assinado pelo fabricante e aceito pela Apple (notarizado)
  SHA="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
  [ "$SHA" = "$SHA_CONHECIDO" ] || passo "aviso: o fabricante trocou o arquivo (soma $SHA); conferindo a assinatura"
  ASS="$(pkgutil --check-signature "$PKG" 2>&1 || true)"
  if ! echo "$ASS" | grep -qF "$ASSINATURA" || ! spctl -a -t install "$PKG" >/dev/null 2>&1; then
    hdiutil detach "$VOL" >/dev/null 2>&1 || true
    falhar "pacote sem a assinatura do fabricante ou recusado pela Apple; não abri"
  fi
  passo "assinatura conferida: $ASSINATURA, aceito pela Apple"
  # conteúdo: tem que ser o driver de etiqueta TSPL (filtro CUPS + modelos 10x15 a 203 dpi), sem
  # nada fora de /Library/Printers. Conferido em 23/11/2026: 5 modelos "Label -8X00/8X10/9X00/9X10/9X20",
  # filtro rastertodlabel (x86_64+arm64) que gera SIZE/GAP/BITMAP/PRINT, scripts só em /Library/Printers.
  ABERTO="$PASTA/pacote-aberto-$$"
  pkgutil --expand "$PKG" "$ABERTO" >/dev/null 2>&1 || { hdiutil detach "$VOL" >/dev/null 2>&1 || true; falhar "não deu para abrir o pacote para conferir"; }
  validar() {
    local info scripts arqs
    info="$(cat "$ABERTO"/*.pkg/PackageInfo 2>/dev/null)"
    echo "$info" | grep -q 'install-location="/Library/Printers"' || { echo "instala fora de /Library/Printers"; return 1; }
    arqs="$(pkgutil --payload-files "$PKG" 2>/dev/null)"
    echo "$arqs" | grep -q 'LabelPOS/rastertodlabel' || { echo "sem o filtro rastertodlabel"; return 1; }
    echo "$arqs" | grep -q 'PPDs/Contents/Resources/Label_TSPL-.*\.ppd\.gz' || { echo "sem os modelos Label_TSPL"; return 1; }
    # scripts de instalação: só podem mexer em /Library/Printers (nada de rede, launchd ou desligar o Gatekeeper)
    scripts="$(cat "$ABERTO"/*.pkg/Scripts/* 2>/dev/null | grep -v '^[[:space:]]*#')"
    if echo "$scripts" | grep -qiE 'curl|wget|https?://|launchctl|LaunchDaemons|LaunchAgents|spctl|csrutil|/etc/|osascript|python|perl|base64'; then echo "script de instalação faz algo além de copiar o driver"; return 1; fi
    echo "$scripts" | grep -E '^[[:space:]]*(rm|cp|mv|chmod|sudo)' | grep -vq '/Library/Printers' && { echo "script mexe fora de /Library/Printers"; return 1; }
    return 0
  }
  MOTIVO="$(validar)" || { rm -rf "$ABERTO"; hdiutil detach "$VOL" >/dev/null 2>&1 || true; falhar "o pacote não parece o driver de etiqueta: $MOTIVO; não abri"; }
  rm -rf "$ABERTO"
  passo "conteúdo conferido: filtro rastertodlabel + modelos Label_TSPL, scripts só em /Library/Printers"
  if [ -n "${SO_VALIDAR:-}" ]; then hdiutil detach "$VOL" >/dev/null 2>&1 || true; passo "só validar: pacote aprovado, instalador não aberto"; exit 0; fi
  passo "abrindo o instalador da Apple: $(basename "$PKG") (ele pede a senha de administrador)"
  open -W "$PKG" || true
  hdiutil detach "$VOL" >/dev/null 2>&1 || true
  if [ -e /Library/Printers/LabelPOS/rastertodlabel ] || ls /Library/Printers/PPDs/Contents/Resources/Label_TSPL* >/dev/null 2>&1; then
    passo "pronto: driver do fabricante instalado"
  else
    passo "o instalador fechou sem instalar o driver (cancelado?); rode de novo quando quiser"
  fi
else
  passo "o DMG não tem .pkg; abrindo a pasta para você seguir as instruções do fabricante: $VOL"
  open "$VOL"
fi
