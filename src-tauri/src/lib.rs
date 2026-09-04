use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

fn validated_sidecar_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    let valid_url = url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
        && url.port().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none();
    if !valid_url {
        return None;
    }

    Some(url)
}

fn load_app_url(app: &AppHandle, value: &str) -> bool {
    let Some(url) = validated_sidecar_url(value) else {
        return false;
    };

    if let Some(window) = app.get_webview_window("main") {
        if window.navigate(url).is_err() {
            return false;
        }
        let _ = window.show();
        let _ = window.set_focus();
        return true;
    }

    false
}

fn show_startup_error(app: &AppHandle, message: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let escaped_message = serde_json::to_string(message).expect("message should serialize");
        let _ = window.eval(format!(
            "document.body.replaceChildren();const main=document.createElement('main');main.style.cssText='font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:32px;max-width:760px;margin:auto';const heading=document.createElement('h1');heading.textContent='Miofive Video Converter';const detail=document.createElement('p');detail.textContent={};main.append(heading,detail);document.body.append(main);",
            escaped_message
        ));
        let _ = window.show();
    }
}

fn kill_sidecar(sidecar_child: &Arc<Mutex<Option<CommandChild>>>) {
    let child = sidecar_child
        .lock()
        .expect("sidecar child lock poisoned")
        .take();
    if let Some(child) = child {
        #[cfg(unix)]
        {
            // Give the Node sidecar time to terminate its FFmpeg process group and remove
            // an incomplete export before using the plugin's SIGKILL fallback.
            let pid = child.pid() as i32;
            let terminate_result = unsafe { libc::kill(pid, libc::SIGTERM) };
            if terminate_result == 0 {
                // Node allows up to two seconds for HTTP admission to close, FFmpeg's
                // process group to stop, and the reserved partial output to be removed.
                // Poll for slightly longer and hard-kill only if that cleanup contract
                // did not complete.
                for _ in 0..50 {
                    let process_exists = unsafe { libc::kill(pid, 0) } == 0
                        || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
                    if !process_exists {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
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
            let monitored_child = Arc::clone(&sidecar_child_for_setup);

            tauri::async_runtime::spawn(async move {
                let mut ready = false;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let line = String::from_utf8_lossy(&line);
                            if let Ok(payload) = serde_json::from_str::<Value>(line.trim()) {
                                if !ready && payload.get("event").and_then(Value::as_str) == Some("ready") {
                                    if let Some(url) = payload.get("url").and_then(Value::as_str) {
                                        if !load_app_url(&app_handle, url) {
                                            show_startup_error(
                                                &app_handle,
                                                "The converter backend returned an invalid address.",
                                            );
                                        } else {
                                            ready = true;
                                        }
                                    }
                                }
                            }
                        }
                        CommandEvent::Stderr(_line) => {
                            eprintln!("The converter backend reported an error.");
                        }
                        CommandEvent::Error(_error) => {
                            if monitored_child.lock().expect("sidecar child lock poisoned").is_some() {
                                show_startup_error(&app_handle, "The converter backend encountered an error. Quit and reopen the app; your source recordings are unchanged.");
                            }
                        }
                        CommandEvent::Terminated(_status) => {
                            let unexpected = monitored_child.lock().expect("sidecar child lock poisoned").take().is_some();
                            if !unexpected {
                                return; // Quit/CloseRequested already owns intentional shutdown.
                            }
                            show_startup_error(
                                &app_handle,
                                if ready {
                                    "The converter backend stopped. Quit and reopen the app, then check the export destination before retrying. Your source recordings are unchanged."
                                } else {
                                    "The converter backend stopped before it was ready. Quit and reopen the app."
                                },
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
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            kill_sidecar(&sidecar_child_for_run);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::validated_sidecar_url;

    #[test]
    fn accepts_only_an_exact_loopback_sidecar_root() {
        assert!(validated_sidecar_url("http://127.0.0.1:3000/").is_some());
        assert!(validated_sidecar_url("http://localhost:49152/").is_some());

        for value in [
            "https://127.0.0.1:3000/",
            "http://example.test:3000/",
            "http://127.0.0.1/",
            "http://user@127.0.0.1:3000/",
            "http://127.0.0.1:3000/app",
            "http://127.0.0.1:3000/?next=https://example.test",
            "not a url",
        ] {
            assert!(validated_sidecar_url(value).is_none(), "accepted {value}");
        }
    }
}
