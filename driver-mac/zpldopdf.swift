// Acha o código ZPL dentro de um PDF (o arquivo .txt do TikTok/ML aberto no navegador ou num editor e
// mandado imprimir pelo Mac). Escreve o ZPL na saída padrão e sai com 0; sem ZPL, não escreve nada e
// sai com 1. Usado pelo filtro do driver (etiquetatexto): ZPL vira etiqueta em vez de sair o código.
// Uso: zpldopdf arquivo.pdf
import Foundation
import PDFKit

guard CommandLine.arguments.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { exit(1) }
var texto = ""
for i in 0..<doc.pageCount {
    guard let pag = doc.page(at: i) else { continue }
    // só o miolo da página: o cabeçalho e o rodapé do navegador (nome do arquivo, data, "1/4") ficam
    // nas margens e cairiam no meio do código
    let caixa = pag.bounds(for: .mediaBox).insetBy(dx: 0, dy: 30)
    texto += (pag.selection(for: caixa)?.string ?? pag.string ?? "") + "\n"
}
guard let ini = texto.range(of: "^XA"), let fim = texto.range(of: "^XZ", options: .backwards), ini.lowerBound < fim.upperBound else { exit(1) }
// linhas quebradas pela largura da página: o ZPL não depende de quebra de linha, então junta tudo.
// Sobra de cabeçalho/rodapé que tenha escapado (tem espaço, barra ou ponto e não tem ^ nem ~) sai.
var zpl = ""
for linha in texto[ini.lowerBound..<fim.upperBound].components(separatedBy: .newlines) {
    let l = linha.trimmingCharacters(in: .whitespaces)
    if l.isEmpty { continue }
    if !l.contains("^") && !l.contains("~") && l.range(of: "^[0-9A-Za-z:,!]+$", options: .regularExpression) == nil { continue }
    zpl += l
}
FileHandle.standardOutput.write(zpl.data(using: .utf8)!)
exit(0)
