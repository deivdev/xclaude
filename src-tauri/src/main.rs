#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 2.54 composites with Skia, and that compositor can abort the
    // web process (SIGILL in GrResourceCache under paintToSkiaCanvas): the
    // window goes dead while the sessions keep running unseen. 0 selects the
    // TextureMapper compositor of the earlier releases, still on the GPU.
    // Turning compositing off altogether avoids the crash too, but then every
    // frame is painted on the CPU. Set the variable to 1 to get Skia back.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_USE_SKIA_FOR_COMPOSITION").is_none() {
        std::env::set_var("WEBKIT_USE_SKIA_FOR_COMPOSITION", "0");
    }
    xclaude_lib::run()
}
