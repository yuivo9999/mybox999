package com.yuivo9999.mybox123;

import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Controlled native boundary for TVBox extension sources.
 *
 * Drpy has bounded native HTTP plus constrained rule-function operations and a
 * Jsoup-backed jq/pdfh/pdfa/pd selector layer. CSP and EXT remain explicitly
 * unsupported here; JAR uses its separate CatVod Spider bridge.
 */
public final class TVBoxExtensionBridge {
    public static final String JS_NAME = "TVBoxExtensionBridge";
    public static final String CONTRACT_VERSION = "1";
    private static final Set<String> OPERATIONS = new HashSet<>(Arrays.asList(
            "healthCheck", "load", "request", "search", "detail", "episodes", "playUrl"
    ));
    private static final Set<String> KINDS = new HashSet<>(Arrays.asList(
            "csp", "drpy-js", "jar", "ext", "unknown"
    ));
    private static final int MAX_PAYLOAD_CHARS = 512 * 1024;
    private static final int MAX_SCRIPT_CHARS = 1_000_000;

    @JavascriptInterface
    public String getCapabilities() {
        try {
            JSONObject result = new JSONObject();
            result.put("contractVersion", CONTRACT_VERSION);
            result.put("available", true);
            result.put("supportedKinds", new JSONArray().put("drpy-js"));
            result.put("supportedOperations", new JSONArray().put("healthCheck").put("load").put("request").put("search").put("detail").put("episodes").put("playUrl"));
            result.put("runtimeVersion", "drpy-sandbox-4-dom");
            result.put("reason", "DRPY_SANDBOX_RULE_OPERATIONS");
            return result.toString();
        } catch (Exception e) {
            return "{\"available\":false,\"reason\":\"TVBOX_EXTENSION_CAPABILITY_ERROR\"}";
        }
    }

    @JavascriptInterface
    public String execute(String payload) {
        String operation = "";
        String kind = "";
        try {
            if (payload != null && payload.length() > MAX_PAYLOAD_CHARS) return error("TVBOX_EXTENSION_PAYLOAD_TOO_LARGE", operation, kind);
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            operation = input.optString("operation", "");
            JSONObject definition = input.optJSONObject("definition");
            kind = definition == null ? "" : definition.optString("kind", "unknown");

            if (!OPERATIONS.contains(operation)) return error("TVBOX_EXTENSION_OPERATION_UNSUPPORTED", operation, kind);
            if (!KINDS.contains(kind)) return error("TVBOX_EXTENSION_KIND_UNSUPPORTED", operation, kind);
            if (!"drpy-js".equals(kind)) {
                return error("TVBOX_EXTENSION_OPERATION_UNSUPPORTED", operation, kind);
            }

            JSONObject payloadObject = input.optJSONObject("payload");
            if ("healthCheck".equals(operation)) {
                JSONObject result = new JSONObject();
                result.put("ok", true);
                result.put("operation", operation);
                result.put("kind", kind);
                result.put("contractVersion", CONTRACT_VERSION);
                result.put("status", "healthy");
                result.put("runtimeVersion", "drpy-sandbox-4-dom");
                return result.toString();
            }
            if ("load".equals(operation)) {
                String script = payloadObject == null ? "" : payloadObject.optString("script", "");
                if (script.length() > MAX_SCRIPT_CHARS) return error("DRPY_SCRIPT_TOO_LARGE", operation, kind);
                String ruleJson = DrpySandboxRuntime.evaluate(script, DrpyHttpRuntime::request);
                JSONObject result = new JSONObject();
                result.put("ok", true);
                result.put("operation", operation);
                result.put("kind", kind);
                result.put("contractVersion", CONTRACT_VERSION);
                result.put("rule", new JSONObject(ruleJson));
                return result.toString();
            }

            if ("request".equals(operation)) {
                String url = payloadObject == null ? "" : payloadObject.optString("url", "");
                String method = payloadObject == null ? "GET" : payloadObject.optString("method", "GET");
                String body = payloadObject == null ? "" : payloadObject.optString("body", "");
                String contentType = payloadObject == null
                        ? "application/x-www-form-urlencoded; charset=UTF-8"
                        : payloadObject.optString("contentType", "application/x-www-form-urlencoded; charset=UTF-8");
                java.util.Map<String, String> headers = new java.util.LinkedHashMap<>();
                if (payloadObject != null) {
                    JSONObject headerObject = payloadObject.optJSONObject("headers");
                    if (headerObject != null) {
                        java.util.Iterator<String> keys = headerObject.keys();
                        while (keys.hasNext()) {
                            String key = keys.next();
                            headers.put(key, headerObject.optString(key, ""));
                        }
                    }
                }

                DrpyHttpRuntime.Response response = DrpyHttpRuntime.request(method, url, body, contentType, headers);
                JSONObject result = new JSONObject();
                result.put("ok", true);
                result.put("operation", operation);
                result.put("kind", kind);
                result.put("contractVersion", CONTRACT_VERSION);
                result.put("status", response.status);
                result.put("contentType", response.contentType);
                result.put("body", response.body);
                JSONObject responseHeaders = new JSONObject();
                if (response.headers != null) {
                    for (java.util.Map.Entry<String, java.util.List<String>> entry : response.headers.entrySet()) {
                        if (entry.getKey() == null) continue;
                        java.util.List<String> values = entry.getValue();
                        responseHeaders.put(entry.getKey(), values == null ? "" : String.join(", ", values));
                    }
                }
                result.put("headers", responseHeaders);
                result.put("statusCode", response.status);
                return result.toString();
            }

            String script = payloadObject == null ? "" : payloadObject.optString("script", "");
            if (script.length() > MAX_SCRIPT_CHARS) return error("DRPY_SCRIPT_TOO_LARGE", operation, kind);
            String operationPayload = payloadObject == null ? "{}" : payloadObject.optJSONObject("params") != null
                    ? payloadObject.optJSONObject("params").toString()
                    : payloadObject.toString();
            String resultJson = DrpySandboxRuntime.executeOperation(
                    script,
                    operation,
                    operationPayload,
                    DrpyHttpRuntime::request
            );
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("operation", operation);
            result.put("kind", kind);
            result.put("contractVersion", CONTRACT_VERSION);
            result.put("result", resultJson == null ? JSONObject.NULL : new JSONTokener(resultJson).nextValue());
            return result.toString();
        } catch (SecurityException e) {
            return error(e.getMessage() == null ? "DRPY_SCRIPT_SECURITY_ERROR" : e.getMessage(), operation, kind);
        } catch (IllegalArgumentException e) {
            return error(e.getMessage() == null ? "DRPY_SCRIPT_INVALID" : e.getMessage(), operation, kind);
        } catch (Exception e) {
            return error(e.getMessage() == null ? "TVBOX_EXTENSION_EXECUTION_ERROR" : e.getMessage(), operation, kind);
        }
    }

    private String error(String code, String operation, String kind) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("code", code);
            result.put("operation", operation);
            result.put("kind", kind);
            result.put("contractVersion", CONTRACT_VERSION);
            return result.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"TVBOX_EXTENSION_BRIDGE_ERROR\"}";
        }
    }
}
