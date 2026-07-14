import Foundation

@MainActor
final class DaemonClient: ObservableObject {
    @Published var daemonURLString: String {
        didSet {
            UserDefaults.standard.set(daemonURLString, forKey: Self.daemonURLKey)
        }
    }
    @Published var status = StatusResponse(
        connected: false,
        hint: "Start the daemon, choose an exit, then connect.",
        connectedAt: nil,
        exit: nil,
        socks: nil,
        http: nil,
        traffic: nil
    )
    @Published var exits: [ExitNode] = []
    @Published var selectedExitID: String?
    @Published var errorMessage: String?
    @Published var isLoading = false

    private static let daemonURLKey = "daemon_url"
    private let decoder = JSONDecoder()

    init() {
        daemonURLString = UserDefaults.standard.string(forKey: Self.daemonURLKey) ?? "http://127.0.0.1:17888"
    }

    func refresh() async {
        await run {
            async let status: StatusResponse = request("/api/status")
            async let catalog: ExitCatalog = request("/api/exits")
            let loadedStatus = try await status
            let loadedCatalog = try await catalog
            self.status = loadedStatus
            self.exits = loadedCatalog.exits
        }
    }

    func connect() async {
        await run {
            var payload: [String: Any] = [:]
            if let selectedExitID, !selectedExitID.isEmpty {
                payload["exit_id"] = selectedExitID
            }
            self.status = try await request("/api/connect", method: "POST", body: payload)
            await self.refresh()
        }
    }

    func disconnect() async {
        await run {
            let _: StatusResponse = try await request("/api/disconnect", method: "POST", body: [:])
            await self.refresh()
        }
    }

    private func run(_ operation: @escaping () async throws -> Void) async {
        isLoading = true
        errorMessage = nil
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let baseURL = URL(string: normalizedDaemonURL()) else {
            throw DaemonError.invalidURL
        }
        let cleanPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let url = baseURL.appendingPathComponent(cleanPath)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw DaemonError.badResponse
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw DaemonError.http(httpResponse.statusCode, decodeError(from: data))
        }
        return try decoder.decode(T.self, from: data)
    }

    private func normalizedDaemonURL() -> String {
        var value = daemonURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            value = "http://127.0.0.1:17888"
        }
        if !value.hasPrefix("http://") && !value.hasPrefix("https://") {
            value = "http://" + value
        }
        while value.hasSuffix("/") {
            value.removeLast()
        }
        return value
    }

    private func decodeError(from data: Data) -> String? {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let error = json["error"] as? String
        else {
            return nil
        }
        return error
    }
}

enum DaemonError: LocalizedError {
    case invalidURL
    case badResponse
    case http(Int, String?)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Daemon URL is invalid."
        case .badResponse:
            return "Daemon returned an invalid response."
        case .http(let status, let message):
            return message ?? "Daemon returned HTTP \(status)."
        }
    }
}
