// XMRig Miner Desktop - Tauri Backend
// Supports macOS, Windows, Linux

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
