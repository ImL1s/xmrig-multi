//! Desktop idle / pause / close convenience policy (#77).

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapField {
    pub state: String,
    pub label: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleCapabilityMatrix {
    pub os: String,
    pub pause_on_active: CapField,
    pub pause_on_battery: CapField,
    pub idle_timer: CapField,
    pub tray: CapField,
    pub keep_awake: CapField,
}

fn field(state: &str, label: &str, reasons: &[&str]) -> CapField {
    CapField {
        state: state.into(),
        label: label.into(),
        reasons: reasons.iter().map(|s| (*s).to_string()).collect(),
    }
}

pub fn capability_matrix(os: &str) -> IdleCapabilityMatrix {
    let platform = os.to_ascii_lowercase();
    match platform.as_str() {
        "windows" => IdleCapabilityMatrix {
            os: platform,
            pause_on_active: field(
                "available",
                "Pause on active",
                &["XMRig native pause-on-active (true or idle seconds)"],
            ),
            pause_on_battery: field(
                "available",
                "Pause on battery",
                &["XMRig native pause-on-battery"],
            ),
            idle_timer: field(
                "available",
                "Idle timer",
                &["OS idle time API — no key content collection"],
            ),
            tray: field("available", "System tray", &["Win32 notification area"]),
            keep_awake: field(
                "needs-permission",
                "Keep awake",
                &["Explicit consent only; default respects sleep/lid"],
            ),
        },
        "macos" | "darwin" => IdleCapabilityMatrix {
            os: "macos".into(),
            pause_on_active: field(
                "available",
                "Pause on active",
                &["XMRig native pause-on-active on macOS"],
            ),
            pause_on_battery: field(
                "available",
                "Pause on battery",
                &["XMRig native pause-on-battery"],
            ),
            idle_timer: field(
                "available",
                "Idle timer",
                &["IOKit idle time — no key content collection"],
            ),
            tray: field("available", "Menu bar", &["NSStatusItem"]),
            keep_awake: field(
                "needs-permission",
                "Keep awake",
                &["IOPMAssertion only with explicit consent"],
            ),
        },
        _ => IdleCapabilityMatrix {
            os: if platform.is_empty() {
                "linux".into()
            } else {
                platform
            },
            pause_on_active: field(
                "unsupported",
                "Pause on active",
                &[
                    "XMRig pause-on-active is Windows/macOS only — use app-layer idle when available",
                ],
            ),
            pause_on_battery: field(
                "available",
                "Pause on battery",
                &["XMRig pause-on-battery when AC presence is known"],
            ),
            idle_timer: field(
                "needs-permission",
                "Idle timer",
                &["X11/Wayland idle may be unavailable — degrade to manual pause"],
            ),
            tray: field(
                "available",
                "System tray",
                &["StatusNotifierItem when desktop supports it"],
            ),
            keep_awake: field(
                "needs-permission",
                "Keep awake",
                &["Inhibit only with explicit consent; default respects sleep"],
            ),
        },
    }
}

#[derive(Debug, Clone, Default)]
pub struct IdleEnginePrefs {
    pub pause_on_battery: bool,
    /// None = off; Some(0) = true; Some(n>0) = idle seconds
    pub pause_on_active_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleEnginePlan {
    pub argv: Vec<String>,
    pub warnings: Vec<String>,
    pub degradations: Vec<String>,
}

pub fn plan_engine_flags(os: &str, prefs: &IdleEnginePrefs) -> IdleEnginePlan {
    let matrix = capability_matrix(os);
    let mut argv = Vec::new();
    let mut warnings = Vec::new();
    let mut degradations = Vec::new();

    if prefs.pause_on_battery {
        if matrix.pause_on_battery.state == "unsupported" {
            warnings.push("pause-on-battery unsupported on this OS".into());
        } else {
            argv.push("--pause-on-battery".into());
        }
    }

    if let Some(sec) = prefs.pause_on_active_seconds {
        if matrix.pause_on_active.state == "available" {
            if sec == 0 {
                argv.push("--pause-on-active=true".into());
            } else {
                argv.push(format!("--pause-on-active={sec}"));
            }
        } else {
            degradations.push(
                "pause-on-active not native here — use app-layer idle timer or manual pause"
                    .into(),
            );
        }
    }

    IdleEnginePlan {
        argv,
        warnings,
        degradations,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloseDecision {
    pub action: String,
    pub stop_miner: bool,
    pub hide_to_tray: bool,
    pub next_preference: String,
    pub reasons: Vec<String>,
}

/// Resolve close-window behavior. Never default to hide-and-mine.
pub fn resolve_close_behavior(
    saved_preference: Option<&str>,
    user_choice: Option<&str>,
    remember_choice: bool,
    session_authorized: bool,
) -> CloseDecision {
    let saved = normalize_close_pref(saved_preference);
    let ask = saved.is_none() || saved.as_deref() == Some("ask");

    if ask {
        match normalize_close_pref(user_choice) {
            Some(choice) if choice != "ask" => {
                return finalize_close(
                    &choice,
                    remember_choice,
                    saved.as_deref(),
                    session_authorized,
                );
            }
            _ => {
                return CloseDecision {
                    action: "prompt".into(),
                    stop_miner: false,
                    hide_to_tray: false,
                    next_preference: "ask".into(),
                    reasons: vec![
                        "First close (or preference unset): ask quit vs tray — never default hide-and-mine"
                            .into(),
                    ],
                };
            }
        }
    }

    finalize_close(
        saved.as_deref().unwrap_or("ask"),
        remember_choice,
        saved.as_deref(),
        session_authorized,
    )
}

fn finalize_close(
    choice: &str,
    remember: bool,
    saved: Option<&str>,
    session_authorized: bool,
) -> CloseDecision {
    match choice {
        "quit-and-stop" => CloseDecision {
            action: "quit-and-stop".into(),
            stop_miner: true,
            hide_to_tray: false,
            next_preference: if remember {
                "quit-and-stop".into()
            } else {
                saved.unwrap_or("ask").into()
            },
            reasons: vec!["Exit and stop all mining processes".into()],
        },
        "minimize-to-tray" => {
            if !session_authorized {
                CloseDecision {
                    action: "quit-and-stop".into(),
                    stop_miner: true,
                    hide_to_tray: false,
                    next_preference: if remember {
                        "minimize-to-tray".into()
                    } else {
                        saved.unwrap_or("ask").into()
                    },
                    reasons: vec![
                        "Tray continue refused — session not authorized; refusing silent background mining"
                            .into(),
                    ],
                }
            } else {
                CloseDecision {
                    action: "minimize-to-tray".into(),
                    stop_miner: false,
                    hide_to_tray: true,
                    next_preference: if remember {
                        "minimize-to-tray".into()
                    } else {
                        saved.unwrap_or("ask").into()
                    },
                    reasons: vec!["Hide to tray and continue already-authorized work".into()],
                }
            }
        }
        _ => CloseDecision {
            action: "prompt".into(),
            stop_miner: false,
            hide_to_tray: false,
            next_preference: "ask".into(),
            reasons: vec!["Unknown preference — prompt".into()],
        },
    }
}

fn normalize_close_pref(p: Option<&str>) -> Option<String> {
    match p.map(|s| s.trim()) {
        Some("ask") | Some("quit-and-stop") | Some("minimize-to-tray") => {
            p.map(|s| s.trim().to_string())
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleVerdict {
    pub kind: String,
    pub reasons: Vec<String>,
    pub tray_status: String,
    pub bill_energy: bool,
}

#[derive(Debug, Clone)]
pub struct IdleEvalInput {
    pub user_stopped: bool,
    pub mining_armed: bool,
    pub on_battery: Option<bool>,
    pub idle_ms: Option<u64>,
    pub idle_reliable: bool,
    pub idle_mine_after_ms: u64,
    pub pause_when_active: bool,
    pub pause_on_unplug: bool,
    pub system_sleeping: bool,
    pub keep_awake_consent: bool,
    pub respect_sleep: bool,
    /// When true, XMRig native pause-on-active owns active detection (single coordinator).
    pub engine_pause_on_active_armed: bool,
}

impl Default for IdleEvalInput {
    fn default() -> Self {
        Self {
            user_stopped: false,
            mining_armed: false,
            on_battery: None,
            idle_ms: None,
            idle_reliable: false,
            idle_mine_after_ms: 5 * 60_000,
            pause_when_active: true,
            pause_on_unplug: true,
            system_sleeping: false,
            keep_awake_consent: false,
            respect_sleep: true,
            engine_pause_on_active_armed: false,
        }
    }
}

pub fn evaluate_idle(os: &str, input: &IdleEvalInput) -> IdleVerdict {
    let matrix = capability_matrix(os);

    if input.user_stopped {
        return IdleVerdict {
            kind: "Stopped".into(),
            reasons: vec!["User Stop latched — idle/autostart cannot revive".into()],
            tray_status: "Stopped".into(),
            bill_energy: false,
        };
    }
    if !input.mining_armed {
        return IdleVerdict {
            kind: "Waiting".into(),
            reasons: vec!["Mining not armed — explicit start required".into()],
            tray_status: "Waiting".into(),
            bill_energy: false,
        };
    }
    if input.system_sleeping && (input.respect_sleep || !input.keep_awake_consent) {
        return IdleVerdict {
            kind: "Paused".into(),
            reasons: vec!["Respecting sleep/lid — keep-awake requires explicit consent".into()],
            tray_status: "Paused".into(),
            bill_energy: false,
        };
    }
    if input.pause_on_unplug {
        match input.on_battery {
            None => {
                return IdleVerdict {
                    kind: "Waiting".into(),
                    reasons: vec!["AC presence unknown — will not assume plugged".into()],
                    tray_status: "Waiting".into(),
                    bill_energy: false,
                };
            }
            Some(true) => {
                return IdleVerdict {
                    kind: "Paused".into(),
                    reasons: vec!["Paused on battery / unplugged".into()],
                    tray_status: "Paused".into(),
                    bill_energy: false,
                };
            }
            Some(false) => {}
        }
    }
    if input.pause_when_active {
        let native_active = matrix.pause_on_active.state == "available"
            && input.engine_pause_on_active_armed;
        if native_active {
            // Single coordinator: engine owns active↔idle; app does not second-guess.
            return IdleVerdict {
                kind: "Mining".into(),
                reasons: vec![
                    "Active detection delegated to XMRig pause-on-active (single coordinator)"
                        .into(),
                ],
                tray_status: "Mining".into(),
                bill_energy: true,
            };
        }

        let idle_cap_ok = matches!(
            matrix.idle_timer.state.as_str(),
            "available" | "app-layer"
        );
        if !idle_cap_ok || !input.idle_reliable || input.idle_ms.is_none() {
            return IdleVerdict {
                kind: "Unavailable".into(),
                reasons: vec![
                    "Idle detection unsupported or unreliable — manual pause; not assuming idle"
                        .into(),
                ],
                tray_status: "Waiting".into(),
                bill_energy: false,
            };
        }
        if let Some(idle_ms) = input.idle_ms {
            if idle_ms < input.idle_mine_after_ms {
                return IdleVerdict {
                    kind: "Paused".into(),
                    reasons: vec![format!(
                        "User active (idle {idle_ms}ms < {}ms)",
                        input.idle_mine_after_ms
                    )],
                    tray_status: "Paused".into(),
                    bill_energy: false,
                };
            }
        }
    }
    IdleVerdict {
        kind: "Mining".into(),
        reasons: vec!["Idle / power gates passed".into()],
        tray_status: "Mining".into(),
        bill_energy: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_no_native_pause_on_active() {
        let m = capability_matrix("linux");
        assert_eq!(m.pause_on_active.state, "unsupported");
        let plan = plan_engine_flags(
            "linux",
            &IdleEnginePrefs {
                pause_on_battery: true,
                pause_on_active_seconds: Some(60),
            },
        );
        assert!(plan.argv.iter().any(|a| a == "--pause-on-battery"));
        assert!(!plan.argv.iter().any(|a| a.starts_with("--pause-on-active")));
        assert!(!plan.degradations.is_empty());
    }

    #[test]
    fn windows_emits_pause_flags() {
        let plan = plan_engine_flags(
            "windows",
            &IdleEnginePrefs {
                pause_on_battery: true,
                pause_on_active_seconds: Some(60),
            },
        );
        assert!(plan.argv.iter().any(|a| a == "--pause-on-active=60"));
        assert!(plan.argv.iter().any(|a| a == "--pause-on-battery"));
    }

    #[test]
    fn close_never_defaults_to_tray_mine() {
        let first = resolve_close_behavior(None, None, false, true);
        assert_eq!(first.action, "prompt");
        assert!(!first.hide_to_tray);

        let unauthorized = resolve_close_behavior(
            Some("minimize-to-tray"),
            None,
            false,
            false,
        );
        assert_eq!(unauthorized.action, "quit-and-stop");
        assert!(!unauthorized.hide_to_tray);
    }

    #[test]
    fn stop_and_sleep_do_not_bill() {
        let stopped = evaluate_idle(
            "windows",
            &IdleEvalInput {
                user_stopped: true,
                mining_armed: true,
                ..Default::default()
            },
        );
        assert_eq!(stopped.kind, "Stopped");
        assert!(!stopped.bill_energy);

        let sleep = evaluate_idle(
            "windows",
            &IdleEvalInput {
                mining_armed: true,
                on_battery: Some(false),
                idle_ms: Some(600_000),
                idle_reliable: true,
                system_sleeping: true,
                ..Default::default()
            },
        );
        assert_eq!(sleep.kind, "Paused");
        assert!(!sleep.bill_energy);
    }
}
