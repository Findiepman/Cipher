fn main() {
    // `CIPHER_DESKTOP_URL` is baked in at compile time (see src/main.rs), and
    // cargo does not know an env var is an input unless told. Without this
    // line, changing the URL and rebuilding hands you the old binary.
    println!("cargo:rerun-if-env-changed=CIPHER_DESKTOP_URL");
    tauri_build::build()
}
