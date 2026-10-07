#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 2.54 composites with Skia on the GPU, and that compositor can
    // abort the web process (SIGILL in GrResourceCache): the window goes dead
    // while the sessions keep running unseen. A terminal gains nothing from it,
    // xterm.js keeps WebGL. Set the variable to 0 to turn compositing back on.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    xclaude_lib::run()
}
