//
//  ConfigView.swift
//  XMRigMiner-iOS
//
//  Mining configuration view
//

import SwiftUI

struct ConfigView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedCoin: CoinType = .monero
    @State private var walletAddress = ""
    @State private var selectedPool = 0
    @State private var threads = 1
    @State private var cpuPriority = 2
    @State private var workerName = ""
    @State private var validationError: String?

    private var pools: [(String, PoolConfig)] {
        PoolConfig.pools(for: selectedCoin)
    }

    private var maxThreads: Int {
        ProcessInfo.processInfo.processorCount
    }
    
    var body: some View {
        NavigationStack {
            Form {
                // Coin Selection Section
                Section("Cryptocurrency") {
                    Picker("Select Coin", selection: $selectedCoin) {
                        ForEach(CoinType.allCases, id: \.self) { coin in
                            Text(coin.displayName).tag(coin)
                        }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: selectedCoin) { _ in
                        // Reset pool selection and clear wallet when coin changes
                        selectedPool = 0
                        walletAddress = ""
                        validationError = nil
                    }

                    HStack {
                        Text("Algorithm")
                        Spacer()
                        Text(selectedCoin.algorithmDisplay)
                            .foregroundColor(.secondary)
                    }
                }

                // Wallet Section
                Section {
                    TextField(selectedCoin.walletPlaceholder, text: $walletAddress)
                        .font(.system(.body, design: .monospaced))
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .onChange(of: walletAddress) { newValue in
                            validateWallet(newValue)
                        }

                    if let error = validationError {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }

                    TextField("Worker Name (Optional)", text: $workerName)
                        .autocapitalization(.none)
                } header: {
                    Text("Wallet")
                } footer: {
                    Text(selectedCoin.walletHint)
                        .font(.caption)
                }

                // Pool Section
                Section("Pool") {
                    Picker("Select Pool", selection: $selectedPool) {
                        ForEach(0..<pools.count, id: \.self) { index in
                            Text(pools[index].0).tag(index)
                        }
                    }
                    .pickerStyle(.menu)

                    if selectedPool < pools.count {
                        HStack {
                            Text("URL")
                            Spacer()
                            Text(pools[selectedPool].1.url)
                                .foregroundColor(.secondary)
                                .font(.caption)
                        }
                    }
                }

                // Performance Section
                Section {
                    Stepper("Threads: \(threads)", value: $threads, in: 1...min(maxThreads, MiningConfig.iosMaxRecommendedThreads))

                    HStack {
                        Text("CPU priority")
                        Spacer()
                        Stepper("\(cpuPriority)", value: $cpuPriority, in: 0...5)
                    }

                    HStack {
                        Text("CPU Cores")
                        Spacer()
                        Text("\(maxThreads)")
                            .foregroundColor(.secondary)
                    }

                    Text("Requested threads and priority are written into XMRig JSON. Effective threads are capped at \(MiningConfig.iosMaxRecommendedThreads) for iOS memory/thermal budget.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                } header: {
                    Text("Performance")
                }

                // Info Section
                Section {
                    HStack {
                        Text("XMRig Version")
                        Spacer()
                        Text("6.25.0")
                            .foregroundColor(.secondary)
                    }

                    HStack {
                        Text("Mining")
                        Spacer()
                        Text("\(selectedCoin.displayName)")
                            .foregroundColor(.secondary)
                    }
                } header: {
                    Text("Info")
                } footer: {
                    Text("⚠️ Mining consumes significant CPU resources and battery. Use responsibly.")
                        .font(.caption)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saveConfig()
                        dismiss()
                    }
                    .disabled(walletAddress.isEmpty || validationError != nil)
                }
            }
        }
    }

    private func validateWallet(_ address: String) {
        if address.isEmpty {
            validationError = nil
            return
        }

        if !selectedCoin.validateAddress(address) {
            validationError = "Invalid \(selectedCoin.displayName) address"
        } else {
            validationError = nil
        }
    }
    
    private func saveConfig() {
        guard selectedPool < pools.count else { return }

        var pool = pools[selectedPool].1
        pool.user = walletAddress
        pool.coin = selectedCoin
        if !workerName.isEmpty {
            pool.pass = workerName
        }

        let config = MiningConfig(
            pool: pool,
            threads: threads,
            cpuPriority: cpuPriority
        )

        MiningConfigStore.save(config)

        print("Saving config for \(selectedCoin.displayName)")
        if let json = config.toJSON() {
            print("XMRig JSON:\n\(json)")
        }
    }
}

#Preview {
    ConfigView()
}
