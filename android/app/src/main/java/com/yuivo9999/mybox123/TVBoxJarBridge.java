package com.yuivo9999.mybox123;

import android.content.Context;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Stage-3 TVBox JAR runtime boundary.
 *
 * Stage-4 JAR runtime boundary. JARs are acquired into a verified app cache,
 * inspected, then loaded through DexClassLoader against the host CatVod Spider
 * ABI. This is an execution boundary, not a security sandbox: downloaded JAR
 * bytecode can access whatever Android APIs the host process exposes, so only
 * explicitly classified Spider sources should reach execution.
 */
public final class TVBoxJarBridge {
    public static final String JS_NAME = "TVBoxJarBridge";
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 12_000;
    private static final int MAX_JAR_BYTES = 20 * 1024 * 1024;
    private static final int MAX_PAYLOAD_CHARS = 256 * 1024;
    private static final int MAX_RESULT_CHARS = 5 * 1024 * 1024;
    private static final long SPIDER_TIMEOUT_MS = 20_000L;

    private final Context context;
    private final TVBoxJarIsolatedClient isolatedClient;
    private final ExecutorService executionExecutor = Executors.newSingleThreadExecutor();

    public TVBoxJarBridge(Context context) {
        this.context = context.getApplicationContext();
        this.isolatedClient = new TVBoxJarIsolatedClient(this.context);
    }

    @JavascriptInterface
    public String getCapabilities() {
        try {
            JSONObject result = new JSONObject();
            result.put("contractVersion", "1");
            result.put("available", true);
            result.put("stage", 4);
            result.put("supportedKinds", new org.json.JSONArray().put("jar"));
            result.put("supportedOperations", new org.json.JSONArray().put("prepare").put("inspect").put("home").put("category").put("detail").put("search").put("play"));
            result.put("executionEnabled", true);
            result.put("executionMode", "isolated-in-memory-dex");
            result.put("isolatedProcessReady", true);
            result.put("isolatedProcessMode", "in-memory-dex");
            result.put("networkAccess", "not-granted-to-isolated-process");
            result.put("isolatedProcessNetworkProxyRequired", true);
            result.put("reason", "CATVOD_SPIDER_ABI_ISOLATED_IN_MEMORY_DEX_NETWORK_PROXY_PENDING");
            return result.toString();
        } catch (Exception e) {
            return "{\"available\":false,\"reason\":\"TVBOX_JAR_CAPABILITY_ERROR\"}";
        }
    }

    @JavascriptInterface
    public String execute(String payload) {
        try {
            JSONObject input = new JSONObject(payload == null ? "{}" : payload);
            if (payload != null && payload.length() > MAX_PAYLOAD_CHARS) return error("TVBOX_JAR_PAYLOAD_TOO_LARGE");
            String operation = input.optString("operation", "");
            JSONObject data = input.optJSONObject("payload");
            if ("prepare".equals(operation)) return prepare(data);
            if ("inspect".equals(operation)) return inspect(data);
            if ("home".equals(operation) || "category".equals(operation) || "detail".equals(operation)
                    || "search".equals(operation) || "play".equals(operation)) return executeSpider(operation, data);
            return error("TVBOX_JAR_OPERATION_UNSUPPORTED");
        } catch (SecurityException e) {
            return error(e.getMessage() == null ? "TVBOX_JAR_SECURITY_ERROR" : e.getMessage());
        } catch (Throwable e) {
            return error(e.getMessage() == null ? "TVBOX_JAR_ERROR" : e.getMessage());
        }
    }

    private String prepare(JSONObject data) throws Exception {
        String url = data == null ? "" : data.optString("url", "");
        if (!url.matches("(?i)^https?://.+")) throw new SecurityException("TVBOX_JAR_URL_REQUIRED");

        String expectedMd5 = normalizeDigest(data.optString("md5", ""));
        File dir = new File(context.getCacheDir(), "tvbox/jar");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("TVBOX_JAR_CACHE_CREATE_FAILED");

        String fileName = safeFileName(data.optString("name", "spider")) + "_" + shortSha256(url) + ".jar";
        File target = new File(dir, fileName);
        boolean reused = false;
        if (target.isFile() && target.length() > 0 && !expectedMd5.isEmpty()) {
            String cachedMd5 = md5(target);
            reused = expectedMd5.equals(cachedMd5);
            if (!reused) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
            }
        }
        if (!reused) {
            try {
                download(url, target);
            } catch (Throwable error) {
                // Never retain a partial or over-sized artifact after a failed download.
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                throw error;
            }
        }
        String actualMd5 = md5(target);
        if (!expectedMd5.isEmpty() && !expectedMd5.equals(actualMd5)) {
            // Never retain a file that failed an explicit integrity check.
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw new SecurityException("TVBOX_JAR_MD5_MISMATCH");
        }

