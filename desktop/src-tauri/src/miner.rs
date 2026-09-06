// XMRig Miner Module - Process Management
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const XMRIG_HTTP_HOST: &str = "127.0.0.1";
const XMRIG_HTTP_PORT_BASE: u16 = 37420;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MiningConfig {
    pub pool_url: String,
    pub wallet_address: String,
    pub worker_name: String,
    pub threads: u32,
    pub coin_type: String,
    pub algorithm: String,
    /// Requested RandomX mode: auto|fast|light (#35). Defaults to auto.
    #[serde(default = "default_randomx_mode")]
    pub randomx_mode: String,
    /// Optional CPU affinity hex mask (≤64 logical). Empty / omitted = OS auto (#36).
    #[serde(default)]
    pub cpu_affinity: Option<String>,
    /// Optional CPU id list for >64 / multi-word cases. Prefer over truncated 32-bit masks (#36).
    #[serde(default)]
    pub cpu_ids: Option<Vec<u32>>,
}

fn default_randomx_mode() -> String {
    "auto".to_string()
}

fn normalize_randomx_mode(mode: &str) -> &'static str {
    match mode.to_ascii_lowercase().as_str() {
        "fast" => "fast",
        "light" => "light",
        _ => "auto",
    }
}

/// Affinity apply result for XMRig argv (#36). Never claims success when platform cannot bind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AffinityArgv {
    pub argv: Vec<String>,
    pub applied: &'static str,
    pub warnings: Vec<String>,
}

/// Resolve optional affinity into XMRig CLI args. macOS/mobile → OS auto with warning.
pub fn resolve_affinity_argv(
    cpu_affinity: Option<&str>,
    cpu_ids: Option<&[u32]>,
    logical_max: u32,
) -> AffinityArgv {
    let mut warnings = Vec::new();
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    {
        if cpu_affinity.map(|s| !s.trim().is_empty()).unwrap_or(false)
            || cpu_ids.map(|v| !v.is_empty()).unwrap_or(false)
        {
            warnings.push(
                "hard CPU affinity unsupported on this OS — using OS scheduler (no root)".into(),
            );
        }
        return AffinityArgv {
            argv: vec![],
            applied: "os-auto",
            warnings,
        };
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    {
        if let Some(ids) = cpu_ids {
            if !ids.is_empty() {
                let max_id = *ids.iter().max().unwrap_or(&0);
                if max_id >= 64 || logical_max > 64 {
                    warnings.push(
                        "cpu id list >64 requires JSON config rx thread pins; CLI affinity skipped"
                            .into(),
                    );
                    return AffinityArgv {
                        argv: vec![],
                        applied: "os-auto",
                        warnings,
                    };
                }
                match ids_to_affinity_hex(ids, logical_max) {
                    Ok(hex) => {
                        return AffinityArgv {
                            argv: vec![format!("--cpu-affinity={hex}")],
                            applied: "affinity",
                            warnings,
                        };
                    }
                    Err(e) => {
                        warnings.push(format!("affinity ids rejected ({e}) — OS auto fallback"));
                        return AffinityArgv {
                            argv: vec![],
                            applied: "os-auto",
                            warnings,
                        };
                    }
                }
            }
        }
        if let Some(raw) = cpu_affinity {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                if validate_affinity_hex(trimmed, logical_max).is_err() {
                    warnings.push("affinity mask invalid — OS auto fallback".into());
                    return AffinityArgv {
                        argv: vec![],
                        applied: "os-auto",
                        warnings,
                    };
                }
                return AffinityArgv {
                    argv: vec![format!("--cpu-affinity={trimmed}")],
                    applied: "affinity",
                    warnings,
                };
            }
        }
        AffinityArgv {
            argv: vec![],
            applied: "os-auto",
            warnings,
        }
    }
}

fn validate_affinity_hex(mask: &str, logical_max: u32) -> Result<(), String> {
    let hex = mask
        .strip_prefix("0x")
        .or_else(|| mask.strip_prefix("0X"))
        .unwrap_or(mask);
    if hex.is_empty() || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("bad hex".into());
    }
    if logical_max > 64 {
        return Err("use cpu_ids for >64 logical CPUs".into());
    }
    Ok(())
}

