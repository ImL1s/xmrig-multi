// XMRig Miner Module - Process Management
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const XMRIG_HTTP_HOST: &str = "127.0.0.1";
const XMRIG_HTTP_PORT: u16 = 37420;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiningConfig {
    pub pool_url: String,
    pub wallet_address: String,
    pub worker_name: String,
    pub threads: u32,
    pub coin_type: String,
    pub algorithm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MiningStats {
    pub hashrate: f64,
    pub hashrate_10s: f64,
    pub hashrate_60s: f64,
    pub hashrate_15m: f64,
    pub shares_accepted: u64,
    pub shares_rejected: u64,
    pub difficulty: u64,
    pub uptime: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub cpu_name: String,
    pub cpu_cores: u32,
    pub cpu_threads: u32,
    pub memory_total: u64,
    pub memory_available: u64,
    pub os_name: String,
    pub os_version: String,
    pub arch: String,
}

pub struct MinerState {
    process: Option<Child>,
    running: Arc<AtomicBool>,
    stats: Arc<Mutex<MiningStats>>,
}

impl MinerState {
    pub fn new() -> Self {
        Self {
            process: None,
            running: Arc::new(AtomicBool::new(false)),
            stats: Arc::new(Mutex::new(MiningStats::default())),
        }
    }

    pub fn start(&mut self, config: MiningConfig) -> Result<String, String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Miner is already running".to_string());
        }
        if config.wallet_address.trim().is_empty() {
            return Err("Wallet address is required".to_string());
        }

        let xmrig_path = get_xmrig_path().ok_or_else(|| {
            "XMRig binary not found. Run desktop/scripts/build-xmrig.sh and place it in src-tauri/binaries/".to_string()
        })?;

        let mut cmd = Command::new(&xmrig_path);
        cmd.arg("-o")
            .arg(&config.pool_url)
            .arg("-u")
            .arg(&config.wallet_address)
            .arg("-p")
            .arg(&config.worker_name)
            .arg("-t")
            .arg(config.threads.to_string())
            .arg("-a")
            .arg(&config.algorithm)
            .arg("--donate-level=1")
            .arg("--no-color")
            .arg("--http-enabled")
            .arg("--http-host=127.0.0.1")
            .arg(format!("--http-port={}", XMRIG_HTTP_PORT))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match cmd.spawn() {
            Ok(mut child) => {
                if let Some(stdout) = child.stdout.take() {
                    let stats = Arc::clone(&self.stats);
                    let running = Arc::clone(&self.running);
                    thread::spawn(move || parse_stdout(stdout, stats, running));
                }

                let stats = Arc::clone(&self.stats);
                let running = Arc::clone(&self.running);
                thread::spawn(move || poll_http_stats(stats, running));

                self.process = Some(child);
                self.running.store(true, Ordering::SeqCst);
                Ok("Mining started successfully".to_string())
            }
            Err(e) => Err(format!("Failed to start XMRig: {}", e)),
        }
    }

    pub fn stop(&mut self) -> Result<String, String> {
        if !self.running.load(Ordering::SeqCst) {
            return Err("Miner is not running".to_string());
        }

        if let Some(mut process) = self.process.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
        self.running.store(false, Ordering::SeqCst);
        if let Ok(mut stats) = self.stats.lock() {
            *stats = MiningStats::default();
        }
        Ok("Mining stopped".to_string())
    }

    pub fn get_stats(&self) -> MiningStats {
        if self.running.load(Ordering::SeqCst) {
            if let Some(http_stats) = fetch_xmrig_summary() {
                if let Ok(mut current) = self.stats.lock() {
                    *current = http_stats.clone();
                    return http_stats;
                }
            }
        }
        self.stats.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }
}

fn parse_stdout<R: Read>(stdout: R, stats: Arc<Mutex<MiningStats>>, running: Arc<AtomicBool>) {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        if !running.load(Ordering::SeqCst) {
            break;
        }
        apply_log_line(&line, &stats);
    }
}

