import Foundation

struct ExitCatalog: Decodable {
    let exits: [ExitNode]
}

struct ExitNode: Decodable, Identifiable, Equatable {
    let id: String
    let name: String?
    let region: String?
    let city: String?
    let latencyMs: Int?
    let load: Double?
    let protocolName: String?
    let residential: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case region
        case city
        case latencyMs = "latency_ms"
        case load
        case protocolName = "protocol"
        case residential
    }
}

struct StatusResponse: Decodable {
    let connected: Bool
    let hint: String?
    let connectedAt: String?
    let exit: ExitNode?
    let socks: ProxyEndpoint?
    let http: ProxyEndpoint?
    let traffic: TrafficSnapshot?

    enum CodingKeys: String, CodingKey {
        case connected
        case hint
        case connectedAt = "connected_at"
        case exit
        case socks
        case http
        case traffic
    }
}

struct ProxyEndpoint: Decodable {
    let host: String
    let port: Int
}

struct TrafficSnapshot: Decodable {
    let bytesIn: Int?
    let bytesOut: Int?
    let bytesTotal: Int?
    let estimatedMrgCost: Double?

    enum CodingKeys: String, CodingKey {
        case bytesIn = "bytes_in"
        case bytesOut = "bytes_out"
        case bytesTotal = "bytes_total"
        case estimatedMrgCost = "estimated_mrg_cost"
    }
}
