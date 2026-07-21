// Xirea desktop — main binary entry point.
// The actual app wiring lives in `lib.rs` so it can be reused by tests
// and mobile targets in the future.

// Hide the console window on Windows in release builds.
// Keep it visible in debug builds for logging.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xirea_desktop_lib::run();
}
