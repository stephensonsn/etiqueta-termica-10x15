// Envio direto pela USB para a térmica (classe impressora), sem a fila do macOS.
//
// Por que: a fila do CUPS gasta ~7 s fixos por trabalho esperando a impressora "confirmar o fim"
// (medido em 19/11/2026: 20 bytes = 7 s). O driver do próprio fabricante (rastertodlabel,
// decompilado com REA + Ghidra) só escreve SIZE/GAP/DENSITY/SPEED/CLS/BITMAP/PRINT em sequência,
// sem esperar nada entre etiquetas. Aqui fazemos o mesmo: a escrita termina assim que a impressora
// aceita os dados (o controle de fluxo da USB segura quando o buffer dela enche), e a etiqueta
// seguinte vai logo atrás, em fluxo contínuo.
//
// Segurança: antes de cada etiqueta pergunta o estado (GET_PORT_STATUS da classe impressora).
// Sem papel, com erro ou fora de linha: não manda, responde erro e a etiqueta fica na fila da ponte.
//
// Uso:
//   conector-usb <arquivo>      manda um arquivo (sai 0 = enviado; 2 = sem impressora; 3 = erro; 4 = estado ruim)
//   conector-usb --listar       impressoras USB da classe impressora
//   conector-usb --estado       estado da impressora pela USB (GET_PORT_STATUS)
//   conector-usb --servidor     fica aberto: lê do stdin quadros [4 bytes tamanho big-endian][dados]
//                               e responde uma linha por quadro: "ok <bytes>" ou "erro <motivo>"
import Foundation
import IOKit
import IOKit.usb
import IOUSBHost

func avisar(_ msg: String) { FileHandle.standardError.write((msg + "\n").data(using: .utf8)!) }
func erro(_ msg: String, _ codigo: Int32) -> Never { avisar(msg); exit(codigo) }