fn apply_log_line(line: &str, stats: Arc<Mutex<MiningStats>>) {
    let Ok(mut stats) = stats.lock() else { return };
    let lower = line.to_lowercase();
    if lower.contains("accepted") {
        stats.shares_accepted += 1;
    } else if lower.contains("rejected") {
        stats.shares_rejected += 1;
    }
    if let Some((h10, h60, h15)) = parse_speed_line(line) {
        stats.hashrate_10s = h10;
        stats.hashrate_60s = h60;
        stats.hashrate_15m = h15;
        stats.hashrate = h10;
    }
    if lower.contains("diff") && lower.contains("job") {
        if let Some(diff) = parse_diff(line) {
            stats.difficulty = diff;
        }
    }
}

fn parse_speed_line(line: &str) -> Option<(f64, f64, f64)> {
    let marker = "speed 10s/60s/15m ";
    let idx = line.find(marker)?;
    let rest = &line[idx + marker.len()..];
    let mut parts = rest.split_whitespace();
    let h10 = parse_rate(parts.next()?);
    let h60 = parse_rate(parts.next()?);
    let h15 = parse_rate(parts.next()?);
    Some((h10, h60, h15))
}

fn parse_rate(token: &str) -> f64 {
    token.parse().unwrap_or(0.0)
}

fn parse_diff(line: &str) -> Option<u64> {
    let idx = line.find("diff ")?;
    line[idx + 5..].split_whitespace().next()?.parse().ok()
}

fn poll_http_stats(stats: Arc<Mutex<MiningStats>>, running: Arc<AtomicBool>) {
    while running.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_secs(2));
        if let Some(summary) = fetch_xmrig_summary() {
            if let Ok(mut current) = stats.lock() {
                *current = summary;
            }
        }
    }
}

fn fetch_xmrig_summary() -> Option<MiningStats> {
    let mut stream = TcpStream::connect((XMRIG_HTTP_HOST, XMRIG_HTTP_PORT)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).ok()?;
    let request = format!(
        "GET /1/summary HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        XMRIG_HTTP_HOST, XMRIG_HTTP_PORT
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut body = String::new();
    stream.read_to_string(&mut body).ok()?;
    let json_start = body.find('{')?;
    let json: Value = serde_json::from_str(&body[json_start..]).ok()?;
    parse_summary_json(&json)
}

fn parse_summary_json(json: &Value) -> Option<MiningStats> {
    let total = json.get("hashrate")?.get("total")?.as_array()?;
    let h10 = total.first().and_then(Value::as_f64).unwrap_or(0.0);
    let h60 = total.get(1).and_then(Value::as_f64).unwrap_or(0.0);
    let h15 = total.get(2).and_then(Value::as_f64).unwrap_or(0.0);
    let results = json.get("results");
    let accepted = results
        .and_then(|r| r.get("shares_good"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total_shares = results
        .and_then(|r| r.get("shares_total"))
        .and_then(Value::as_u64)
        .unwrap_or(accepted);
    let difficulty = results
        .and_then(|r| r.get("diff_current"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    Some(MiningStats {
        hashrate: h10,
        hashrate_10s: h10,
        hashrate_60s: h60,
        hashrate_15m: h15,
        shares_accepted: accepted,
        shares_rejected: total_shares.saturating_sub(accepted),
        difficulty,
        uptime: json.get("uptime").and_then(Value::as_u64).unwrap_or(0),
    })
}

pub fn get_xmrig_path() -> Option<String> {
    let candidates = xmrig_candidates();
    candidates.into_iter().find(|p| PathBuf::from(p).is_file())
}

fn xmrig_candidates() -> Vec<String> {
    let binary = if cfg!(target_os = "windows") {
        "xmrig.exe"
    } else {
        "xmrig"
    };
    let mut paths = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join(binary).to_string_lossy().to_string());
            paths.push(dir.join("binaries").join(binary).to_string_lossy().to_string());
        }
    }

    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        paths.push(
            PathBuf::from(manifest)
                .join("binaries")
                .join(binary)
                .to_string_lossy()
                .to_string(),
        );
    }

    paths.push(format!("binaries/{}", binary));
    paths.push(binary.to_string());
    paths
}

pub fn get_system_info() -> SystemInfo {
    SystemInfo {
        cpu_name: get_cpu_name(),
        cpu_cores: num_cpus::get_physical() as u32,
        cpu_threads: num_cpus::get() as u32,
        memory_total: get_total_memory(),
        memory_available: get_available_memory(),
        os_name: std::env::consts::OS.to_string(),
        os_version: get_os_version(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

fn get_cpu_name() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("sysctl")
            .arg("-n")
            .arg("machdep.cpu.brand_string")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "Unknown CPU".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("wmic")
            .args(["cpu", "get", "Name", "/value"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("Name="))
                    .map(|l| l.trim_start_matches("Name=").trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Windows CPU".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/cpuinfo")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("model name"))
                    .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
            })
            .unwrap_or_else(|| "Unknown CPU".to_string())
    }
}

