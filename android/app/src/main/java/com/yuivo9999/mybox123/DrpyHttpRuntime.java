package com.yuivo9999.mybox123;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Controlled, bounded HTTP runtime for the Drpy sandbox. */
public final class DrpyHttpRuntime {
    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS = 12_000;
    private static final int MAX_REDIRECTS = 4;
    private static final int MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

    private DrpyHttpRuntime() {}

    public static Response request(String method, String urlString, String body, String contentType) throws IOException {
        return request(method, urlString, body, contentType, java.util.Collections.emptyMap(), 0);
    }

    public static Response request(String method, String urlString, String body, String contentType, Map<String, String> headers) throws IOException {
        return request(method, urlString, body, contentType, headers == null ? java.util.Collections.emptyMap() : headers, 0);
    }

    private static Response request(String method, String urlString, String body, String contentType, Map<String, String> headers, int redirects) throws IOException {
        if (urlString == null || urlString.trim().isEmpty()) throw new IllegalArgumentException("DRPY_HTTP_URL_REQUIRED");
        if (redirects > MAX_REDIRECTS) throw new IOException("DRPY_HTTP_REDIRECT_LIMIT");

        URI uri;
        try {
            uri = URI.create(urlString.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("DRPY_HTTP_URL_INVALID");
        }

        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new SecurityException("DRPY_HTTP_SCHEME_UNSUPPORTED");
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(uri.toString()).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestMethod(normalizeMethod(method));
        connection.setRequestProperty("Accept", "*/*");
        connection.setRequestProperty("User-Agent", "MyBox-TVBox-Drpy/1");
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if (header.getKey() != null && !header.getKey().trim().isEmpty() && header.getValue() != null) connection.setRequestProperty(header.getKey(), header.getValue());
        }
        if (contentType != null && !contentType.trim().isEmpty()) {
            connection.setRequestProperty("Content-Type", contentType.trim());
        }

        if (body != null && !body.isEmpty() && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_RESPONSE_BYTES) throw new IllegalArgumentException("DRPY_HTTP_REQUEST_TOO_LARGE");
            connection.setDoOutput(true);
            connection.getOutputStream().write(bytes);
        }

        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null || location.trim().isEmpty()) throw new IOException("DRPY_HTTP_REDIRECT_LOCATION_MISSING");
            return request(method, uri.resolve(location).toString(), body, contentType, headers, redirects + 1);
        }

        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        byte[] bytes = readBounded(stream);
        Charset responseCharset = StandardCharsets.UTF_8;
        String responseContentType = connection.getContentType();
        String charset = extractCharset(responseContentType);
        if (charset != null) {
            try { responseCharset = Charset.forName(charset); } catch (Exception ignored) {}
        }

        Response result = new Response(status, responseContentType, new String(bytes, responseCharset), connection.getHeaderFields());
        connection.disconnect();
        return result;
    }

    private static String normalizeMethod(String method) {
        String value = method == null ? "GET" : method.trim().toUpperCase();
        if (!"GET".equals(value) && !"POST".equals(value) && !"HEAD".equals(value)) {
            throw new IllegalArgumentException("DRPY_HTTP_METHOD_UNSUPPORTED");
        }
        return value;
    }

    private static byte[] readBounded(InputStream stream) throws IOException {
        if (stream == null) return new byte[0];
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new IOException("DRPY_HTTP_RESPONSE_TOO_LARGE");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static String extractCharset(String contentType) {
        if (contentType == null) return null;
        String lower = contentType.toLowerCase();
        int index = lower.indexOf("charset=");
        if (index < 0) return null;
        String value = contentType.substring(index + 8).trim();
        int semicolon = value.indexOf(';');
        if (semicolon >= 0) value = value.substring(0, semicolon).trim();
        if (value.startsWith("\"") && value.endsWith("\"") && value.length() > 1) {
            value = value.substring(1, value.length() - 1);
        }
        return value;
    }

    public static final class Response {
        public final int status;
        public final String contentType;
        public final String body;
        public final Map<String, List<String>> headers;

        Response(int status, String contentType, String body, Map<String, List<String>> headers) {
            this.status = status;
            this.contentType = contentType == null ? "" : contentType;
            this.body = body == null ? "" : body;
            this.headers = headers;
        }
    }
}
