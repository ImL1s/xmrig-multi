import SwiftUI
import WidgetKit
import AppIntents

@main
struct XMRigMinerWidgets: WidgetBundle {
    var body: some Widget {
        MiningGlanceWidget()
        MiningStandByWidget()
    }
}

struct GlanceEntry: TimelineEntry {
    let date: Date
    let snapshot: GlanceSnapshotStore.Snapshot
}

struct GlanceTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> GlanceEntry {
        GlanceEntry(
            date: Date(),
            snapshot: .init(
                status: "stopped",
                hashrateHs: 0,
                lastUpdatedAtMs: 0,
                sessionId: nil,
                sourceDeviceId: nil,
                syncQuality: "offline",
                clockOnly: false,
                todayKwh: nil,
                todayCostFiat: nil
            )
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        completion(GlanceEntry(date: Date(), snapshot: GlanceSnapshotStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        let snap = GlanceSnapshotStore.load()
        let entry = GlanceEntry(date: Date(), snapshot: snap)
        // Minute-aligned — never per-second hashrate polling (#78).
        let next = Calendar.current.date(byAdding: .minute, value: 1, to: Date()) ?? Date().addingTimeInterval(60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct MiningGlanceWidget: Widget {
    let kind = "MiningGlanceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GlanceTimelineProvider()) { entry in
            GlanceWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("XMRig Multi glance")
        .description("Snapshot of mining status — not a live miner or background CPU host.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

/// Lock Screen / StandBy accessory families (iPhone iOS 17+ StandBy when charging).
struct MiningStandByWidget: Widget {
    let kind = "MiningStandByWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GlanceTimelineProvider()) { entry in
            StandByGlanceView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("XMRig StandBy glance")
        .description("StandBy / Lock Screen snapshot. Does not keep the screen on or mine in the widget.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

struct GlanceWidgetView: View {
    let entry: GlanceEntry

    var body: some View {
        let present = GlanceSnapshotStore.presentation(for: entry.snapshot)
        VStack(alignment: .leading, spacing: 6) {
            Text(present.title)
                .font(.headline)
            if let hs = present.hashrate {
                Text(hs)
                    .font(.title2.monospacedDigit())
            }
            Text(entry.snapshot.syncQuality.uppercased())
                .font(.caption2)
                .foregroundStyle(.secondary)
            if !present.live {
                Text("Not live")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
        .padding(4)
    }
}

struct StandByGlanceView: View {
    let entry: GlanceEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let present = GlanceSnapshotStore.presentation(for: entry.snapshot)
        switch family {
        case .accessoryInline:
            Text("\(present.title) \(present.hashrate ?? "")")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 1) {
                    Image(systemName: present.live ? "bolt.fill" : "bolt.slash")
                    Text(String(format: "%.0f", entry.snapshot.hashrateHs))
                        .font(.caption2.monospacedDigit())
                }
            }
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(present.title).font(.caption)
                if let hs = present.hashrate {
                    Text(hs).font(.caption2.monospacedDigit())
                }
                Text(entry.snapshot.syncQuality).font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// Opens the main app into an authorized flow — does not start mining from the widget.
struct OpenMinerIntent: AppIntent {
    static var title: LocalizedStringResource = "Open XMRig Multi"
    static var description = IntentDescription("Opens the miner app. Does not bypass Stop or start mining.")

    func perform() async throws -> some IntentResult {
        .result()
    }
}
