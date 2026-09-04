import SwiftUI
import WidgetKit

struct MiningComplication: Widget {
    let kind: String = "MiningComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MiningTimelineProvider()) { entry in
            ComplicationView(entry: entry)
        }
        .configurationDisplayName("Mining Stats")
        .description("View your mining hashrate and status")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
            .accessoryCorner
        ])
    }
}

struct MiningEntry: TimelineEntry {
    let date: Date
    let hashrate: Double
    let isRunning: Bool
}

struct MiningTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> MiningEntry {
        MiningEntry(date: Date(), hashrate: 0.0, isRunning: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (MiningEntry) -> Void) {
        let snapshot = MiningSnapshotStore.load()
        completion(MiningEntry(date: Date(), hashrate: snapshot.hashrate, isRunning: snapshot.isRunning))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MiningEntry>) -> Void) {
        let snapshot = MiningSnapshotStore.load()
        let entry = MiningEntry(date: Date(), hashrate: snapshot.hashrate, isRunning: snapshot.isRunning)
        let timeline = Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(60)))
        completion(timeline)
    }
}

struct ComplicationView: View {
    let entry: MiningEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            CircularComplication(entry: entry)
        case .accessoryRectangular:
            RectangularComplication(entry: entry)
        case .accessoryInline:
            InlineComplication(entry: entry)
        case .accessoryCorner:
            CornerComplication(entry: entry)
        default:
            CircularComplication(entry: entry)
        }
    }
}

struct CircularComplication: View {
    let entry: MiningEntry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 2) {
                Image(systemName: entry.isRunning ? "bolt.fill" : "bolt.slash")
                    .font(.caption)
                    .foregroundColor(entry.isRunning ? .purple : .gray)
                Text(String(format: "%.0f", entry.hashrate))
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                Text("H/s")
                    .font(.system(size: 8))
                    .foregroundColor(.gray)
            }
        }
    }
}

struct RectangularComplication: View {
    let entry: MiningEntry

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(entry.isRunning ? Color.green : Color.gray)
                        .frame(width: 6, height: 6)
                    Text(entry.isRunning ? "Mining" : "Stopped")
                        .font(.caption2)
                }
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(String(format: "%.1f", entry.hashrate))
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundColor(.purple)
                    Text("H/s")
                        .font(.caption2)
                        .foregroundColor(.gray)
                }
            }
            Spacer()
        }
    }
}

struct InlineComplication: View {
    let entry: MiningEntry

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: entry.isRunning ? "bolt.fill" : "bolt.slash")
            Text(String(format: "%.1f H/s", entry.hashrate))
        }
    }
}

struct CornerComplication: View {
    let entry: MiningEntry

    var body: some View {
        VStack {
            Text(String(format: "%.0f", entry.hashrate))
                .font(.system(size: 20, weight: .bold, design: .rounded))
            Text("H/s")
                .font(.system(size: 10))
        }
        .foregroundColor(entry.isRunning ? .purple : .gray)
    }
}

#Preview("Circular") {
    ComplicationView(entry: MiningEntry(date: Date(), hashrate: 125.5, isRunning: true))
        .previewContext(WidgetPreviewContext(family: .accessoryCircular))
}

#Preview("Rectangular") {
    ComplicationView(entry: MiningEntry(date: Date(), hashrate: 125.5, isRunning: true))
        .previewContext(WidgetPreviewContext(family: .accessoryRectangular))
}