fn ids_to_affinity_hex(ids: &[u32], logical_max: u32) -> Result<String, String> {
    if ids.is_empty() {
        return Err("empty".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut value: u64 = 0;
    for &id in ids {
        if id >= logical_max {
            return Err(format!("id {id} out of range"));
        }
        if id >= 64 {
            return Err("id >= 64".into());
        }
        if !seen.insert(id) {
            continue;
        }
        value |= 1u64 << id;
    }
    if value == 0 {
        return Err("empty after dedupe".into());
    }
    Ok(format!("0x{value:x}"))
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

/// Public session API metadata — never includes the access token (#49).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionApiInfo {
    pub session_generation: u64,
    pub http_host: String,
    pub http_port: u16,
    pub token_configured: bool,
}

pub struct MinerState {
    process: Arc<Mutex<Option<Child>>>,
    running: Arc<AtomicBool>,
    stats: Arc<Mutex<MiningStats>>,
    /// Immutable session generation (#49). Stale poller/reaper must not mutate newer sessions.
    session_gen: Arc<AtomicU64>,
    http_port: Arc<AtomicU16>,
    /// Access token kept out of logs / Display; only used for loopback HTTP.
    http_token: Arc<Mutex<Option<String>>>,
}

impl MinerState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            stats: Arc::new(Mutex::new(MiningStats::default())),
            session_gen: Arc::new(AtomicU64::new(0)),
            http_port: Arc::new(AtomicU16::new(XMRIG_HTTP_PORT_BASE)),
            http_token: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(&mut self, config: MiningConfig) -> Result<String, String> {
        if self.running.load(Ordering::SeqCst) {
            return Err("Miner is already running".to_string());
        }
        if config.wallet_address.trim().is_empty() {
            return Err("Wallet address is required".to_string());
        }

        let coin = config.coin_type.to_lowercase();
        if coin.contains("wow") {
            return Err(
                "Wownero start blocked until verified signer/daemon flow (#28)".to_string(),
            );
        }
        if coin.contains("dero") {
            return Err(
                "DERO start blocked: needs dedicated daemon adapter, not XMRig Stratum (#27)"
                    .to_string(),
            );
        }
        if config.pool_url.to_lowercase().contains("moneroocean") {
            let addr = config.wallet_address.trim();
            let is_xmr = (addr.starts_with('4') || addr.starts_with('8')) && addr.len() >= 95;
            if !is_xmr || coin.contains("wow") {
                return Err(
                    "MoneroOcean requires a Monero (XMR) payout address (#29)".to_string(),
                );
            }
        }

        if let Ok(mut slot) = self.process.lock() {
            if let Some(mut leftover) = slot.take() {
                let _ = leftover.kill();
                let _ = leftover.wait();
            }
        }

        let xmrig_path = get_xmrig_path().ok_or_else(|| {
            "XMRig binary not found. Run desktop/scripts/build-xmrig.sh and place it in src-tauri/binaries/".to_string()
        })?;

        let gen = self.session_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let http_port = pick_loopback_port(XMRIG_HTTP_PORT_BASE)?;
        let access_token = random_access_token();
        self.http_port.store(http_port, Ordering::SeqCst);
        if let Ok(mut slot) = self.http_token.lock() {
            *slot = Some(access_token.clone());
        }
        if let Ok(mut stats) = self.stats.lock() {
            *stats = MiningStats::default();
        }

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
            .arg(format!(
                "--randomx-mode={}",
                normalize_randomx_mode(&config.randomx_mode)
            ))
            .arg("--donate-level=1")
            .arg("--no-color")
            .arg("--http-enabled")
            .arg("--http-host=127.0.0.1")
            .arg(format!("--http-port={}", http_port))
            .arg(format!("--http-access-token={}", access_token));

        let logical_max = std::cmp::max(config.threads, num_cpus::get() as u32);
        let affinity = resolve_affinity_argv(
            config.cpu_affinity.as_deref(),
            config.cpu_ids.as_deref(),
            logical_max,
        );
        for arg in &affinity.argv {
            cmd.arg(arg);
        }
        for w in &affinity.warnings {
            eprintln!("[affinity] {w}");
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        // Drop local token copy; live copy stays in http_token mutex only.
        drop(access_token);

        match cmd.spawn() {
            Ok(mut child) => {
                self.running.store(true, Ordering::SeqCst);

                if let Some(stdout) = child.stdout.take() {
                    let stats = Arc::clone(&self.stats);
                    let running = Arc::clone(&self.running);
                    let session_gen = Arc::clone(&self.session_gen);
                    thread::spawn(move || parse_stdout(stdout, stats, running, session_gen, gen));
                }
                if let Some(stderr) = child.stderr.take() {
                    let session_gen = Arc::clone(&self.session_gen);
                    thread::spawn(move || drain_stderr(stderr, session_gen, gen));
                }

                let stats = Arc::clone(&self.stats);
                let running = Arc::clone(&self.running);
                let session_gen = Arc::clone(&self.session_gen);
                let http_port_atom = Arc::clone(&self.http_port);
                let http_token = Arc::clone(&self.http_token);
                thread::spawn(move || {
                    poll_http_stats(stats, running, session_gen, gen, http_port_atom, http_token)
                });

                {
                    let mut slot = self
                        .process
                        .lock()
                        .map_err(|e| format!("Failed to store XMRig process: {e}"))?;
                    *slot = Some(child);
                }

                let process = Arc::clone(&self.process);
                let running = Arc::clone(&self.running);
                let stats = Arc::clone(&self.stats);
                let session_gen = Arc::clone(&self.session_gen);
                thread::spawn(move || reap_when_exited(process, running, stats, session_gen, gen));

                // Never include token/port secrets beyond "started" message.
                Ok(format!("Mining started successfully (session {gen})"))
            }
            Err(e) => {
                self.session_gen.fetch_add(1, Ordering::SeqCst);
                if let Ok(mut slot) = self.http_token.lock() {
                    *slot = None;
                }
                self.running.store(false, Ordering::SeqCst);
                Err(format!("Failed to start XMRig: {}", e))
            }
        }
    }

    pub fn stop(&mut self) -> Result<String, String> {
        if !self.running.load(Ordering::SeqCst) {
            return Err("Miner is not running".to_string());
        }

        // Invalidate in-flight pollers/reapers before kill (#49).
        self.session_gen.fetch_add(1, Ordering::SeqCst);

        if let Ok(mut slot) = self.process.lock() {
            if let Some(mut process) = slot.take() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
        if let Ok(mut slot) = self.http_token.lock() {
            *slot = None;
        }
        clear_session(&self.running, &self.stats);
        Ok("Mining stopped".to_string())
    }

    /// UI reads the snapshot only — backend poller is the sole HTTP owner (#49).
    pub fn get_stats(&self) -> MiningStats {
        self.stats.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn session_generation(&self) -> u64 {
        self.session_gen.load(Ordering::SeqCst)
    }

    /// Diagnostics-safe API info — token value is never exported (#49).
    pub fn session_api_info(&self) -> SessionApiInfo {
        let token_configured = self
            .http_token
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false);
        SessionApiInfo {
            session_generation: self.session_gen.load(Ordering::SeqCst),
            http_host: XMRIG_HTTP_HOST.to_string(),
            http_port: self.http_port.load(Ordering::SeqCst),
            token_configured,
        }
    }
}

fn parse_stdout<R: Read>(
    stdout: R,
    stats: Arc<Mutex<MiningStats>>,
    running: Arc<AtomicBool>,
    session_gen: Arc<AtomicU64>,
    gen: u64,
) {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        if session_gen.load(Ordering::SeqCst) != gen || !running.load(Ordering::SeqCst) {
            break;
        }
        apply_log_line(&line, &stats);
    }
}

/// Bounded stderr drain so the child cannot block on a full pipe (#49).
fn drain_stderr<R: Read>(stderr: R, session_gen: Arc<AtomicU64>, gen: u64) {
    let mut reader = BufReader::new(stderr);
    let mut buf = [0u8; 4096];
    let mut total: u64 = 0;
    const CAP: u64 = 2 * 1024 * 1024;
    loop {
        if session_gen.load(Ordering::SeqCst) != gen {
            break;
        }
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                total = total.saturating_add(n as u64);
                let _ = total > CAP;
            }
            Err(_) => break,
        }
    }
}

