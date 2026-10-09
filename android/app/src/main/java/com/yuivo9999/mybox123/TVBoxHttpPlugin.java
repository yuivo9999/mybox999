package com.yuivo9999.mybox123;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Dns;
import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.dnsoverhttps.DnsOverHttps;

@CapacitorPlugin(name = "TVBoxHttp")
public class TVBoxHttpPlugin extends Plugin {
    private static final long DEFAULT_TIMEOUT_MS = 15000L;
    private static final long MAX_TIMEOUT_MS = 120000L;

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url", "");
        String method = call.getString("method", "GET").toUpperCase(Locale.US);
        long timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000L, call.getLong("timeoutMs", DEFAULT_TIMEOUT_MS)));
        String dohUrl = call.getString("dohUrl", "");

        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            reject(call, "INVALID_URL");
            return;
        }

        try {
            OkHttpClient client = buildClient(timeoutMs, dohUrl, call.getArray("dohBootstrapIps"));
            Request.Builder builder = new Request.Builder().url(url);
            JSObject headers = call.getObject("headers");
            if (headers != null) {
                Iterator<String> headerKeys = headers.keys();
                while (headerKeys.hasNext()) {
                    String key = headerKeys.next();
                    builder.header(key, String.valueOf(headers.get(key)));
                }
            }

            String body = call.getString("body", null);
            if ("GET".equals(method) || "HEAD".equals(method)) {
                builder.method(method, null);
            } else {
                String contentType = headers != null && headers.has("Content-Type")
                    ? String.valueOf(headers.get("Content-Type"))
                    : "application/json; charset=utf-8";
                MediaType mediaType = MediaType.parse(contentType);
                RequestBody requestBody = body == null ? RequestBody.create(new byte[0], mediaType) : RequestBody.create(body, mediaType);
                builder.method(method, requestBody);
            }

            client.newCall(builder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call request, IOException e) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    ret.put("status", 0);
                    ret.put("error", classify(e));
                    ret.put("url", url);
                    call.resolve(ret);
                }

                @Override
                public void onResponse(Call request, Response response) {
                    try (ResponseBody responseBody = response.body()) {
                        JSObject ret = new JSObject();
                        ret.put("ok", response.isSuccessful());
                        ret.put("status", response.code());
                        ret.put("url", response.request().url().toString());
                        ret.put("body", responseBody == null ? "" : responseBody.string());

                        JSObject responseHeaders = new JSObject();
                        for (Map.Entry<String, List<String>> entry : response.headers().toMultimap().entrySet()) {
                            responseHeaders.put(entry.getKey(), String.join(", ", entry.getValue()));
                        }
                        ret.put("headers", responseHeaders);
                        call.resolve(ret);
                    } catch (IOException e) {
                        reject(call, "RESPONSE_READ_ERROR");
                    }
                }
            });
        } catch (Exception e) {
            reject(call, e.getClass().getSimpleName());
        }
    }

    private OkHttpClient buildClient(long timeoutMs, String dohUrl, com.getcapacitor.JSArray bootstrapIps) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS);

        if (dohUrl != null && !dohUrl.trim().isEmpty()) {
            HttpUrl parsed = HttpUrl.parse(dohUrl.trim());
            if (parsed == null || !("https".equals(parsed.scheme()) || "http".equals(parsed.scheme()))) {
                throw new IllegalArgumentException("INVALID_DOH_URL");
            }

            OkHttpClient bootstrap = new OkHttpClient.Builder()
                .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .dns(Dns.SYSTEM)
                .build();

            DnsOverHttps.Builder dohBuilder = new DnsOverHttps.Builder()
                .client(bootstrap)
                .url(parsed)
                .systemDns(Dns.SYSTEM)
                .includeIPv6(true)
                .resolvePublicAddresses(true)
                .resolvePrivateAddresses(false);

            List<InetAddress> bootstrapHosts = parseBootstrapIps(bootstrapIps);
            if (!bootstrapHosts.isEmpty()) {
                dohBuilder.bootstrapDnsHosts(bootstrapHosts);
            }

            builder.dns(dohBuilder.build());
        }

        return builder.build();
    }

    private List<InetAddress> parseBootstrapIps(com.getcapacitor.JSArray values) {
        List<InetAddress> result = new ArrayList<>();
        if (values == null) return result;
        for (int i = 0; i < values.length(); i++) {
            try {
                String value = values.getString(i).trim();
                if (!value.isEmpty()) result.add(InetAddress.getByName(value));
            } catch (Exception ignored) {
                // Ignore malformed bootstrap entries; system DNS remains available.
            }
        }
        return result;
    }

    private String classify(IOException e) {
        String raw = String.valueOf(e.getMessage()).toLowerCase(Locale.US);
        if (raw.contains("timeout")) return "TIMEOUT";
        if (raw.contains("unknownhost") || raw.contains("dns")) return "DNS_ERROR";
        if (raw.contains("ssl") || raw.contains("tls") || raw.contains("certificate")) return "TLS_ERROR";
        return "NETWORK_ERROR";
    }

    private void reject(PluginCall call, String code) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("status", 0);
        ret.put("error", code);
        call.resolve(ret);
    }
}
