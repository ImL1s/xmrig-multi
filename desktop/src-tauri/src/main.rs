// XMRig Miner Desktop - Tauri Backend
// Supports macOS, Windows, Linux

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod idle_policy;
mod miner;
mod optimize;

use miner::MinerState;
use std::sync::Mutex;
use tauri::State;

// Global miner state
struct AppState {
    miner: Mutex<MinerState>,
}

#[tauri::command]
fn start_mining(
    state: State<'_, AppState>,
    config: miner::MiningConfig,
) -> Result<String, String> {
    let mut miner = state.miner.lock().map_err(|e| e.to_string())?;
    miner.start(config)
}

#[tauri::command]
fn stop_mining(state: State<'_, AppState>) -> Result<String, String> {
    let mut miner = state.miner.lock().map_err(|e| e.to_string())?;
    miner.stop()
}

#[tauri::command]
fn get_mining_stats(state: State<'_, AppState>) -> Result<miner::MiningStats, String> {
    // Snapshot only — HTTP poller owns the live fetch (#49).
    let miner = state.miner.lock().map_err(|e| e.to_string())?;
    Ok(miner.get_stats())
}

#[tauri::command]
fn get_session_api_info(state: State<'_, AppState>) -> Result<miner::SessionApiInfo, String> {
    let miner = state.miner.lock().map_err(|e| e.to_string())?;
    Ok(miner.session_api_info())
}

#[tauri::command]
fn is_mining(state: State<'_, AppState>) -> Result<bool, String> {
    let miner = state.miner.lock().map_err(|e| e.to_string())?;
    Ok(miner.is_running())
}

#[tauri::command]
fn get_system_info() -> miner::SystemInfo {
    miner::get_system_info()
}

#[tauri::command]
fn get_hardware_snapshot() -> hardware::HardwareSnapshot {
    hardware::capture_hardware_snapshot()
}

#[tauri::command]
fn export_hardware_report() -> hardware::SanitizedHardwareReport {
    hardware::sanitize_hardware_report(hardware::capture_hardware_snapshot())
}

#[tauri::command]
fn get_optimize_matrix() -> optimize::OptimizeMatrix {
    optimize::capability_matrix(std::env::consts::OS)
}

#[tauri::command]
fn plan_desktop_optimize(req: OptimizeRequestDto) -> optimize::OptimizePlan {
    optimize::plan_optimize(
        std::env::consts::OS,
        &optimize::OptimizeRequest {
            huge_pages: req.huge_pages,
            pages1g: req.pages1g,
            numa: req.numa,
            msr: req.msr,
            msr_consent: req.msr_consent,
            auto_tuner: req.auto_tuner,
            yield_cpu: req.yield_cpu,
            priority: req.priority,
            huge_pages_available: req.huge_pages_available,
            pages1g_available: req.pages1g_available,
        },
    )
}

#[tauri::command]
fn get_idle_capability_matrix() -> idle_policy::IdleCapabilityMatrix {
    idle_policy::capability_matrix(std::env::consts::OS)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdleEnginePrefsDto {
    #[serde(default)]
    pause_on_battery: bool,
    #[serde(default)]
    pause_on_active_seconds: Option<u32>,
}

#[tauri::command]
fn plan_idle_engine_flags(prefs: IdleEnginePrefsDto) -> idle_policy::IdleEnginePlan {
    idle_policy::plan_engine_flags(
        std::env::consts::OS,
        &idle_policy::IdleEnginePrefs {
            pause_on_battery: prefs.pause_on_battery,
            pause_on_active_seconds: prefs.pause_on_active_seconds,
        },
    )
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseBehaviorDto {
    #[serde(default)]
    saved_preference: Option<String>,
    #[serde(default)]
    user_choice: Option<String>,
    #[serde(default)]
    remember_choice: bool,
    #[serde(default)]
    session_authorized: bool,
}

#[tauri::command]
fn resolve_close_behavior(req: CloseBehaviorDto) -> idle_policy::CloseDecision {
    idle_policy::resolve_close_behavior(
        req.saved_preference.as_deref(),
        req.user_choice.as_deref(),
        req.remember_choice,
        req.session_authorized,
    )
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdleEvalDto {
    #[serde(default)]
    user_stopped: bool,
    #[serde(default)]
    mining_armed: bool,
    #[serde(default)]
    on_battery: Option<bool>,
    #[serde(default)]
    idle_ms: Option<u64>,
    #[serde(default)]
    idle_reliable: bool,
    #[serde(default = "default_idle_ms")]
    idle_mine_after_ms: u64,
    #[serde(default = "default_true")]
    pause_when_active: bool,
    #[serde(default = "default_true")]
    pause_on_unplug: bool,
    #[serde(default)]
    system_sleeping: bool,
    #[serde(default)]
    keep_awake_consent: bool,
    #[serde(default = "default_true")]
    respect_sleep: bool,
}

fn default_idle_ms() -> u64 {
    5 * 60_000
}

#[tauri::command]
fn evaluate_desktop_idle(req: IdleEvalDto) -> idle_policy::IdleVerdict {
    idle_policy::evaluate_idle(
        std::env::consts::OS,
        &idle_policy::IdleEvalInput {
            user_stopped: req.user_stopped,
            mining_armed: req.mining_armed,
            on_battery: req.on_battery,
            idle_ms: req.idle_ms,
            idle_reliable: req.idle_reliable,
            idle_mine_after_ms: req.idle_mine_after_ms,
            pause_when_active: req.pause_when_active,
            pause_on_unplug: req.pause_on_unplug,
            system_sleeping: req.system_sleeping,
            keep_awake_consent: req.keep_awake_consent,
            respect_sleep: req.respect_sleep,
        },
    )
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeRequestDto {
    #[serde(default)]
    huge_pages: bool,
    #[serde(default)]
    pages1g: bool,
    #[serde(default)]
    numa: bool,
    #[serde(default)]
    msr: bool,
    #[serde(default)]
    msr_consent: bool,
    #[serde(default)]
    auto_tuner: bool,
    #[serde(default = "default_true")]
    yield_cpu: bool,
    #[serde(default = "default_normal")]
    priority: String,
    #[serde(default)]
    huge_pages_available: bool,
    #[serde(default)]
    pages1g_available: bool,
}

fn default_true() -> bool {
    true
}

fn default_normal() -> String {
    "normal".into()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            miner: Mutex::new(MinerState::new()),
        })
        .invoke_handler(tauri::generate_handler![
            start_mining,
            stop_mining,
            get_mining_stats,
            get_session_api_info,
            is_mining,
            get_system_info,
            get_hardware_snapshot,
            export_hardware_report,
            get_optimize_matrix,
            plan_desktop_optimize,
            get_idle_capability_matrix,
            plan_idle_engine_flags,
            resolve_close_behavior,
            evaluate_desktop_idle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
