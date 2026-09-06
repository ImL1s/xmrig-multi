//! Hardware capability probe (#33).
//! Prefer platform APIs over external commands. Missing values stay null — never fake 0.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field<T: Serialize> {
    pub value: Option<T>,
    pub source: String,
    pub timestamp: String,
    pub confidence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_reason: Option<String>,
}

impl<T: Serialize> Field<T> {
    fn known(value: T, source: &str, confidence: &str) -> Self {
        Self {
            value: Some(value),
            source: source.to_string(),
            timestamp: now_iso(),
            confidence: confidence.to_string(),
            unknown_reason: None,
        }
    }

    fn unknown(source: &str, reason: &str) -> Self {
        Self {
            value: None,
            source: source.to_string(),
            timestamp: now_iso(),
            confidence: "unknown".to_string(),
            unknown_reason: Some(reason.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreGroup {
    pub kind: String,
    pub logical_ids: Vec<u32>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreGroupsField {
    pub value: Option<Vec<CoreGroup>>,
    pub source: String,
    pub timestamp: String,
    pub confidence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    pub schema_version: u32,
    pub captured_at: String,
    pub evidence_kind: String,
    pub platform: PlatformInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub power: PowerInfo,
    pub sensors: SensorsInfo,
    pub engine: EngineInfo,
    pub invalidation_hints: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub os_version: Field<String>,
    pub arch: String,
    pub abi: Field<String>,
    pub container_or_vm: Field<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: Field<String>,
    pub logical: Field<u32>,
    pub physical: Field<u32>,
    pub allowed: Field<u32>,
    pub smt: Field<bool>,
    pub heterogeneous: Field<bool>,
    pub core_groups: CoreGroupsField,
    pub cache: CacheInfo,
    pub numa_nodes: Field<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub l2_bytes: Field<u64>,
    pub l3_bytes: Field<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_bytes: Field<u64>,
    pub available_bytes: Field<u64>,
    pub process_limit_bytes: Field<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerInfo {
    pub on_ac: Field<bool>,
    pub battery_present: Field<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorsInfo {
    pub thermal_readable: Field<bool>,
    pub power_readable: Field<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub abi_supported: Field<bool>,
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedHardwareReport {
    pub schema_version: u32,
    pub report_kind: String,
    pub redacted: bool,
    pub generated_at: String,
    pub snapshot: HardwareSnapshot,
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}Z")
}

pub fn capture_hardware_snapshot() -> HardwareSnapshot {
    let logical = num_cpus::get() as u32;
    let physical = num_cpus::get_physical() as u32;
    let smt = if physical > 0 && logical > physical {
        Field::known(true, "logical-vs-physical", "medium")
    } else if physical > 0 && logical == physical {
        Field::known(false, "logical-vs-physical", "low")
    } else {
        Field::unknown("logical-vs-physical", "counts-unavailable")
    };

    let (mem_total, mem_avail) = memory_bytes();
    let cpu_name = cpu_name();
    let os_version = os_version();
    let allowed = allowed_cpus(logical);
    let arch = std::env::consts::ARCH.to_string();
    let abi_supported = !matches!(arch.as_str(), "x86" | "arm");

    let mut flags = vec!["desktop-live-probe".to_string()];
    if logical > 64 {
        flags.push("gt64-logical".to_string());
    }

    HardwareSnapshot {
        schema_version: 1,
        captured_at: now_iso(),
        evidence_kind: "live".to_string(),
        platform: PlatformInfo {
            os: std::env::consts::OS.to_string(),
            os_version,
            arch: arch.clone(),
            abi: Field::known(arch, "std::env::consts::ARCH", "high"),
            container_or_vm: detect_container(),
        },
        cpu: CpuInfo {
            name: cpu_name,
            logical: Field::known(logical.max(1), "num_cpus::get", "high"),
            physical: if physical > 0 {
                Field::known(physical, "num_cpus::get_physical", "medium")
            } else {
                Field::unknown("num_cpus::get_physical", "unavailable")
            },
            allowed,
            smt,
            heterogeneous: Field::unknown("topology", "not-probed-without-privileged-api"),
            core_groups: CoreGroupsField {
                value: None,
                source: "topology".to_string(),
                timestamp: now_iso(),
                confidence: "unknown".to_string(),
                unknown_reason: Some("not-probed-without-privileged-api".to_string()),
            },
            cache: CacheInfo {
                l2_bytes: Field::unknown("cache", "not-probed"),
                l3_bytes: Field::unknown("cache", "not-probed"),
            },
            numa_nodes: Field::unknown("numa", "not-probed"),
        },
        memory: MemoryInfo {
            total_bytes: mem_total,
            available_bytes: mem_avail,
            process_limit_bytes: process_memory_limit(),
        },
        power: PowerInfo {
            on_ac: Field::unknown("power", "not-probed"),
            battery_present: Field::unknown("power", "not-probed"),
        },
        sensors: SensorsInfo {
            thermal_readable: Field::known(false, "capability", "medium"),
            power_readable: Field::known(false, "capability", "medium"),
        },
        engine: EngineInfo {
            abi_supported: Field::known(abi_supported, "arch-gate", "high"),
            flags,
        },
        invalidation_hints: vec![
            "cpuset-change".to_string(),
            "hotplug".to_string(),
            "power-source-change".to_string(),
            "memory-pressure".to_string(),
        ],
    }
}

pub fn sanitize_hardware_report(mut snap: HardwareSnapshot) -> SanitizedHardwareReport {
    // Snapshot fields are already non-identifying; ensure CPU name has no host suffix.
    if let Some(ref mut name) = snap.cpu.name.value {
        if let Some((model, _)) = name.split_once('@') {
            *name = model.trim().to_string();
        }
    }
    SanitizedHardwareReport {
        schema_version: 1,
        report_kind: "hardware-capability".to_string(),
        redacted: true,
        generated_at: now_iso(),
        snapshot: snap,
    }
}

fn memory_bytes() -> (Field<u64>, Field<u64>) {
    #[cfg(target_os = "windows")]
    {
        if let Some((total, avail)) = windows_memory_status() {
            return (
                Field::known(total, "GlobalMemoryStatusEx", "high"),
                Field::known(avail, "GlobalMemoryStatusEx", "high"),
            );
        }
        // Optional legacy fallback — never required.
        if let Some(total) = wmic_memory_bytes("TotalVisibleMemorySize") {
            let avail = wmic_memory_bytes("FreePhysicalMemory");
            return (
                Field::known(total, "wmic-fallback", "low"),
                avail
                    .map(|v| Field::known(v, "wmic-fallback", "low"))
                    .unwrap_or_else(|| Field::unknown("wmic-fallback", "external-command-missing")),
            );
        }
        return (
            Field::unknown("GlobalMemoryStatusEx", "win32-call-failed"),
            Field::unknown("GlobalMemoryStatusEx", "win32-call-failed"),
        );
    }
    #[cfg(target_os = "linux")]
    {
        let total = parse_meminfo_kb("MemTotal:")
            .map(|v| Field::known(v, "/proc/meminfo", "high"))
            .unwrap_or_else(|| Field::unknown("/proc/meminfo", "unreadable"));
        let avail = parse_meminfo_kb("MemAvailable:")
            .map(|v| Field::known(v, "/proc/meminfo", "high"))
            .unwrap_or_else(|| Field::unknown("/proc/meminfo", "unreadable"));
        return (total, avail);
    }
    #[cfg(target_os = "macos")]
    {
        let total = sysctl_u64("hw.memsize")
            .map(|v| Field::known(v, "sysctl:hw.memsize", "high"))
            .unwrap_or_else(|| Field::unknown("sysctl", "unavailable"));
        // Avoid inventing available = total/2 as fact — leave unknown.
        let avail = Field::unknown("vm_stat", "not-probed");
        return (total, avail);
    }
    #[allow(unreachable_code)]
    (
        Field::unknown("memory", "unsupported-os"),
        Field::unknown("memory", "unsupported-os"),
    )
}

fn process_memory_limit() -> Field<u64> {
    #[cfg(target_os = "linux")]
    {
        // cgroup v2
        if let Ok(text) = std::fs::read_to_string("/sys/fs/cgroup/memory.max") {
            let t = text.trim();
            if t != "max" {
                if let Ok(v) = t.parse::<u64>() {
                    return Field::known(v, "cgroup.memory.max", "high");
                }
            }
        }
        return Field::unknown("cgroup", "no-limit-or-unreadable");
    }
    #[allow(unreachable_code)]
    Field::unknown("process-limit", "not-probed")
}

fn allowed_cpus(logical: u32) -> Field<u32> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
            if let Some(line) = status.lines().find(|l| l.starts_with("Cpus_allowed_list:")) {
                if let Some(list) = line.split(':').nth(1) {
                    if let Some(count) = count_cpu_list(list.trim()) {
                        return Field::known(count, "/proc/self/status:Cpus_allowed_list", "high");
                    }
                }
            }
        }
        return Field::known(logical.max(1), "assume-all-logical", "low");
    }
    #[allow(unreachable_code)]
    Field::known(logical.max(1), "assume-all-logical", "low")
}

#[cfg(target_os = "linux")]
fn count_cpu_list(list: &str) -> Option<u32> {
    let mut total = 0u32;
    for part in list.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let start: u32 = a.parse().ok()?;
            let end: u32 = b.parse().ok()?;
            if end >= start {
                total = total.saturating_add(end - start + 1);
            }
        } else {
            let _: u32 = part.parse().ok()?;
            total = total.saturating_add(1);
        }
    }
    if total > 0 {
        Some(total)
    } else {
        None
    }
}

fn detect_container() -> Field<bool> {
    #[cfg(target_os = "linux")]
    {
        if std::path::Path::new("/.dockerenv").exists() {
            return Field::known(true, "/.dockerenv", "high");
        }
        if let Ok(cgroup) = std::fs::read_to_string("/proc/1/cgroup") {
            if cgroup.contains("docker") || cgroup.contains("containerd") || cgroup.contains("kubepods") {
                return Field::known(true, "/proc/1/cgroup", "medium");
            }
        }
        return Field::known(false, "container-heuristics", "low");
    }
    #[allow(unreachable_code)]
    Field::unknown("container", "not-probed")
}

fn cpu_name() -> Field<String> {
    #[cfg(target_os = "macos")]
    {
        return std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(|s| Field::known(s, "sysctl:machdep.cpu.brand_string", "high"))
            .unwrap_or_else(|| Field::unknown("sysctl", "unavailable"));
    }
    #[cfg(target_os = "linux")]
    {
        return std::fs::read_to_string("/proc/cpuinfo")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("model name") || l.starts_with("Hardware"))
                    .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .map(|s| Field::known(s, "/proc/cpuinfo", "high"))
            .unwrap_or_else(|| Field::unknown("/proc/cpuinfo", "unreadable"));
    }
    #[cfg(target_os = "windows")]
    {
        // Do not require wmic. Optional registry-free: try env / leave unknown.
        if let Some(name) = wmic_cpu_name() {
            return Field::known(name, "wmic-optional", "low");
        }
        return Field::unknown("cpu-name", "external-command-missing");
    }
    #[allow(unreachable_code)]
    Field::unknown("cpu-name", "unsupported-os")
}

fn os_version() -> Field<String> {
    #[cfg(target_os = "macos")]
    {
        return std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(|s| Field::known(s, "sw_vers", "high"))
            .unwrap_or_else(|| Field::unknown("sw_vers", "unavailable"));
    }
    #[cfg(target_os = "linux")]
    {
        return std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("PRETTY_NAME="))
                    .map(|l| l.trim_start_matches("PRETTY_NAME=").replace('"', ""))
            })
            .map(|s| Field::known(s, "/etc/os-release", "high"))
            .unwrap_or_else(|| Field::unknown("/etc/os-release", "unreadable"));
    }
    #[cfg(target_os = "windows")]
    {
        // Avoid wmic-only: report generic with low confidence if no better source.
        return Field::known("Windows".to_string(), "std::env::consts::OS", "low");
    }
    #[allow(unreachable_code)]
    Field::unknown("os-version", "unsupported-os")
}

