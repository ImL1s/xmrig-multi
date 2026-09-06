# UX acceptance notes (#56 #57 #58 #59)

Kiln UI (#85) plus shared contracts on this branch.

| Issue | Implemented | Residual / unverified |
|-------|-------------|------------------------|
| #56 Onboarding | Web three-step + launch summary + skip control; `shared/onboarding` state machine (no implicit start) | Physical phone/desktop screenshot matrix & formal usability study |
| #57 Advanced | `shared/staged-apply` hot/restart/unsupported, lock, rollback, expert argv allowlist | Full desktop/Android staged-apply UI wiring for every XMRig field |
| #58 A11y | Content breakpoints, colour+text status, `shared/a11y` viewport/contrast CI | TalkBack/VoiceOver device runs; physical fold lab |
| #59 i18n | `shared/i18n` status codes + units; Android `values` / `values-en` string pairs | Pseudo-loc screenshots; full string audit of every Compose hardcoded leftover |

Commands: see [harness.md](harness.md).
