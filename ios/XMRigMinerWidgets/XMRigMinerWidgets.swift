import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct XMRigMinerWidgets: WidgetBundle {
    var body: some Widget {
        MiningGlanceWidget()
        MiningStandByWidget()
        MiningLiveActivity()
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
        let next = GlanceSnapshotStore.nextMinuteAlignedDate()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct MiningGlanceWidget: Widget {
    let kind = "MiningGlanceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GlanceTimelineProvider()) { entry in
            GlanceWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "xmrigmulti://glance"))
        }
        .configurationDisplayName("XMRig Multi glance")
        .description("Snapshot of mining status — not a live miner or background CPU host.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct MiningStandByWidget: Widget {
    let kind = "MiningStandByWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: GlanceTimelineProvider()) { entry in
            StandByGlanceView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "xmrigmulti://glance"))
        }
        .configurationDisplayName("XMRig StandBy glance")
        .description("StandBy / Lock Screen snapshot. Does not keep the screen on or mine in the widget.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

struct MiningLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MiningGlanceAttributes.self) { context in
            LiveActivityBanner(state: context.state)
                .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(liveTitle(context.state))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(hashrateLabel(context.state) ?? "—")
                        .monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.syncQuality.uppercased())
                        .font(.caption2)
                }
            } compactLeading: {
                Image(systemName: context.state.syncQuality == "live" ? "bolt.fill" : "bolt.slash")
            } compactTrailing: {
                Text(String(format: "%.0f", context.state.hashrateHs))
                    .monospacedDigit()
            } minimal: {
                Image(systemName: context.state.syncQuality == "live" ? "bolt.fill" : "bolt.slash")
            }
        }
    }
}

struct LiveActivityBanner: View {
    let state: MiningGlanceAttributes.ContentState

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(liveTitle(state)).font(.headline)
                if let hs = hashrateLabel(state) {
                    Text(hs).font(.title3.monospacedDigit())
                }
                Text(state.syncQuality.uppercased())
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }
}

private func liveTitle(_ state: MiningGlanceAttributes.ContentState) -> String {
    let base: String
    switch state.status {
    case "mining": base = "Mining"
    case "paused": base = "Paused"
    case "waiting": base = "Waiting"
    default: base = "Stopped"
    }
    return state.syncQuality == "live" ? base : "\(base) · snapshot"
}

private func hashrateLabel(_ state: MiningGlanceAttributes.ContentState) -> String? {
    if state.syncQuality == "offline" { return nil }
    let value = String(format: "%.1f H/s", state.hashrateHs)
    return state.syncQuality == "live" ? value : "\(value) (not live)"
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
            Button(intent: OpenMinerIntent()) {
                Text("Open app")
                    .font(.caption2)
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
                    if present.live {
                        Text(String(format: "%.0f", entry.snapshot.hashrateHs))
                            .font(.caption2.monospacedDigit())
                    } else {
                        Text("—")
                            .font(.caption2)
                    }
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
    static var description = IntentDescription(
        "Opens the miner app glance screen. Does not bypass Stop or start mining."
    )
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        .result()
    }
}
