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
    /* 1) lê a página inteira em tons de cinza (0 = preto, 255 = branco), seja qual for o formato de entrada */
    unsigned W = h.cupsWidth, H = h.cupsHeight, bpp = h.cupsBitsPerPixel;
    int pretoEhAlto = (h.cupsColorSpace == CUPS_CSPACE_K); /* em K, valor alto = tinta */
    unsigned char *linha = malloc(h.cupsBytesPerLine);
    unsigned char *cinza = malloc((size_t)W * H);
    if (!linha || !cinza) { fputs("ERROR: sem memória\n", stderr); return 1; }
    memset(cinza, 255, (size_t)W * H);
    for (unsigned y = 0; y < H; y++) {
      if (cupsRasterReadPixels(ras, linha, h.cupsBytesPerLine) == 0) break;
      for (unsigned x = 0; x < W; x++) {
        int v;
        if (bpp == 1) { int bit = (linha[x >> 3] >> (7 - (x & 7))) & 1; v = (pretoEhAlto ? bit : !bit) ? 0 : 255; }
        else if (bpp == 8) v = pretoEhAlto ? 255 - linha[x] : linha[x];
        else { unsigned char *p = linha + (size_t)x * (bpp / 8); v = (p[0] * 299 + p[1] * 587 + p[2] * 114) / 1000; }
        cinza[(size_t)y * W + x] = (unsigned char)v;
      }
    }
    free(linha);

    /* 2) tamanho de saída. Se o programa mandou uma página maior que a etiqueta (A4, Carta),
          reduz para caber em 100 x 150 mm em vez de imprimir cortado ou numa tira comprida */
    double largMm = h.cupsPageSize[0] > 0 ? h.cupsPageSize[0] * 25.4 / 72.0 : (double)W / PONTOS_POR_MM;
    double altMm = h.cupsPageSize[1] > 0 ? h.cupsPageSize[1] * 25.4 / 72.0 : (double)H / PONTOS_POR_MM;
    unsigned larg = W, alt = H;
    double escala = 1.0;
    if (largMm > 110.0 || W > LARGURA_MAX) {
      double ex = 800.0 / W, ey = 1198.0 / H;
      escala = ex < ey ? ex : ey;
      larg = (unsigned)(W * escala); alt = (unsigned)(H * escala);
      if (larg < 1) larg = 1;
      if (alt < 1) alt = 1;
      largMm = 100.0; altMm = 150.0;
      fprintf(stderr, "INFO: página maior que a etiqueta: reduzida para %.0f%% para caber em 100 x 150 mm\n", escala * 100);
    }
    /* a imagem não pode passar da altura real da etiqueta, senão a impressora corta e desloca */
    unsigned altMax = (unsigned)(altMm * 203.0 / 25.4);
    if (altMax > 0 && alt > altMax) alt = altMax;
    unsigned bytesLinha = (larg + 7) / 8;
    unsigned char *img = malloc((size_t)bytesLinha * alt);
    if (!img) { fputs("ERROR: sem memória\n", stderr); return 1; }
    memset(img, 0xFF, (size_t)bytesLinha * alt); /* no TSPL, bit 1 = branco */

    /* 3) cinza -> preto e branco; na redução, cada ponto de saída é a média da área de origem */
    for (unsigned y = 0; y < alt; y++) {
      for (unsigned x = 0; x < larg; x++) {
        int v;
        if (escala == 1.0) v = cinza[(size_t)y * W + x];
        else {
          unsigned x0 = (unsigned)(x / escala), x1 = (unsigned)((x + 1) / escala), y0 = (unsigned)(y / escala), y1 = (unsigned)((y + 1) / escala);
          if (x1 <= x0) x1 = x0 + 1;
          if (y1 <= y0) y1 = y0 + 1;
          if (x1 > W) x1 = W;
          if (y1 > H) y1 = H;
          unsigned long soma = 0, qtd = 0;
          for (unsigned yy = y0; yy < y1; yy++) for (unsigned xx = x0; xx < x1; xx++) { soma += cinza[(size_t)yy * W + xx]; qtd++; }
          v = qtd ? (int)(soma / qtd) : 255;
        }
        /* na redução o traço fino clareia: aceita um cinza mais claro como preto */
        if (v < (escala == 1.0 ? limiar : limiar + 40)) img[(size_t)y * bytesLinha + (x >> 3)] &= (unsigned char)~(0x80 >> (x & 7));
      }
    }
    free(cinza);

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
    free(img);
  }
  cupsRasterClose(ras);
  if (fd) close(fd);
  if (pagina == 0) { fputs("ERROR: o trabalho veio sem páginas\n", stderr); return 1; }
  fflush(stdout);
  return 0;
}
