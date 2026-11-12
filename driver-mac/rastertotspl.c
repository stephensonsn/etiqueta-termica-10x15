/*
 * rastertotspl — filtro do sistema de impressão do macOS (CUPS) para impressoras térmicas TSPL.
 * Recebe a página já desenhada pelo sistema (raster) e devolve os comandos TSPL.
 * Escrito do zero para este projeto; não usa código do fabricante.
 *
 * Uso (o CUPS chama assim): rastertotspl trabalho usuario titulo copias opcoes [arquivo]
 */
#include <cups/cups.h>
#include <cups/ppd.h>
#include <cups/raster.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define PONTOS_POR_MM 8      /* 203 dpi */
#define LARGURA_MAX   864    /* cabeça de 108 mm */

/* valor de uma opção do modelo (PPD), já com o que o usuário escolheu na janela de impressão */
static int opcao(ppd_file_t *ppd, const char *nome, int padrao) {
  ppd_choice_t *c = ppd ? ppdFindMarkedChoice(ppd, nome) : NULL;
  return c ? atoi(c->choice) : padrao;
}

int main(int argc, char *argv[]) {
  if (argc < 6 || argc > 7) {
    fputs("ERROR: uso: rastertotspl trabalho usuario titulo copias opcoes [arquivo]\n", stderr);
    return 1;
  }
  int fd = 0;
  if (argc == 7 && (fd = open(argv[6], O_RDONLY)) < 0) { perror("ERROR: não abriu o arquivo"); return 1; }
  int copias = atoi(argv[4]);
  if (copias < 1) copias = 1;

  cups_option_t *opcoes = NULL;
  int n = cupsParseOptions(argv[5], 0, &opcoes);
  ppd_file_t *ppd = getenv("PPD") ? ppdOpenFile(getenv("PPD")) : NULL;
  if (ppd) { ppdMarkDefaults(ppd); cupsMarkOptions(ppd, n, opcoes); }
  int densidade = opcao(ppd, "EtDensidade", 6);
  int velocidade = opcao(ppd, "EtVelocidade", 6);
  int limiar = opcao(ppd, "EtLimiar", 150);   /* abaixo disso o ponto sai preto (0 = preto, 255 = branco) */
  int espaco = opcao(ppd, "EtEspaco", 2);     /* espaço entre etiquetas, em mm */

  cups_raster_t *ras = cupsRasterOpen(fd, CUPS_RASTER_READ);
  if (!ras) { fputs("ERROR: não leu a imagem da página\n", stderr); return 1; }

  cups_page_header2_t h;
  int pagina = 0;
  while (cupsRasterReadHeader2(ras, &h)) {
    pagina++;
    if (h.cupsWidth == 0 || h.cupsHeight == 0 || h.cupsBytesPerLine == 0) break;
    unsigned larg = h.cupsWidth > LARGURA_MAX ? LARGURA_MAX : h.cupsWidth;
    double largMm = h.cupsPageSize[0] > 0 ? h.cupsPageSize[0] * 25.4 / 72.0 : (double)h.cupsWidth / PONTOS_POR_MM;
    double altMm = h.cupsPageSize[1] > 0 ? h.cupsPageSize[1] * 25.4 / 72.0 : (double)h.cupsHeight / PONTOS_POR_MM;
    /* a imagem não pode passar da altura real da etiqueta, senão a impressora corta e desloca */
    unsigned altMax = (unsigned)(altMm * 203.0 / 25.4);
    unsigned alt = h.cupsHeight > altMax && altMax > 0 ? altMax : h.cupsHeight;
    unsigned bytesLinha = (larg + 7) / 8;

    unsigned char *linha = malloc(h.cupsBytesPerLine);
    unsigned char *img = malloc((size_t)bytesLinha * alt);
    if (!linha || !img) { fputs("ERROR: sem memória\n", stderr); return 1; }
    memset(img, 0xFF, (size_t)bytesLinha * alt); /* no TSPL, bit 1 = branco */

    unsigned bpp = h.cupsBitsPerPixel;
    int pretoEhAlto = (h.cupsColorSpace == CUPS_CSPACE_K); /* em K, valor alto = tinta */
    for (unsigned y = 0; y < h.cupsHeight; y++) {
      if (cupsRasterReadPixels(ras, linha, h.cupsBytesPerLine) == 0) break;
      if (y >= alt) continue;
      for (unsigned x = 0; x < larg; x++) {
        int preto;
        if (bpp == 1) {
          int bit = (linha[x >> 3] >> (7 - (x & 7))) & 1;
          preto = pretoEhAlto ? bit : !bit;
        } else if (bpp == 8) {
          preto = pretoEhAlto ? linha[x] > (255 - limiar) : linha[x] < limiar;
        } else { /* 24 ou 32 bits: usa a luminosidade */
          unsigned char *p = linha + (size_t)x * (bpp / 8);
          int lum = (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000;
          preto = lum < limiar;
        }
        if (preto) img[(size_t)y * bytesLinha + (x >> 3)] &= (unsigned char)~(0x80 >> (x & 7));
      }
    }

    if (pagina == 1) {
      /* a impressora perde o começo do trabalho pelo USB: o enchimento garante que o SIZE chegue */
      for (int i = 0; i < 1024; i++) fputs("\r\n", stdout);
    }
    printf("SIZE %.0f mm,%.0f mm\r\nREFERENCE 0 ,0 \r\nDIRECTION 0\r\nGAP %d mm,0 mm\r\nDENSITY %d\r\nSPEED %d\r\nCLS\r\n",
           largMm, altMm, espaco, densidade, velocidade);
    printf("BITMAP 0,0,%u,%u,1,", bytesLinha, alt);
    fwrite(img, 1, (size_t)bytesLinha * alt, stdout);
    printf("\r\nPRINT 1,%d\r\n", copias);
    fprintf(stderr, "INFO: página %d: %ux%u pontos, %u bit(s) por ponto, %.0fx%.0f mm\n", pagina, larg, alt, bpp, largMm, altMm);
    free(linha);
    free(img);
  }
  cupsRasterClose(ras);
  if (fd) close(fd);
  if (pagina == 0) { fputs("ERROR: o trabalho veio sem páginas\n", stderr); return 1; }
  fflush(stdout);
  return 0;
}