        JSONObject result = new JSONObject();
        result.put("ok", true);
        result.put("operation", "prepare");
        result.put("path", target.getAbsolutePath());
        result.put("size", target.length());
        result.put("md5", actualMd5);
        result.put("executionEnabled", true);
        result.put("executionMode", "isolated-in-memory-dex");
        result.put("isolatedProcessReady", true);
        result.put("isolatedProcessMode", "in-memory-dex");
        result.put("networkAccess", "not-granted-to-isolated-process");
        result.put("isolatedProcessNetworkProxyRequired", true);
        result.put("reused", reused);
        return result.toString();
    }

    private String executeSpider(String operation, JSONObject data) throws Exception {
        if (data == null) throw new IllegalArgumentException("TVBOX_JAR_PAYLOAD_REQUIRED");
        String path = data.optString("path", "");
        if (path.isEmpty()) throw new IllegalArgumentException("TVBOX_JAR_PATH_REQUIRED");
        String className = data.optString("className", "");
        File jarFile = new File(path).getCanonicalFile();
        File cache = new File(context.getCacheDir(), "tvbox/jar").getCanonicalFile();
        if (!jarFile.getPath().startsWith(cache.getPath() + File.separator)) throw new SecurityException("TVBOX_JAR_PATH_OUTSIDE_CACHE");
        if (!jarFile.isFile() || jarFile.length() > MAX_JAR_BYTES) throw new SecurityException("TVBOX_JAR_NOT_READY");
        Future<String> future = executionExecutor.submit(new Callable<String>() {
            @Override public String call() throws Exception {
                return isolatedClient.execute(jarFile, className, operation, data.toString());
            }
        });
        try {
            String result = future.get(SPIDER_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (result != null && result.length() > MAX_RESULT_CHARS) throw new SecurityException("TVBOX_JAR_RESULT_TOO_LARGE");
            return result;
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new SecurityException("TVBOX_JAR_EXECUTION_TIMEOUT");
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            if (cause instanceof Error) throw (Error) cause;
            throw new Exception("TVBOX_JAR_EXECUTION_FAILED");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new SecurityException("TVBOX_JAR_EXECUTION_INTERRUPTED");
        }
    }

    private String inspect(JSONObject data) throws Exception {
        String path = data == null ? "" : data.optString("path", "");
        if (path.isEmpty()) throw new IllegalArgumentException("TVBOX_JAR_PATH_REQUIRED");
        File file = new File(path).getCanonicalFile();
        File cache = new File(context.getCacheDir(), "tvbox/jar").getCanonicalFile();
        if (!file.getPath().startsWith(cache.getPath() + File.separator)) {
            throw new SecurityException("TVBOX_JAR_PATH_OUTSIDE_CACHE");
        }
        if (!file.isFile()) throw new IOException("TVBOX_JAR_NOT_FOUND");
        if (file.length() > MAX_JAR_BYTES) throw new SecurityException("TVBOX_JAR_TOO_LARGE");

        java.util.jar.JarFile jar = new java.util.jar.JarFile(file);
        int classCount = 0;
        boolean hasSpiderPackage = false;
        try {
            java.util.Enumeration<java.util.jar.JarEntry> entries = jar.entries();
            while (entries.hasMoreElements()) {
                java.util.jar.JarEntry entry = entries.nextElement();
                if (entry.isDirectory()) continue;
                String name = entry.getName();
                if (name.endsWith(".class")) {
                    classCount++;
                    if (name.startsWith("com/github/catvod/spider/")) hasSpiderPackage = true;
                }
            }
        } finally {
            jar.close();
        }

        JSONObject result = new JSONObject();
        result.put("ok", true);
        result.put("operation", "inspect");
        result.put("path", file.getAbsolutePath());
        result.put("size", file.length());
        result.put("md5", md5(file));
        result.put("classCount", classCount);
        result.put("hasCatVodSpiderPackage", hasSpiderPackage);
        result.put("executionEnabled", false);
        result.put("executionMode", "inspection-only");
        return result.toString();
    }

    private static void download(String urlString, File target) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlString).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "MyBox-TVBox-Jar/1");
        try (InputStream input = connection.getInputStream();
             FileOutputStream output = new FileOutputStream(target)) {
            int total = 0;
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_JAR_BYTES) throw new SecurityException("TVBOX_JAR_TOO_LARGE");
                output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String md5(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("MD5");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        byte[] bytes = digest.digest();
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(Locale.US, "%02x", b));
        return result.toString();
    }

    private static String shortSha256(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = digest.digest(String.valueOf(value).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < 6; i++) result.append(String.format(Locale.US, "%02x", bytes[i]));
        return result.toString();
    }

    private static String normalizeDigest(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.US);
        return normalized.matches("^[0-9a-f]{32}$") ? normalized : "";
    }

    private static String safeFileName(String value) {
        String normalized = value == null ? "spider" : value.replaceAll("[^a-zA-Z0-9._-]", "_");
        return normalized.isEmpty() ? "spider" : normalized.substring(0, Math.min(80, normalized.length()));
    }

    public void release() {
        executionExecutor.shutdownNow();
        isolatedClient.close();
    }

    private String error(String code) {
        try {
            return new JSONObject().put("ok", false).put("code", code).put("contractVersion", "1").toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"TVBOX_JAR_ERROR\"}";
        }
    }
}