#[cfg(target_os = "linux")]
fn parse_meminfo_kb(label: &str) -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|l| l.starts_with(label))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb.saturating_mul(1024))
}

#[cfg(target_os = "macos")]
fn sysctl_u64(key: &str) -> Option<u64> {
    std::process::Command::new("sysctl")
        .args(["-n", key])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.trim().parse().ok())
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct MemoryStatusEx {
    length: u32,
    memory_load: u32,
    total_phys: u64,
    avail_phys: u64,
    total_page_file: u64,
    avail_page_file: u64,
    total_virtual: u64,
    avail_virtual: u64,
    avail_extended_virtual: u64,
}

#[cfg(target_os = "windows")]
fn windows_memory_status() -> Option<(u64, u64)> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }
    unsafe {
        let mut status = MemoryStatusEx {
            length: std::mem::size_of::<MemoryStatusEx>() as u32,
            memory_load: 0,
            total_phys: 0,
            avail_phys: 0,
            total_page_file: 0,
            avail_page_file: 0,
            total_virtual: 0,
            avail_virtual: 0,
            avail_extended_virtual: 0,
        };
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return None;
        }
        if status.total_phys == 0 {
            return None;
        }
        Some((status.total_phys, status.avail_phys))
    }
}

#[cfg(target_os = "windows")]
fn wmic_memory_bytes(field: &str) -> Option<u64> {
    let output = std::process::Command::new("wmic")
        .args(["OS", "get", field, "/value"])
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().find(|l| l.starts_with(&format!("{field}=")))?;
    let kb: u64 = line.split('=').nth(1)?.trim().parse().ok()?;
    Some(kb.saturating_mul(1024))
}

#[cfg(target_os = "windows")]
fn wmic_cpu_name() -> Option<String> {
    let output = std::process::Command::new("wmic")
        .args(["cpu", "get", "Name", "/value"])
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    text.lines()
        .find(|l| l.starts_with("Name="))
        .map(|l| l.trim_start_matches("Name=").trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_never_fakes_unknown_memory_as_zero() {
        let snap = capture_hardware_snapshot();
        assert_eq!(snap.schema_version, 1);
        assert_eq!(snap.evidence_kind, "live");
        if snap.memory.total_bytes.confidence == "unknown" {
            assert!(snap.memory.total_bytes.value.is_none());
        }
        if snap.cpu.cache.l3_bytes.confidence == "unknown" {
            assert!(snap.cpu.cache.l3_bytes.value.is_none());
        }
        assert!(snap.cpu.logical.value.unwrap_or(0) >= 1);
    }

    #[test]
    fn sanitized_report_is_redacted() {
        let report = sanitize_hardware_report(capture_hardware_snapshot());
        assert!(report.redacted);
        assert_eq!(report.report_kind, "hardware-capability");
    }
}
