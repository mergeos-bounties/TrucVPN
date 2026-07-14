import SwiftUI

struct ContentView: View {
    @StateObject private var client = DaemonClient()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    statusPanel
                    daemonPanel
                    exitsPanel
                    if let error = client.errorMessage {
                        Text(error)
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.red)
                            .padding(.top, 4)
                    }
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("TrucVPN")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await client.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(client.isLoading)
                }
            }
            .task {
                await client.refresh()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Secure native control")
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(.primary)
            Text("Connect to MRGMinner residential exits through the local TrucVPN daemon.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 8)
    }

    private var statusPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Circle()
                    .fill(client.status.connected ? Color.green : Color.red)
                    .frame(width: 12, height: 12)
                Text(client.status.connected ? "Protected" : "Disconnected")
                    .font(.title2.weight(.bold))
                Spacer()
                if client.isLoading {
                    ProgressView()
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                statusRow("Exit", client.status.exit?.name ?? client.status.hint ?? "Choose an exit")
                statusRow("SOCKS5", endpoint(client.status.socks, fallback: "127.0.0.1:17880"))
                statusRow("HTTP", endpoint(client.status.http, fallback: "127.0.0.1:17881"))
                statusRow("Traffic", "\(client.status.traffic?.bytesTotal ?? 0) bytes")
                statusRow("MRG", "\(client.status.traffic?.estimatedMrgCost ?? 0)")
            }

            HStack(spacing: 10) {
                Button("Connect") {
                    Task { await client.connect() }
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(client.status.connected || client.isLoading)

                Button("Disconnect") {
                    Task { await client.disconnect() }
                }
                .buttonStyle(.bordered)
                .disabled(!client.status.connected || client.isLoading)
            }
        }
        .panel()
    }

    private var daemonPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Daemon")
                .font(.headline)
            TextField("http://127.0.0.1:17888", text: $client.daemonURLString)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
            Text("Use your Mac IP instead of 127.0.0.1 when testing on a physical iPhone.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .panel()
    }

    private var exitsPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Exits")
                .font(.headline)
            ForEach(client.exits) { exit in
                Button {
                    client.selectedExitID = exit.id
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(exit.name ?? exit.id)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.primary)
                            Text("\(exit.id) - \(exit.region ?? "auto") - \(exit.protocolName ?? "proxy")")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Text(exit.residential == true ? "Residential exit" : "Local direct")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.green)
                        }
                        Spacer()
                        if client.selectedExitID == exit.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color(.secondarySystemGroupedBackground))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(client.selectedExitID == exit.id ? Color.green : Color.clear, lineWidth: 2)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .panel()
    }

    private func statusRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.semibold)
                .multilineTextAlignment(.trailing)
        }
        .font(.callout)
    }

    private func endpoint(_ endpoint: ProxyEndpoint?, fallback: String) -> String {
        guard let endpoint else {
            return fallback
        }
        return "\(endpoint.host):\(endpoint.port)"
    }
}

private extension View {
    func panel() -> some View {
        self
            .padding(16)
            .background(Color(.systemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