#[cfg(target_os = "linux")]
fn parse_meminfo_kb(label: &str) -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|l| l.starts_with(label))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

fn get_total_memory() -> u64 {
    #[cfg(target_os = "linux")]
    {
        return parse_meminfo_kb("MemTotal:").unwrap_or(0);
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("sysctl")
            .arg("-n")
            .arg("hw.memsize")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
    }
    #[cfg(target_os = "windows")]
    {
        return wmic_memory_bytes("TotalVisibleMemorySize").unwrap_or(0);
    }
    #[allow(unreachable_code)]
    0
}

fn get_available_memory() -> u64 {
    #[cfg(target_os = "linux")]
    {
        return parse_meminfo_kb("MemAvailable:").unwrap_or(0);
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("sysctl")
            .arg("-n")
            .arg("hw.memsize")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .map(|total| total / 2)
            .unwrap_or(0);
    }
    #[cfg(target_os = "windows")]
    {
        return wmic_memory_bytes("FreePhysicalMemory").unwrap_or(0);
    }
    #[allow(unreachable_code)]
    0
}

#[cfg(target_os = "windows")]
fn wmic_memory_bytes(field: &str) -> Option<u64> {
    let output = Command::new("wmic")
        .args(["OS", "get", field, "/value"])
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().find(|l| l.starts_with(&format!("{}=", field)))?;
    let kb: u64 = line.split('=').nth(1)?.trim().parse().ok()?;
    Some(kb * 1024)
}

fn get_os_version() -> String {
    #[cfg(target_os = "macos")]
    {
        Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "Unknown".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("wmic")
            .args(["os", "get", "Caption", "/value"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("Caption="))
                    .map(|l| l.trim_start_matches("Caption=").trim().to_string())
            })
            .unwrap_or_else(|| "Windows".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("PRETTY_NAME="))
                    .map(|l| l.trim_start_matches("PRETTY_NAME=").replace('"', ""))
            })
            .unwrap_or_else(|| "Linux".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mining_config_serialization() {
        let config = MiningConfig {
            pool_url: "localhost:3333".to_string(),
            wallet_address: "address".to_string(),
            worker_name: "worker".to_string(),
            threads: 4,
            coin_type: "XMR".to_string(),
            algorithm: "rx/0".to_string(),
        };
        let serialized = serde_json::to_string(&config).unwrap();
        let deserialized: MiningConfig = serde_json::from_str(&serialized).unwrap();
        assert_eq!(config.pool_url, deserialized.pool_url);
    }

    #[test]
    fn test_system_info_retrieval() {
        let info = get_system_info();
        assert!(!info.cpu_name.is_empty());
        assert!(info.cpu_cores > 0);
        assert!(!info.os_name.is_empty());
        assert!(info.memory_total > 0 || cfg!(target_os = "windows"));
    }

    #[test]
    fn test_xmrig_candidates_contain_name() {
        let paths = xmrig_candidates();
        assert!(paths.iter().any(|p| p.contains("xmrig")));
    }

    #[test]
    fn test_parse_speed_line() {
        let line = "miner    speed 10s/60s/15m 316.3 335.9 n/a H/s max 348.0 H/s";
        let parsed = parse_speed_line(line).unwrap();
        assert!((parsed.0 - 316.3).abs() < 0.01);
        assert!((parsed.1 - 335.9).abs() < 0.01);
    }

    #[test]
    fn test_parse_summary_json() {
        let json = serde_json::json!({
            "hashrate": { "total": [12.5, 11.0, 10.0] },
            "results": { "shares_good": 4, "shares_total": 5, "diff_current": 75000 },
            "uptime": 42
        });
        let stats = parse_summary_json(&json).unwrap();
        assert!((stats.hashrate_10s - 12.5).abs() < 0.01);
        assert_eq!(stats.shares_accepted, 4);
        assert_eq!(stats.shares_rejected, 1);
        assert_eq!(stats.uptime, 42);
    }
}
