package com.yuivo9999.mybox123;

import android.content.Context;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;

/** Host-side allowlisted proxy for isolated CatVod protocol messages. */
public final class TVBoxJarHostProxy {
    private static final int MAX_FILE_BYTES = 5 * 1024 * 1024;
    private static final int MAX_BODY_CHARS = 192 * 1024;
    private final Context context;
    public TVBoxJarHostProxy(Context context) { this.context = context.getApplicationContext(); }

    public String network(JSONObject payload) {
        try {
            if (payload == null) throw new IllegalArgumentException("TVBOX_JAR_NETWORK_PAYLOAD_REQUIRED");
            String url = payload.optString("url", "");
            String method = payload.optString("method", "GET");
            String body = payload.optString("body", "");
            String contentType = payload.optString("contentType", "application/x-www-form-urlencoded; charset=UTF-8");
            java.util.Map<String,String> headers = new java.util.LinkedHashMap<>();
            JSONObject headerObject = payload.optJSONObject("headers");
            if (headerObject != null) for (java.util.Iterator<String> it = headerObject.keys(); it.hasNext();) { String key = it.next(); headers.put(key, headerObject.optString(key, "")); }
            DrpyHttpRuntime.Response response = DrpyHttpRuntime.request(method, url, body, contentType, headers);
            if (response.body != null && response.body.length() > MAX_BODY_CHARS) return error("TVBOX_JAR_PROXY_RESPONSE_TOO_LARGE");
            JSONObject out = new JSONObject().put("ok", true).put("status", response.status).put("contentType", response.contentType).put("body", response.body == null ? "" : response.body);
            return out.toString();
        } catch (Exception e) { return error(e.getMessage() == null ? "TVBOX_JAR_NETWORK_PROXY_ERROR" : e.getMessage()); }
    }

    public String readFile(JSONObject payload) {
        try {
            String path = payload == null ? "" : payload.optString("path", "");
            File file = new File(path).getCanonicalFile();
            File root = new File(context.getCacheDir(), "tvbox/jar").getCanonicalFile();
            if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new SecurityException("TVBOX_JAR_FILE_PROXY_PATH_DENIED");
            if (!file.isFile() || file.length() > MAX_FILE_BYTES) throw new SecurityException("TVBOX_JAR_FILE_PROXY_FILE_DENIED");
            byte[] data = new byte[(int) file.length()];
            try (FileInputStream input = new FileInputStream(file)) { int offset=0,n; while(offset<data.length && (n=input.read(data,offset,data.length-offset))>0) offset+=n; if(offset!=data.length) throw new java.io.IOException("TVBOX_JAR_FILE_PROXY_READ_INCOMPLETE"); }
            return new JSONObject().put("ok", true).put("path", file.getAbsolutePath()).put("encoding", "UTF-8").put("body", new String(data, StandardCharsets.UTF_8)).toString();
        } catch (Exception e) { return error(e.getMessage() == null ? "TVBOX_JAR_FILE_PROXY_ERROR" : e.getMessage()); }
    }

    private String error(String code) { try { return new JSONObject().put("ok", false).put("code", code).toString(); } catch (Exception ignored) { return "{\"ok\":false,\"code\":\"TVBOX_JAR_PROXY_ERROR\"}"; } }
}