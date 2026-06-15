use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

fn load_app_url(app: &AppHandle, url: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let escaped_url = serde_json::to_string(url).expect("URL should serialize");
        let _ = window.eval(&format!("window.location.replace({escaped_url});"));
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_startup_error(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let escaped_message = serde_json::to_string(message).expect("message should serialize");
        let _ = window.eval(&format!(
            "document.body.innerHTML = '<main style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:32px;max-width:760px;margin:auto;\"><h1>Miofive Video Converter</h1><p>' + {} + '</p></main>';",
            escaped_message
        ));
        let _ = window.show();
    }
}

fn kill_sidecar(sidecar_child: &Arc<Mutex<Option<CommandChild>>>) {
    if let Some(child) = sidecar_child
        .lock()
        .expect("sidecar child lock poisoned")
        .take()
    {
        let _ = child.kill();
    }
}

pub fn run() {
    let sidecar_child: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
    let sidecar_child_for_setup = Arc::clone(&sidecar_child);
    let sidecar_child_for_exit = Arc::clone(&sidecar_child);
    let sidecar_child_for_run = Arc::clone(&sidecar_child);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let resource_dir = app.path().resource_dir()?.join("resources");
            let (mut rx, child) = app
                .shell()
                .sidecar("miofive-server")?
                .env("PORT", "0")
                .env("HOST", "127.0.0.1")
                .env("MIOFIVE_RESOURCE_DIR", resource_dir)
                .spawn()?;

            *sidecar_child_for_setup.lock().expect("sidecar child lock poisoned") = Some(child);

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let line = String::from_utf8_lossy(&line);
                            if let Ok(payload) = serde_json::from_str::<Value>(line.trim()) {
                                if payload.get("event").and_then(Value::as_str) == Some("ready") {
                                    if let Some(url) = payload.get("url").and_then(Value::as_str) {
                                        load_app_url(&app_handle, url);
                                        return;
                                    }
                                }
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("{}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(error) => {
                            show_startup_error(&app_handle, &error);
                            return;
                        }
                        CommandEvent::Terminated(status) => {
                            show_startup_error(
                                &app_handle,
                                &format!("The converter backend stopped before it was ready: {status:?}"),
                            );
                            return;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                kill_sidecar(&sidecar_child_for_exit);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(move |_app_handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            kill_sidecar(&sidecar_child_for_run);
        }
    });
}
