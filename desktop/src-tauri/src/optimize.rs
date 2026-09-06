//! Desktop optimize capability + safe argv planning (#37).

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
pub struct OptimizeMatrix {
    pub os: String,
    pub huge_pages: CapField,
    pub pages1g: CapField,
    pub numa: CapField,
    pub msr: CapField,
    pub priority: CapField,
    pub yield_cpu: CapField,
}

#[derive(Debug, Clone)]
pub struct OptimizeRequest {
    pub huge_pages: bool,
    pub pages1g: bool,
    pub numa: bool,
    pub msr: bool,
    pub msr_consent: bool,
    pub auto_tuner: bool,
    /// When true (default), XMRig may yield to the OS.
    pub yield_cpu: bool,
    pub priority: String,
    pub huge_pages_available: bool,
    pub pages1g_available: bool,
}

impl Default for OptimizeRequest {
    fn default() -> Self {
        Self {
            huge_pages: false,
            pages1g: false,
            numa: false,
            msr: false,
            msr_consent: false,
            auto_tuner: false,
            yield_cpu: true,
            priority: "normal".into(),
            huge_pages_available: false,
            pages1g_available: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizePlan {
    pub argv: Vec<String>,
    pub priority: String,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub elevated: bool,
}

pub fn capability_matrix(os: &str) -> OptimizeMatrix {
    let platform = os.to_ascii_lowercase();
    match platform.as_str() {
        "linux" => OptimizeMatrix {
            os: platform,
            huge_pages: CapField {
                state: "needs-privilege".into(),
                label: "Huge pages".into(),
                reasons: vec!["may need reserved hugepages; never auto sysctl".into()],
            },
            pages1g: CapField {
                state: "needs-privilege".into(),
                label: "1GB pages".into(),
                reasons: vec!["Linux-only; boot/sysctl — never auto-change".into()],
            },
            numa: CapField {
                state: "available".into(),
                label: "NUMA".into(),
                reasons: vec!["XMRig --numa when multi-node".into()],
            },
            msr: CapField {
                state: "needs-privilege".into(),
                label: "MSR".into(),
                reasons: vec!["consent + restore plan required".into()],
            },
            priority: CapField {
                state: "available".into(),
                label: "Process priority".into(),
                reasons: vec!["nice without root for mild adjustments".into()],
            },
            yield_cpu: CapField {
                state: "available".into(),
                label: "CPU yield".into(),
                reasons: vec!["XMRig yield flag".into()],
            },
        },
        "windows" => OptimizeMatrix {
            os: platform,
            huge_pages: CapField {
                state: "needs-privilege".into(),
                label: "Large pages".into(),
                reasons: vec!["SeLockMemoryPrivilege; never auto-grant".into()],
            },
            pages1g: CapField {
                state: "unsupported".into(),
                label: "1GB pages".into(),
                reasons: vec!["Linux-only — do not show enable switch".into()],
            },
            numa: CapField {
                state: "available".into(),
                label: "NUMA".into(),
                reasons: vec!["Windows NUMA when multi-node".into()],
            },
            msr: CapField {
                state: "needs-privilege".into(),
                label: "MSR".into(),
                reasons: vec!["helper not bundled by default".into()],
            },
            priority: CapField {
                state: "available".into(),
                label: "Process priority".into(),
                reasons: vec!["SetPriorityClass; default NORMAL".into()],
            },
            yield_cpu: CapField {
                state: "available".into(),
                label: "CPU yield".into(),
                reasons: vec!["XMRig yield flag".into()],
            },
        },
        "macos" | "darwin" => OptimizeMatrix {
            os: "macos".into(),
            huge_pages: CapField {
                state: "unsupported".into(),
                label: "Huge pages".into(),
                reasons: vec!["no portable enable path".into()],
            },
            pages1g: CapField {
                state: "unsupported".into(),
                label: "1GB pages".into(),
                reasons: vec!["Linux-only".into()],
            },
            numa: CapField {
                state: "unsupported".into(),
                label: "NUMA".into(),
                reasons: vec!["not exposed for miner bind".into()],
            },
            msr: CapField {
                state: "unsupported".into(),
                label: "MSR".into(),
                reasons: vec!["unsupported".into()],
            },
            priority: CapField {
                state: "available".into(),
                label: "Process priority".into(),
                reasons: vec!["QoS / nice hints".into()],
            },
            yield_cpu: CapField {
                state: "available".into(),
                label: "CPU yield".into(),
                reasons: vec!["XMRig yield flag".into()],
            },
        },
        other => OptimizeMatrix {
            os: other.into(),
            huge_pages: unsupported("Huge pages"),
            pages1g: unsupported("1GB pages"),
            numa: unsupported("NUMA"),
            msr: unsupported("MSR"),
            priority: unsupported("Process priority"),
            yield_cpu: unsupported("CPU yield"),
        },
    }
}

fn unsupported(label: &str) -> CapField {
    CapField {
        state: "unsupported".into(),
        label: label.into(),
        reasons: vec!["not a desktop optimize target".into()],
    }
}

pub fn plan_optimize(os: &str, req: &OptimizeRequest) -> OptimizePlan {
    let matrix = capability_matrix(os);
    let mut argv = Vec::new();
    let mut warnings = Vec::new();
    let mut errors = Vec::new();
    let mut priority = if req.priority.is_empty() {
        "normal".to_string()
    } else {
        req.priority.clone()
    };

    if matches!(priority.as_str(), "highest" | "realtime") {
        errors.push(format!("priority {priority} blocked"));
        priority = "normal".into();
        warnings.push("fell back to normal priority".into());
    }

    if req.auto_tuner && (req.huge_pages || req.pages1g || req.msr) {
        warnings.push("auto-tuner ignored privileged optimize requests".into());
    }

    let allow_priv = !req.auto_tuner;

    if req.huge_pages && allow_priv && matrix.huge_pages.state != "unsupported" {
        if req.huge_pages_available {
            argv.push("--huge-pages".into());
        } else {
            warnings.push("huge pages unavailable — continue without".into());
        }
    }

    if req.pages1g {
        if matrix.pages1g.state == "unsupported" {
            warnings.push("1GB pages unsupported on this OS".into());
        } else if allow_priv && req.pages1g_available {
            argv.push("--randomx-1gb-pages".into());
        } else if allow_priv {
            warnings.push("1GB pages not ready — no sysctl changes".into());
        }
    }

    if req.numa && matrix.numa.state == "available" {
        argv.push("--numa".into());
    }

    if req.msr {
        if matrix.msr.state == "unsupported" {
            warnings.push("MSR unsupported".into());
        } else if !req.msr_consent || req.auto_tuner {
            errors.push("MSR requires explicit consent and is blocked for auto-tuner".into());
        } else {
            warnings.push("MSR restore after hard crash is best-effort only".into());
        }
    }

    if !req.yield_cpu {
        argv.push("--cpu-no-yield".into());
    }

    OptimizePlan {
        argv,
        priority,
        warnings,
        errors,
        elevated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_hides_linux_1g_pages() {
        let m = capability_matrix("macos");
        assert_eq!(m.pages1g.state, "unsupported");
        assert_eq!(m.huge_pages.state, "unsupported");
    }

    #[test]
    fn windows_hides_1g_pages() {
        assert_eq!(capability_matrix("windows").pages1g.state, "unsupported");
    }

    #[test]
    fn plan_blocks_realtime_and_msr_without_consent() {
        let plan = plan_optimize(
            "linux",
            &OptimizeRequest {
                msr: true,
                msr_consent: false,
                priority: "realtime".into(),
                yield_cpu: true,
                ..Default::default()
            },
        );
        assert_eq!(plan.priority, "normal");
        assert!(plan.errors.iter().any(|e| e.contains("MSR") || e.contains("priority")));
        assert!(!plan.elevated);
    }

    #[test]
    fn plan_emits_safe_argv() {
        let plan = plan_optimize(
            "linux",
            &OptimizeRequest {
                huge_pages: true,
                huge_pages_available: true,
                numa: true,
                yield_cpu: false,
                ..Default::default()
            },
        );
        assert!(plan.argv.iter().any(|a| a == "--huge-pages"));
        assert!(plan.argv.iter().any(|a| a == "--numa"));
        assert!(plan.argv.iter().any(|a| a == "--cpu-no-yield"));
    }
}
