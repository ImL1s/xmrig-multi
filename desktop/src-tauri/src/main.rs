// XMRig Miner Desktop - Tauri Backend
// Supports macOS, Windows, Linux

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod idle_policy;
mod miner;
mod optimize;

use miner::MinerState;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};

/// Shared runtime prefs for close/tray coordination (#77).
struct SessionPrefs {
    close_preference: String,
    session_authorized: bool,
    user_stopped: bool,
    tray_tooltip: String,
}

impl Default for SessionPrefs {
    fn default() -> Self {
        Self {
            close_preference: "ask".into(),
            session_authorized: false,
            user_stopped: false,
            tray_tooltip: "XMRig Multi — Stopped".into(),
        }
    }
}

struct AppState {
    miner: Mutex<MinerState>,
    prefs: Mutex<SessionPrefs>,
}

#[tauri::command]
fn start_mining(
    state: State<'_, AppState>,
    config: miner::MiningConfig,
) -> Result<String, String> {
    {
        let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
        if prefs.user_stopped {
            return Err("User Stop latched — clear Stop before starting".into());
        }
        prefs.session_authorized = true;
        prefs.tray_tooltip = "XMRig Multi — Mining".into();
    }
    let mut miner = state.miner.lock().map_err(|e| e.to_string())?;
    miner.start(config)
}

#[tauri::command]
fn stop_mining(state: State<'_, AppState>) -> Result<String, String> {
    {
        let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
        prefs.user_stopped = true;
        prefs.session_authorized = false;
        prefs.tray_tooltip = "XMRig Multi — Stopped".into();
    }
    let mut miner = state.miner.lock().map_err(|e| e.to_string())?;
    miner.stop()
}

#[tauri::command]
fn clear_user_stop(state: State<'_, AppState>) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.user_stopped = false;
    Ok(())
}

#[tauri::command]
fn get_mining_stats(state: State<'_, AppState>) -> Result<miner::MiningStats, String> {
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
struct SetClosePreferenceDto {
    preference: String,
}

#[tauri::command]
fn set_close_preference(state: State<'_, AppState>, req: SetClosePreferenceDto) -> Result<(), String> {
    let mut prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    prefs.close_preference = req.preference;
    Ok(())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyCloseResult {
    action: String,
    stopped: bool,
    hidden: bool,
    next_preference: String,
    reasons: Vec<String>,
}

/// Apply a close decision from the frontend prompt (or saved preference).
#[tauri::command]
fn apply_close_decision(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: CloseBehaviorDto,
) -> Result<ApplyCloseResult, String> {
    let session_authorized = {
        let prefs = state.prefs.lock().map_err(|e| e.to_string())?;
        req.session_authorized || prefs.session_authorized
    };
    let saved = req
        .saved_preference
        .clone()
        .or_else(|| {
            state
                .prefs
                .lock()
                .ok()
                .map(|p| p.close_preference.clone())
        });
    let decision = idle_policy::resolve_close_behavior(
        saved.as_deref(),
        req.user_choice.as_deref(),
        req.remember_choice,
        session_authorized,
    );

    if req.remember_choice || decision.next_preference != "ask" {
        if let Ok(mut prefs) = state.prefs.lock() {
            prefs.close_preference = decision.next_preference.clone();
        }
    }

    match decision.action.as_str() {
        "quit-and-stop" => {
            force_stop_miner(&state);
            app.exit(0);
            Ok(ApplyCloseResult {
                action: decision.action,
                stopped: true,
                hidden: false,
                next_preference: decision.next_preference,
                reasons: decision.reasons,
            })
        }
        "minimize-to-tray" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }
            Ok(ApplyCloseResult {
                action: decision.action,
                stopped: false,
                hidden: true,
                next_preference: decision.next_preference,
                reasons: decision.reasons,
            })
        }
        _ => Ok(ApplyCloseResult {
            action: decision.action,
            stopped: false,
            hidden: false,
            next_preference: decision.next_preference,
            reasons: decision.reasons,
        }),
    }
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
    #[serde(default)]
    engine_pause_on_active_armed: bool,
}

fn default_idle_ms() -> u64 {
    5 * 60_000
}

#[tauri::command]
fn evaluate_desktop_idle(
    state: State<'_, AppState>,
    req: IdleEvalDto,
) -> Result<idle_policy::IdleVerdict, String> {
    let (user_stopped, session_authorized) = {
        let prefs = state.prefs.lock().map_err(|e| e.to_string())?;
        (prefs.user_stopped, prefs.session_authorized)
    };
    let verdict = idle_policy::evaluate_idle(
        std::env::consts::OS,
        &idle_policy::IdleEvalInput {
            user_stopped: req.user_stopped || user_stopped,
            mining_armed: req.mining_armed || session_authorized,
            on_battery: req.on_battery,
            idle_ms: req.idle_ms,
            idle_reliable: req.idle_reliable,
            idle_mine_after_ms: req.idle_mine_after_ms,
            pause_when_active: req.pause_when_active,
            pause_on_unplug: req.pause_on_unplug,
            system_sleeping: req.system_sleeping,
            keep_awake_consent: req.keep_awake_consent,
            respect_sleep: req.respect_sleep,
            engine_pause_on_active_armed: req.engine_pause_on_active_armed,
        },
    );
    if let Ok(mut prefs) = state.prefs.lock() {
        prefs.tray_tooltip = format!("XMRig Multi — {}", verdict.tray_status);
    }
    Ok(verdict)
}

#[tauri::command]
fn get_tray_status(state: State<'_, AppState>) -> Result<String, String> {
    let prefs = state.prefs.lock().map_err(|e| e.to_string())?;
    Ok(prefs.tray_tooltip.clone())
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

fn force_stop_miner(state: &AppState) {
    if let Ok(mut prefs) = state.prefs.lock() {
        prefs.session_authorized = false;
        prefs.tray_tooltip = "XMRig Multi — Stopped".into();
    }
    if let Ok(mut miner) = state.miner.lock() {
        let _ = miner.stop();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            miner: Mutex::new(MinerState::new()),
            prefs: Mutex::new(SessionPrefs::default()),
        })
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "show", "Open window", true, None::<&str>)?;
            let pause_i = MenuItem::with_id(app, "pause_stop", "Stop mining", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit and stop", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &pause_i, &sep, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("XMRig Multi — Stopped")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "pause_stop" => {
                        let state = app.state::<AppState>();
                        force_stop_miner(&state);
                        if let Ok(mut prefs) = state.prefs.lock() {
                            prefs.user_stopped = true;
                        };
                    }
                    "quit" => {
                        let state = app.state::<AppState>();
                        force_stop_miner(&state);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _tray = tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let state = app.state::<AppState>();
                let (pref, authorized) = {
                    let prefs = state.prefs.lock().unwrap_or_else(|e| e.into_inner());
                    (prefs.close_preference.clone(), prefs.session_authorized)
                };
                let decision = idle_policy::resolve_close_behavior(
                    Some(pref.as_str()),
                    None,
                    false,
                    authorized,
                );
                if decision.action == "prompt" {
                    let _ = window.emit("close-preference-needed", ());
                    return;
                }
                if decision.action == "minimize-to-tray" && decision.hide_to_tray {
                    let _ = window.hide();
                    return;
                }
                // quit-and-stop (or unauthorized tray → quit)
                force_stop_miner(&state);
                app.exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_mining,
            stop_mining,
            clear_user_stop,
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
            set_close_preference,
            apply_close_decision,
            evaluate_desktop_idle,
            get_tray_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                force_stop_miner(&state);
            }
        });
}
