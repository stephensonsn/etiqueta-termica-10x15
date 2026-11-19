// Escreve bytes direto na impressora térmica pelo cabo USB (classe impressora), sem passar pela
// fila do macOS. A fila do CUPS espera ~7 s por trabalho a impressora "confirmar o fim"; aqui a
// escrita termina assim que a impressora aceita os dados, e a etiqueta seguinte vai logo depois.
// Uso: conector-usb <arquivo>        (sai 0 = enviado; 2 = impressora não achada; 3 = erro de escrita)
//      conector-usb --listar         (mostra as impressoras USB da classe impressora)
import Foundation
import IOKit
import IOKit.usb
import IOUSBHost

func erro(_ msg: String, _ codigo: Int32) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(codigo)
}

// interfaces USB da classe impressora (7). A interface sem driver fica "não registrada" no IOKit
// e não aparece em busca direta: procura pelos aparelhos USB e desce até as interfaces deles.
func interfacesDeImpressora() -> [io_service_t] {
    var it: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOUSBHostDevice"), &it) == KERN_SUCCESS else { return [] }
    var out: [io_service_t] = []
    while case let dev = IOIteratorNext(it), dev != 0 {
        var filhos: io_iterator_t = 0
        if IORegistryEntryGetChildIterator(dev, kIOServicePlane, &filhos) == KERN_SUCCESS {
            while case let f = IOIteratorNext(filhos), f != 0 {
                if IOObjectConformsTo(f, "IOUSBHostInterface") != 0,
                   let c = IORegistryEntryCreateCFProperty(f, "bInterfaceClass" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? Int, c == 7 {
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

func propriedade(_ s: io_service_t, _ chave: String) -> Any? {
    IORegistryEntrySearchCFProperty(s, kIOServicePlane, chave as CFString, kCFAllocatorDefault,
                                    IOOptionBits(kIORegistryIterateRecursively | kIORegistryIterateParents))
}

let args = CommandLine.arguments
let lista = interfacesDeImpressora()
if args.count > 1 && args[1] == "--listar" {
    for s in lista {
        print("\(propriedade(s, "USB Product Name") ?? "?")\tserial=\(propriedade(s, "USB Serial Number") ?? "?")")
    }
    exit(0)
}
guard args.count > 1, let dados = FileManager.default.contents(atPath: args[1]) else { erro("uso: conector-usb <arquivo>", 1) }
guard let servico = lista.first else { erro("impressora USB não encontrada no cabo", 2) }

do {
    let interface = try IOUSBHostInterface(__ioService: servico, options: [], queue: nil, interestHandler: nil)
    defer { interface.destroy() }
    // acha o endpoint bulk de saída percorrendo os descritores da interface
    let config = interface.configurationDescriptor
    let base = UnsafeRawPointer(config)
    let total = Int(config.pointee.wTotalLength)
    var pos = 0, endereco: UInt = 0, dentroDaInterface = false
    let numero = interface.interfaceDescriptor.pointee.bInterfaceNumber
    while pos + 2 <= total {
        let tam = Int(base.load(fromByteOffset: pos, as: UInt8.self))
        let tipo = base.load(fromByteOffset: pos + 1, as: UInt8.self)
        if tam == 0 { break }
        if tipo == 4 { dentroDaInterface = base.load(fromByteOffset: pos + 2, as: UInt8.self) == numero }
        if tipo == 5 && dentroDaInterface {
            let ep = base.load(fromByteOffset: pos + 2, as: UInt8.self)
            let atrib = base.load(fromByteOffset: pos + 3, as: UInt8.self)
            if ep & 0x80 == 0 && atrib & 0x03 == 2 { endereco = UInt(ep); break }
        }
        pos += tam
    }
    guard endereco != 0 else { erro("endpoint de saída não encontrado", 3) }
    let pipe = try interface.copyPipe(withAddress: Int(endereco))
    let buf = NSMutableData(data: dados)
    var enviados = 0
    // pedaços de 16 KB, com tempo máximo por pedaço proporcional ao tamanho
    while enviados < dados.count {
        let n = min(16384, dados.count - enviados)
        let parte = NSMutableData(bytes: buf.bytes + enviados, length: n)
        var feitos = 0
        try pipe.__sendIORequest(with: parte, bytesTransferred: &feitos, completionTimeout: 30)
        enviados += feitos
        if feitos == 0 { erro("a impressora parou de aceitar dados", 3) }
    }
    print("enviados \(enviados) bytes")
} catch {
    erro("erro USB: \(error.localizedDescription)", 3)
}