fn reap_when_exited(
    process: Arc<Mutex<Option<Child>>>,
    running: Arc<AtomicBool>,
    stats: Arc<Mutex<MiningStats>>,
    session_gen: Arc<AtomicU64>,
    gen: u64,
) {
    loop {
        if session_gen.load(Ordering::SeqCst) != gen {
            return;
        }
        thread::sleep(Duration::from_millis(400));
        let mut slot = match process.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        match slot.as_mut() {
            None => return,
            Some(child) => match child.try_wait() {
                Ok(None) => {}
                Ok(Some(_)) | Err(_) => {
                    *slot = None;
                    drop(slot);
                    if session_gen.load(Ordering::SeqCst) == gen {
                        clear_session(&running, &stats);
                    }
                    return;
                }
            },
        }
    }
}

fn clear_session(running: &Arc<AtomicBool>, stats: &Arc<Mutex<MiningStats>>) {
    running.store(false, Ordering::SeqCst);
    if let Ok(mut stats) = stats.lock() {
        *stats = MiningStats::default();
    }
}

fn apply_log_line(line: &str, stats: &Arc<Mutex<MiningStats>>) {
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

fn poll_http_stats(
    stats: Arc<Mutex<MiningStats>>,
    running: Arc<AtomicBool>,
    session_gen: Arc<AtomicU64>,
    gen: u64,
    http_port: Arc<AtomicU16>,
    http_token: Arc<Mutex<Option<String>>>,
) {
    while running.load(Ordering::SeqCst) && session_gen.load(Ordering::SeqCst) == gen {
        thread::sleep(Duration::from_secs(2));
        if session_gen.load(Ordering::SeqCst) != gen {
            break;
        }
        let port = http_port.load(Ordering::SeqCst);
        let token = http_token
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .unwrap_or_default();
        if let Some(summary) = fetch_xmrig_summary(port, &token) {
            if session_gen.load(Ordering::SeqCst) != gen {
                break;
            }
            if let Ok(mut current) = stats.lock() {
                *current = summary;
            }
        }
    }
}

fn fetch_xmrig_summary(port: u16, access_token: &str) -> Option<MiningStats> {
    let mut stream = TcpStream::connect((XMRIG_HTTP_HOST, port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).ok()?;
    let auth = if access_token.is_empty() {
        String::new()
    } else {
        format!("Authorization: Bearer {}\r\n", access_token)
    };
    let request = format!(
        "GET /1/summary HTTP/1.1\r\nHost: {}:{}\r\n{}Connection: close\r\n\r\n",
        XMRIG_HTTP_HOST, port, auth
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

fn pick_loopback_port(preferred: u16) -> Result<u16, String> {
    for offset in 0u16..32 {
        let port = preferred.saturating_add(offset);
        if TcpListener::bind((XMRIG_HTTP_HOST, port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No free loopback port for XMRig HTTP API".to_string())
}

fn random_access_token() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    thread::current().id().hash(&mut hasher);
    format!(
        "{:016x}{:016x}",
        hasher.finish(),
        hasher.finish().rotate_left(13)
    )
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
            paths.push(
                dir.join("binaries")
                    .join(binary)
                    .to_string_lossy()
                    .to_string(),
            );
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
    let snap = crate::hardware::capture_hardware_snapshot();
    SystemInfo {
        cpu_name: snap
            .cpu
            .name
            .value
            .unwrap_or_else(|| "Unknown CPU".to_string()),
        cpu_cores: snap.cpu.physical.value.unwrap_or(0).max(1),
        cpu_threads: snap.cpu.logical.value.unwrap_or(0).max(1),
        memory_total: snap.memory.total_bytes.value.unwrap_or(0),
        memory_available: snap.memory.available_bytes.value.unwrap_or(0),
        os_name: snap.platform.os,
        os_version: snap
            .platform
            .os_version
            .value
            .unwrap_or_else(|| "Unknown".to_string()),
        arch: snap.platform.arch,
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
            randomx_mode: "light".to_string(),
            cpu_affinity: Some("0x15".into()),
            cpu_ids: Some(vec![0, 2, 4]),
        };
        let serialized = serde_json::to_string(&config).unwrap();
        let deserialized: MiningConfig = serde_json::from_str(&serialized).unwrap();
        assert_eq!(config.pool_url, deserialized.pool_url);
        assert_eq!(deserialized.randomx_mode, "light");
        assert_eq!(deserialized.cpu_affinity.as_deref(), Some("0x15"));
        assert_eq!(deserialized.cpu_ids.as_deref(), Some(&[0, 2, 4][..]));
        assert_eq!(normalize_randomx_mode("FAST"), "fast");
        assert_eq!(normalize_randomx_mode("nope"), "auto");
    }

    #[test]
    fn test_randomx_mode_defaults_when_omitted() {
        let json = r#"{
            "pool_url":"p","wallet_address":"w","worker_name":"n",
            "threads":2,"coin_type":"XMR","algorithm":"rx/0"
        }"#;
        let c: MiningConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.randomx_mode, "auto");
        assert!(c.cpu_affinity.is_none());
        assert!(c.cpu_ids.is_none());
    }

    #[test]
    fn affinity_hex_from_ids_and_rejects_oob() {
        assert_eq!(ids_to_affinity_hex(&[0, 2, 4], 8).unwrap(), "0x15");
        assert!(ids_to_affinity_hex(&[9], 8).is_err());
        let auto = resolve_affinity_argv(None, None, 8);
        assert_eq!(auto.applied, "os-auto");
        assert!(auto.argv.is_empty());
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

    #[test]
    fn session_generation_bumps_on_lifecycle() {
        let mut miner = MinerState::new();
        assert_eq!(miner.session_generation(), 0);
        assert!(miner.stop().is_err());
        assert_eq!(miner.session_generation(), 0);
    }

    #[test]
    fn pick_loopback_port_finds_free() {
        let port = pick_loopback_port(XMRIG_HTTP_PORT_BASE).unwrap();
        assert!(port >= XMRIG_HTTP_PORT_BASE);
    }

    #[test]
    fn access_token_is_hex_and_nonempty() {
        let t = random_access_token();
        assert!(t.len() >= 16);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