// A interface sem driver fica "não registrada" no IOKit e não aparece em busca direta:
// procura pelos aparelhos USB e desce até as interfaces da classe impressora (7).
func interfacesDeImpressora() -> [io_service_t] {
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOUSBHostDevice"), &it) == KERN_SUCCESS else { return [] }
    var out: [io_service_t] = []
    while case let dev = IOIteratorNext(it), dev != 0 {
        var filhos: io_iterator_t = 0
        if IORegistryEntryGetChildIterator(dev, kIOServicePlane, &filhos) == KERN_SUCCESS {
            while case let f = IOIteratorNext(filhos), f != 0 {
                if IOObjectConformsTo(f, "IOUSBHostInterface") != 0,
                   let c = IORegistryEntryCreateCFProperty(f, "bInterfaceClass" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? Int, c == 7,
                   ehTermica(f) {
                    out.append(f)
                } else { IOObjectRelease(f) }
            }
            IOObjectRelease(filhos)
        }
        IOObjectRelease(dev)
    }
    IOObjectRelease(it)
    return out
}

// Só a térmica: impressora de escritório (jato de tinta/laser) no mesmo Mac nunca recebe TSPL.
// Em 23/11/2026 a Brother DCP-T530DW estava no cabo e era a "primeira impressora USB".
let MARCAS_ESCRITORIO = ["brother", "hp", "hewlett", "epson", "canon", "samsung", "lexmark", "ricoh", "kyocera",
                         "xerox", "oki", "sharp", "konica", "minolta", "pantum", "dell", "fuji"]
func ehTermica(_ s: io_service_t) -> Bool {
    let nome = (((propriedade(s, "USB Vendor Name") as? String) ?? "") + " " + ((propriedade(s, "USB Product Name") as? String) ?? "")).lowercased()
    let palavras = nome.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    return !MARCAS_ESCRITORIO.contains(where: { m in palavras.contains(where: { $0 == m || $0.hasPrefix(m + "-") }) || nome.hasPrefix(m) })
}

func propriedade(_ s: io_service_t, _ chave: String) -> Any? {
    IORegistryEntrySearchCFProperty(s, kIOServicePlane, chave as CFString, kCFAllocatorDefault,
                                    IOOptionBits(kIORegistryIterateRecursively | kIORegistryIterateParents))
}

final class Impressora {
    let interface: IOUSBHostInterface
    let saida: IOUSBHostPipe
    let entrada: IOUSBHostPipe?

    init() throws {
        guard let servico = interfacesDeImpressora().first else { throw NSError(domain: "usb", code: 2, userInfo: [NSLocalizedDescriptionKey: "impressora USB não encontrada no cabo"]) }
        interface = try IOUSBHostInterface(__ioService: servico, options: [], queue: nil, interestHandler: nil)
        // endpoints bulk da interface: saída (dados) e entrada (estado)
        let config = interface.configurationDescriptor
        let base = UnsafeRawPointer(config)
        let total = Int(config.pointee.wTotalLength)
        let numero = interface.interfaceDescriptor.pointee.bInterfaceNumber
        var pos = 0, dentro = false, epSaida = 0, epEntrada = 0
        while pos + 2 <= total {
            let tam = Int(base.load(fromByteOffset: pos, as: UInt8.self))
            if tam == 0 { break }
            let tipo = base.load(fromByteOffset: pos + 1, as: UInt8.self)
            if tipo == 4 { dentro = base.load(fromByteOffset: pos + 2, as: UInt8.self) == numero }
            if tipo == 5 && dentro {
                let ep = Int(base.load(fromByteOffset: pos + 2, as: UInt8.self))
                let atrib = base.load(fromByteOffset: pos + 3, as: UInt8.self)
                if atrib & 0x03 == 2 { if ep & 0x80 == 0 { if epSaida == 0 { epSaida = ep } } else if epEntrada == 0 { epEntrada = ep } }
            }
            pos += tam
        }
        guard epSaida != 0 else { throw NSError(domain: "usb", code: 3, userInfo: [NSLocalizedDescriptionKey: "endpoint de saída não encontrado"]) }
        saida = try interface.copyPipe(withAddress: epSaida)
        entrada = epEntrada != 0 ? try? interface.copyPipe(withAddress: epEntrada) : nil
    }

    deinit { interface.destroy() }

    // escreve tudo em pedaços de 16 KB; o tempo máximo por pedaço cobre a impressora ocupada
    // imprimindo (buffer cheio segura a USB até abrir espaço)
    func escrever(_ dados: Data) throws -> Int {
        var enviados = 0
        while enviados < dados.count {
            let n = min(16384, dados.count - enviados)
            let parte = NSMutableData(data: dados.subdata(in: enviados..<(enviados + n)))
            var feitos = 0
            try saida.__sendIORequest(with: parte, bytesTransferred: &feitos, completionTimeout: 20)
            if feitos == 0 { throw NSError(domain: "usb", code: 3, userInfo: [NSLocalizedDescriptionKey: "a impressora parou de aceitar dados"]) }
            enviados += feitos
        }
        return enviados
    }

    // Estado pelo pedido padrão da classe impressora USB (GET_PORT_STATUS, bmRequestType 0xA1,
    // bRequest 1): bit5 = sem papel, bit4 = selecionada (on-line), bit3 = sem erro (1 = ok).
    // Pronta e com papel: 0x18. A OIA-8370-B não responde o <ESC>!? do TSPL por este canal.
    // nil = não respondeu (não bloqueia).
    func estado() -> UInt8? {
        let req = IOUSBDeviceRequest(bmRequestType: 0xA1, bRequest: 1, wValue: 0,
                                     wIndex: UInt16(interface.interfaceDescriptor.pointee.bInterfaceNumber), wLength: 1)
        let b = NSMutableData(length: 1)!
        var n = 0
        do { try interface.__send(req, data: b, bytesTransferred: &n, completionTimeout: 1) } catch { return nil }
        return n == 1 ? b.bytes.load(as: UInt8.self) : nil
    }
}

// o que impede imprimir: sem papel, fora de linha (tampa aberta/pausada) ou com erro
func motivoDoEstado(_ e: UInt8) -> String? {
    var m: [String] = []
    if e & 0x20 != 0 { m.append("sem papel") }
    if e & 0x08 == 0 { m.append("impressora com erro (tampa aberta ou papel travado?)") }
    if e & 0x10 == 0 { m.append("impressora fora de linha (pausada?)") }
    return m.isEmpty ? nil : m.joined(separator: ", ")
}

let args = CommandLine.arguments
let modo = args.count > 1 ? args[1] : ""

if modo == "--listar" {
    for s in interfacesDeImpressora() { print("\(propriedade(s, "USB Product Name") ?? "?")\tserial=\(propriedade(s, "USB Serial Number") ?? "?")") }
    exit(0)
}

let impressora: Impressora
do { impressora = try Impressora() } catch { erro(error.localizedDescription, Int32((error as NSError).code == 2 ? 2 : 3)) }

if modo == "--estado" {
    if let e = impressora.estado() { print(String(format: "estado 0x%02X %@", e, motivoDoEstado(e) ?? "pronta")) } else { print("sem resposta") }
    exit(0)
}

if modo == "--servidor" {
    setvbuf(stdout, nil, _IOLBF, 0)
    print("pronto")
    let entrada = FileHandle.standardInput
    func lerExato(_ n: Int) -> Data? {
        var d = Data()
        while d.count < n {
            let p = entrada.readData(ofLength: n - d.count)
            if p.isEmpty { return nil }
            d.append(p)
        }
        return d
    }
    while let cab = lerExato(4) {
        let tam = Int(cab[0]) << 24 | Int(cab[1]) << 16 | Int(cab[2]) << 8 | Int(cab[3])
        guard tam > 0, tam < 64 * 1024 * 1024, let dados = lerExato(tam) else { print("erro quadro inválido"); exit(3) }
        if let e = impressora.estado(), let motivo = motivoDoEstado(e) { print("erro estado \(motivo)"); continue }
        do { print("ok \(try impressora.escrever(dados))") } catch { print("erro usb \(error.localizedDescription)"); exit(3) }
    }
    exit(0)
}

guard !modo.isEmpty, let dados = FileManager.default.contents(atPath: modo) else { erro("uso: conector-usb <arquivo> | --servidor | --estado | --listar", 1) }
if let e = impressora.estado(), let motivo = motivoDoEstado(e) { erro("impressora não está pronta: \(motivo)", 4) }
do { print("enviados \(try impressora.escrever(dados)) bytes") } catch { erro("erro USB: \(error.localizedDescription)", 3) }
