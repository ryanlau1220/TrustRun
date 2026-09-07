wit_bindgen::generate!({
    world: "trustrun",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

use crate::host::{interfaces::{http, kv_store}, tenant::tenant_context};
use serde::{Deserialize, Serialize};

const EXECUTOR_ORIGIN: &str = env!("TRUSTRUN_EXECUTOR_ORIGIN");
const SERVICE: &str = "my-api";
const TOKEN_KEY: &[u8] = b"executor_bearer";

struct Component;

#[derive(Deserialize)]
struct ExecutorResponse {
    ok: bool,
    service: Option<String>,
    status: Option<String>,
}

#[derive(Serialize)]
struct ResultBody<'a> {
    ok: bool,
    service: &'a str,
    status: &'a str,
}

fn no_args(req: &exports::trustrun::contract::contracts::GenericInput) -> Result<(), String> {
    if req.input.as_deref() == Some(b"{}") && req.user_profile.is_none() {
        Ok(())
    } else {
        Err("invalid input".into())
    }
}

fn bearer() -> Result<String, String> {
    let map = format!("z:{}:secrets", hex::encode(tenant_context::tenant_did()));
    let bytes = kv_store::get(&map, TOKEN_KEY)
        .map_err(|_| "credential unavailable".to_string())?
        .ok_or_else(|| "credential unavailable".to_string())?;
    String::from_utf8(bytes).map_err(|_| "credential unavailable".to_string())
}

fn call(path: &str) -> Result<ExecutorResponse, String> {
    let response = http::call(&http::Request {
        method: http::Verb::Post,
        url: format!("{EXECUTOR_ORIGIN}{path}"),
        headers: Some(vec![
            ("authorization".into(), format!("Bearer {}", bearer()?)),
            ("content-type".into(), "application/json".into()),
        ]),
        payload: Some(b"{}".to_vec()),
    }).map_err(|_| "executor unavailable".to_string())?;
    if response.code != 200 {
        return Err("operation denied".into());
    }
    serde_json::from_slice(&response.payload).map_err(|_| "executor response rejected".into())
}

fn response(req: &exports::trustrun::contract::contracts::GenericInput, path: &str, allowed: &[&str]) -> Result<Vec<u8>, String> {
    no_args(req)?;
    let result = call(path)?;
    let status = result.status.as_deref().ok_or_else(|| "executor response rejected".to_string())?;
    if !result.ok || result.service.as_deref() != Some(SERVICE) || !allowed.contains(&status) {
        return Err("executor response rejected".into());
    }
    serde_json::to_vec(&ResultBody { ok: true, service: SERVICE, status }).map_err(|_| "executor response rejected".into())
}

#[cfg(target_arch = "wasm32")]
impl exports::trustrun::contract::contracts::Guest for Component {
    fn service_status(req: exports::trustrun::contract::contracts::GenericInput) -> Result<Vec<u8>, String> {
        response(&req, "/v1/service/status", &["running", "not_running"])
    }

    fn service_restart(req: exports::trustrun::contract::contracts::GenericInput) -> Result<Vec<u8>, String> {
        response(&req, "/v1/service/restart", &["restart_requested"])
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);
