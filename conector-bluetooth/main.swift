// Conector Bluetooth da ponte de etiquetas (macOS).
// Liga sozinho na impressora térmica por Bluetooth 4.0 (BLE), mantém a conexão e reconecta se cair.
// Busca os trabalhos na ponte local (http://127.0.0.1:9100/api/ble/proximo), escreve na impressora
// e confirma (/api/ble/feito). Não depende de navegador aberto.
//
// Uso: conector-bluetooth <caminho do config.json>
// O nome da impressora vem de conexao.bleNome no config.json (ex.: "OIA-8370-B").

import CoreBluetooth
import Foundation

func registrar(_ msg: String) {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd HH:mm:ss"
    print("\(f.string(from: Date())) \(msg)")
    fflush(stdout)
}

final class Conector: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    let caminhoConfig: String
    let ponte: String
    var central: CBCentralManager!
    var impressora: CBPeripheral?
    var canal: CBCharacteristic?
    var servicosPendentes = 0

    // trabalho em andamento
    var dados = Data()
    var posicao = 0
    var idTrabalho: Int?
    var ocupado = false
    var ultimoAvanco = Date()

    // estado real da impressora (resposta ao comando de consulta <ESC>!?)
    var estado: Int? = nil            // último byte de estado recebido
    var estadoQuando = Date.distantPast
    var consultaQuando = Date.distantPast
    var jaRespondeu = false
    var contador = 0
    var tentativas = 0
    var canalInfo: CBCharacteristic?   // canal de leitura usado como sinal de vida
    var pulsoPedido: Date?
    var retomar = false                // reenviar o trabalho atual depois de reconectar
    var jaIdentificou = false
    var consultasSemResposta = 0
    var inicioEnvio = Date()

    init(caminhoConfig: String) {
        self.caminhoConfig = caminhoConfig
        self.ponte = "http://127.0.0.1:\(Conector.lerConfig(caminhoConfig).porta)"
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
        // consulta a ponte uma vez por segundo; vigia envio travado
        Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.tique() }
    }

    static func lerConfig(_ caminho: String) -> (nome: String, porta: Int) {
        guard let d = FileManager.default.contents(atPath: caminho),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return ("", 9100) }
        let cx = j["conexao"] as? [String: Any]
        return ((cx?["bleNome"] as? String) ?? "", (j["porta"] as? Int) ?? 9100)
    }
    var nomeAlvo: String { Conector.lerConfig(caminhoConfig).nome }

    // ---------- conexão ----------
    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        switch c.state {
        case .poweredOn: procurar()
        case .unauthorized: registrar("ERRO sem permissão de Bluetooth: libere em Ajustes do Sistema, Privacidade e Segurança, Bluetooth")
        case .poweredOff: registrar("Bluetooth do computador está desligado")
        default: break
        }
    }

    func procurar() {
        guard central.state == .poweredOn, impressora == nil else { return }
        if nomeAlvo.isEmpty { registrar("sem impressora escolhida (conexao.bleNome vazio); aguardando"); return }
        registrar("procurando a impressora \(nomeAlvo)")
        central.scanForPeripherals(withServices: nil, options: nil)
    }

    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        let nome = p.name ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? ""
        guard !nomeAlvo.isEmpty, nome == nomeAlvo, impressora == nil else { return }
        c.stopScan()
        impressora = p
        p.delegate = self
        registrar("achei \(nome); conectando")
        c.connect(p, options: nil)
    }

    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
        canal = nil
        p.discoverServices(nil)
    }

    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        registrar("falha ao conectar: \(error?.localizedDescription ?? "sem detalhe")")
        reiniciarBusca()
    }

    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        registrar("a impressora desconectou; reconectando")
        bomba?.invalidate(); bomba = nil
        if let id = idTrabalho, !(retomar && tentativas < 2) { confirmar(id, ok: false, erro: "a impressora desconectou no meio do envio"); retomar = false }
        reiniciarBusca()
    }

    func reiniciarBusca() {
        impressora = nil; canal = nil; canalInfo = nil; pulsoPedido = nil; estado = nil; jaRespondeu = false
        if !retomar { ocupado = false; idTrabalho = nil }
        informar()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.procurar() }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        let servicos = p.services ?? []
        servicosPendentes = servicos.count
        if servicos.isEmpty { registrar("a impressora não mostrou serviços"); central.cancelPeripheralConnection(p); return }
        for s in servicos { p.discoverCharacteristics(nil, for: s) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        servicosPendentes -= 1
        guard servicosPendentes == 0, canal == nil else { return }
        // primeiro serviço (na ordem anunciada) que tenha canal de escrita; prefere escrita sem resposta
        for servico in p.services ?? [] {
            let cs = servico.characteristics ?? []
            if let c = cs.first(where: { $0.properties.contains(.writeWithoutResponse) }) ?? cs.first(where: { $0.properties.contains(.write) }) {
                canal = c
                break
            }
        }
        if let c = canal {
            // assina os canais de resposta: é por eles que a impressora devolve o estado
            for servico in p.services ?? [] {
                for ch in servico.characteristics ?? [] where ch.properties.contains(.notify) || ch.properties.contains(.indicate) {
                    p.setNotifyValue(true, for: ch)
                }
            }
            estado = nil; jaRespondeu = false; estadoQuando = .distantPast; consultasSemResposta = 0
            registrar("conectada em \(p.name ?? "impressora") (canal \(c.uuid.uuidString)); consultando o estado")
            consultarEstado()
            // identificação do módulo Bluetooth (modelo, versão), só para o registro
            let legiveis = (p.services ?? []).flatMap({ $0.characteristics ?? [] }).filter { $0.properties.contains(.read) && $0.uuid.uuidString.hasPrefix("2A") }
            canalInfo = legiveis.first
            if !jaIdentificou { for ch in legiveis { p.readValue(for: ch) }; DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.jaIdentificou = true } }
            // trabalho interrompido por ligação morta: manda de novo, do começo
            if retomar, idTrabalho != nil {
                retomar = false; tentativas += 1; posicao = 0; ultimoAvanco = Date(); inicioEnvio = Date()
                registrar("reenviando a etiqueta depois de reconectar")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.escrever() }
            }
        } else {
            registrar("a impressora não mostrou canal de escrita")
            central.cancelPeripheralConnection(p)
        }
    }

    // ---------- estado ----------
    func consultarEstado() {
        guard let p = impressora, let c = canal, idTrabalho == nil else { return }
        if !jaRespondeu { consultasSemResposta += 1; if consultasSemResposta > 3 { return } } // este modelo não informa estado por Bluetooth
        consultaQuando = Date()
        p.writeValue(Data([0x1B, 0x21, 0x3F]), for: c, type: c.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse)
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        pulsoPedido = nil // qualquer resposta prova que a ligação está viva
        guard let v = ch.value, let b = v.first else { return }
        if ch.uuid.uuidString.hasPrefix("2A2") && jaIdentificou { return } // leitura de sinal de vida: não polui o registro
        if v.count != 1 || ch.uuid.uuidString.hasPrefix("2A2") {
            let texto = String(data: v, encoding: .utf8)?.trimmingCharacters(in: .controlCharacters) ?? ""
            registrar("resposta em \(ch.uuid.uuidString) (\(v.count) bytes): " + v.prefix(40).map { String(format: "%02x", $0) }.joined(separator: " ") + (texto.isEmpty ? "" : " = \(texto)"))
            return
        }
        registrar("byte de estado em \(ch.uuid.uuidString): 0x\(String(b, radix: 16))")
        if estado != Int(b) || !jaRespondeu { registrar("estado da impressora: 0x\(String(b, radix: 16)) (\(v.count) byte(s))") }
        estado = Int(b); estadoQuando = Date(); jaRespondeu = true
        informar()
    }

    // conta para a ponte o que a impressora respondeu (ou que não respondeu)
    func informar() {
        guard let url = URL(string: "\(ponte)/api/ble/estado") else { return }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        let respondeAgora = jaRespondeu && Date().timeIntervalSince(estadoQuando) < 15
        var corpo: [String: Any] = ["conectada": canal != nil, "nome": impressora?.name ?? nomeAlvo, "jaRespondeu": jaRespondeu, "respondeAgora": respondeAgora]
        if let e = estado, respondeAgora { corpo["estado"] = e }
        r.httpBody = try? JSONSerialization.data(withJSONObject: corpo)
        URLSession.shared.dataTask(with: r).resume()
    }

    // ---------- trabalhos ----------
    func tique() {
        // envio parado há mais de 4 s: a ligação morreu. Reconecta e manda de novo, sem falhar o trabalho
        if idTrabalho != nil, Date().timeIntervalSince(ultimoAvanco) > 4, let p = impressora {
            registrar("envio parado; reiniciando a conexão para mandar de novo")
            retomar = true
            central.cancelPeripheralConnection(p)
            return
        }
        contador += 1
        // sinal de vida a cada 10 s: depois de horas parada a ligação pode estar morta sem avisar,
        // e a primeira etiqueta ficava esperando. Uma leitura sem resposta em 3 s força a reconexão.
        if idTrabalho == nil, canal != nil, let p = impressora {
            if let pedido = pulsoPedido, Date().timeIntervalSince(pedido) > 3 {
                registrar("a impressora não respondeu ao sinal de vida; reconectando")
                pulsoPedido = nil
                central.cancelPeripheralConnection(p)
                return
            }
            if contador % 10 == 0, pulsoPedido == nil, let ch = canalInfo { pulsoPedido = Date(); p.readValue(for: ch) }
        }
        if contador % 3 == 0 { informar() }
        guard canal != nil, !ocupado else { return }
        if contador % 4 == 0 { consultarEstado() }
        guard let url = URL(string: "\(ponte)/api/ble/proximo") else { return }
        ocupado = true
        URLSession.shared.dataTask(with: url) { [weak self] d, _, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard let d = d, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                      let id = j["id"] as? Int, let b64 = j["dados"] as? String, let bytes = Data(base64Encoded: b64) else {
                    self.ocupado = false
                    return
                }
                self.idTrabalho = id; self.dados = bytes; self.posicao = 0; self.ultimoAvanco = Date(); self.inicioEnvio = Date(); self.tentativas = 0
                registrar("enviando etiqueta \(id) (\(bytes.count) bytes)")
                self.escrever()
            }
        }.resume()
    }

    // Envio com teto de velocidade. O Bluetooth do computador consegue mandar ~40 KB por segundo,
    // mas o módulo da impressora repassa os dados por uma serial lenta: nessa velocidade ele
    // perde bytes e nada imprime (a impressora fica esperando o resto da imagem). O ritmo abaixo
    // (10 KB por segundo, uns 8 s por etiqueta) é o que comprovadamente imprime.
    let bytesPorSegundo = 10_000.0
    var bomba: Timer?
    func escrever() {
        bomba?.invalidate()
        bomba = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { [weak self] _ in self?.bombear() }
    }
    func bombear() {
        guard let p = impressora, let c = canal, let id = idTrabalho else { bomba?.invalidate(); bomba = nil; return }
        let semResposta = c.properties.contains(.writeWithoutResponse)
        let tamanho = max(20, min(180, p.maximumWriteValueLength(for: semResposta ? .withoutResponse : .withResponse)))
        // quanto já poderia ter saído até agora, pelo teto de velocidade
        let permitido = Int(Date().timeIntervalSince(inicioEnvio) * bytesPorSegundo) + tamanho
        while posicao < dados.count && posicao < permitido {
            if semResposta && !p.canSendWriteWithoutResponse { return } // tenta de novo no próximo tique
            let fim = min(posicao + tamanho, dados.count)
            p.writeValue(dados.subdata(in: posicao..<fim), for: c, type: semResposta ? .withoutResponse : .withResponse)
            posicao = fim
            ultimoAvanco = Date()
            if !semResposta { return } // retoma em didWriteValueFor
        }
        guard posicao >= dados.count else { return }
        bomba?.invalidate(); bomba = nil
        registrar("etiqueta \(id) enviada (\(dados.count) bytes em \(String(format: "%.1f", Date().timeIntervalSince(inicioEnvio))) s)")
        confirmar(id, ok: true, erro: "")
    }

    func peripheralIsReady(toSendWriteWithoutResponse p: CBPeripheral) {}

    func peripheral(_ p: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        if let e = error, let id = idTrabalho { bomba?.invalidate(); bomba = nil; confirmar(id, ok: false, erro: e.localizedDescription); return }
        if idTrabalho != nil { bombear() }
    }

    func confirmar(_ id: Int, ok: Bool, erro: String) {
        idTrabalho = nil
        guard let url = URL(string: "\(ponte)/api/ble/feito") else { ocupado = false; return }
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id, "ok": ok, "erro": erro])
        URLSession.shared.dataTask(with: r) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.ocupado = false }
        }.resume()
    }
}

guard CommandLine.arguments.count > 1 else {
    print("uso: conector-bluetooth <caminho do config.json>")
    exit(2)
}
let conector = Conector(caminhoConfig: CommandLine.arguments[1])
RunLoop.main.run()
