package com.yuivo9999.mybox123;

import android.content.Context;
import android.os.Build;
import android.os.ParcelFileDescriptor;

import dalvik.system.InMemoryDexClassLoader;

import com.github.catvod.crawler.Spider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * CatVod executor used only from the Android isolated process.
 *
 * The verified JAR is transferred as a file descriptor and its classes.dex
 * entries are loaded in memory. The isolated process never needs the host
 * application's private JAR path.
 *
 * Network/file access performed by third-party Spider code is intentionally
 * not granted by this class. A future proxy-aware Spider ABI must explicitly
 * use the Messenger protocol before those capabilities are enabled.
 */
public final class TVBoxJarIsolatedExecutor {
    private static final int MAX_JAR_BYTES = 20 * 1024 * 1024;
    private static final int MAX_DEX_BYTES = 20 * 1024 * 1024;
    private static final int MAX_RESULT_CHARS = 192 * 1024;

    private final Context context;

    public TVBoxJarIsolatedExecutor(Context context) {
        this.context = context.getApplicationContext();
    }

    public String invoke(ParcelFileDescriptor descriptor, String className,
                         String operation, JSONObject payload) throws Exception {
        if (descriptor == null) throw new IllegalArgumentException("TVBOX_JAR_FD_REQUIRED");
        if (Build.VERSION.SDK_INT < 26) throw new UnsupportedOperationException("TVBOX_JAR_ISOLATED_DEX_UNSUPPORTED_API");
        if (className == null || className.trim().isEmpty()) {
            throw new IllegalArgumentException("TVBOX_JAR_CLASS_NAME_REQUIRED_FOR_ISOLATED_EXECUTION");
        }
        List<ByteBuffer> dexBuffers = extractDex(descriptor);
        if (dexBuffers.isEmpty()) throw new IllegalArgumentException("TVBOX_JAR_DEX_NOT_FOUND");
        InMemoryDexClassLoader loader = new InMemoryDexClassLoader(
                dexBuffers.toArray(new ByteBuffer[0]), context.getClassLoader());
        Class<?> clazz = loader.loadClass(className.trim());
        if (!Spider.class.isAssignableFrom(clazz)) {
            throw new UnsupportedOperationException("TVBOX_JAR_NOT_SPIDER");
        }

        Spider spider = (Spider) clazz.getDeclaredConstructor().newInstance();
        JSONObject data = payload == null ? new JSONObject() : payload;
        try {
            String extend = data.has("ext") ? data.opt("ext").toString() : "";
            if (extend.isEmpty() && data.has("extend")) extend = data.opt("extend").toString();
            spider.init(context, extend);
            Object result = call(spider, operation, data);
            JSONObject output = new JSONObject()
                    .put("ok", true)
                    .put("executionMode", "isolated-in-memory-dex")
                    .put("operation", operation)
                    .put("className", clazz.getName())
                    .put("result", result == null ? JSONObject.NULL : result);
            String text = output.toString();
            if (text.length() > MAX_RESULT_CHARS) {
                throw new IllegalArgumentException("TVBOX_JAR_ISOLATED_RESULT_TOO_LARGE");
            }
            return text;
        } finally {
            try { spider.destroy(); } catch (Throwable ignored) {}
        }
    }

    private static Object call(Spider spider, String operation, JSONObject data) throws Exception {
        if ("home".equals(operation)) {
            String home = spider.homeContent(data.optBoolean("filter", false));
            try {
                JSONObject result = new JSONObject(home);
                try {
                    String video = spider.homeVideoContent();
                    if (video != null && !video.isEmpty()) {
                        JSONObject videoObject = new JSONObject(video);
                        JSONArray list = videoObject.optJSONArray("list");
                        if (list != null && list.length() > 0) result.put("list", list);
                    }
                } catch (Throwable ignored) {}
                return result;
            } catch (Exception ignored) {
                return home;
            }
        }
        if ("category".equals(operation)) {
            HashMap<String,String> extend = new HashMap<>();
            JSONObject ext = data.optJSONObject("extend");
            if (ext != null) {
                java.util.Iterator<String> keys = ext.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    extend.put(key, ext.optString(key, ""));
                }
            }
            return spider.categoryContent(
                    data.optString("tid", ""),
                    data.optString("pg", "1"),
                    data.optBoolean("filter", false),
                    extend);
        }
        if ("detail".equals(operation)) {
            return spider.detailContent(toStringList(data.optJSONArray("ids")));
        }
        if ("search".equals(operation)) {
            String key = data.optString("key", "");
            String pg = data.optString("pg", "1");
            try {
                return spider.searchContent(key, data.optBoolean("quick", true), pg);
            } catch (NoSuchMethodError | AbstractMethodError ignored) {
                return spider.searchContent(key, data.optBoolean("quick", true));
            }
        }
        if ("play".equals(operation)) {
            return spider.playerContent(
                    data.optString("flag", ""),
                    data.optString("id", ""),
                    toStringList(data.optJSONArray("vipFlags")));
        }
        throw new IllegalArgumentException("TVBOX_JAR_OPERATION_UNSUPPORTED:" + operation);
    }

    private static List<String> toStringList(JSONArray array) {
        List<String> result = new ArrayList<>();
        if (array == null) return result;
        for (int i = 0; i < array.length(); i++) result.add(array.optString(i, ""));
        return result;
    }

    private static List<ByteBuffer> extractDex(ParcelFileDescriptor descriptor) throws Exception {
        List<ByteBuffer> result = new ArrayList<>();
        int total = 0;
        try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
             ZipInputStream zip = new ZipInputStream(input)) {
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (!name.matches("classes(?:[2-9][0-9]*)?\\.dex")) continue;
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                int entryBytes = 0;
                int read;
                while ((read = zip.read(buffer)) != -1) {
                    entryBytes += read;
                    total += read;
                    if (entryBytes > MAX_DEX_BYTES || total > MAX_JAR_BYTES) {
                        throw new IllegalArgumentException("TVBOX_JAR_DEX_TOO_LARGE");
                    }
                    output.write(buffer, 0, read);
                }
                result.add(ByteBuffer.wrap(output.toByteArray()));
                zip.closeEntry();
            }
        }
        return result;
    }
}
