package com.yuivo9999.mybox123;

import android.content.Context;

import dalvik.system.DexClassLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.lang.reflect.Method;
import java.lang.reflect.InvocationTargetException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * Stage-4 JAR Spider invocation.
 *
 * The JAR is loaded only from the application's verified cache and only a
 * com.github.catvod.spider.* implementation is considered. The compatibility
 * Spider ABI is supplied by the host app. This is an execution boundary, not a
 * security sandbox: arbitrary JAR bytecode must still be treated as trusted
 * code. The caller therefore only reaches this executor for explicitly
 * classified JAR sources.
 */
public final class TVBoxJarExecutor {
    private final Context context;

    public TVBoxJarExecutor(Context context) {
        this.context = context.getApplicationContext();
    }

    public synchronized String invoke(File jarFile, String className, String operation, JSONObject payload) throws Exception {
        File cache = new File(context.getCacheDir(), "tvbox/jar").getCanonicalFile();
        File file = jarFile.getCanonicalFile();
        if (!file.getPath().startsWith(cache.getPath() + File.separator)) {
            throw new SecurityException("TVBOX_JAR_PATH_OUTSIDE_CACHE");
        }
        if (!file.isFile()) throw new IllegalArgumentException("TVBOX_JAR_NOT_FOUND");

        String classNameResolved = resolveClassName(file, className);
        // Android 14 (API 34+) enforces W^X (Write XOR Execute) policy on dynamic code loading.
        // The file MUST be marked read-only before passing to DexClassLoader.
        try { file.setReadOnly(); } catch (Throwable ignored) {}

        File optimized = new File(context.getCodeCacheDir(), "tvbox-jar");
        if (!optimized.exists() && !optimized.mkdirs()) throw new IllegalStateException("TVBOX_JAR_DEX_CACHE_FAILED");
        try { optimized.setWritable(true, true); } catch (Throwable ignored) {}

        DexClassLoader loader = new DexClassLoader(
                file.getAbsolutePath(),
                optimized.getAbsolutePath(),
                null,
                context.getClassLoader()
        );

        Class<?> clazz = loader.loadClass(classNameResolved);
        if (!com.github.catvod.crawler.Spider.class.isAssignableFrom(clazz)) {
            throw new UnsupportedOperationException("TVBOX_JAR_NOT_SPIDER");
        }

        com.github.catvod.crawler.Spider spider =
                (com.github.catvod.crawler.Spider) clazz.getDeclaredConstructor().newInstance();

        JSONObject data = payload == null ? new JSONObject() : payload;
        try {
            String extend = data.has("ext") ? data.opt("ext").toString() : "";
            if (extend.isEmpty() && data.has("extend")) {
                extend = data.opt("extend").toString();
            }
            spider.init(context, extend);
            Object result = call(spider, operation, data);
            JSONObject output = new JSONObject();
            output.put("ok", true);
            output.put("operation", operation);
            output.put("className", clazz.getName());
            if (result == null) output.put("result", JSONObject.NULL);
            else output.put("result", result);
            return output.toString();
        } finally {
            try { spider.destroy(); } catch (Throwable ignored) {}
        }
    }

    private Object call(com.github.catvod.crawler.Spider spider, String operation, JSONObject data) throws Exception {
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
            } catch (Exception e) {
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
                    extend
            );
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
                    toStringList(data.optJSONArray("vipFlags"))
            );
        }
        throw new IllegalArgumentException("TVBOX_JAR_OPERATION_UNSUPPORTED:" + operation);
    }

    private static List<String> toStringList(JSONArray array) {
        List<String> result = new ArrayList<>();
        if (array == null) return result;
        for (int i=0; i<array.length(); i++) result.add(array.optString(i, ""));
        return result;
    }

    private static String resolveClassName(File file, String requested) throws Exception {
        if (requested != null && requested.matches("^com\\.github\\.catvod\\.spider\\.[A-Za-z0-9_$]+$")) {
            return requested;
        }
        java.util.jar.JarFile jar = new java.util.jar.JarFile(file);
        try {
            java.util.Enumeration<java.util.jar.JarEntry> entries = jar.entries();
            String candidate = null;
            while (entries.hasMoreElements()) {
                String name = entries.nextElement().getName();
                if (!name.startsWith("com/github/catvod/spider/") || !name.endsWith(".class") || name.contains("$")) continue;
                String cls = name.substring(0, name.length()-6).replace('/', '.');
                if (candidate == null) candidate = cls;
                if (requested != null && !requested.isEmpty()) {
                    String simple = cls.substring(cls.lastIndexOf('.')+1);
                    if (simple.equals(requested) || cls.equals(requested)) return cls;
                }
            }
            if (candidate == null) throw new ClassNotFoundException("TVBOX_JAR_SPIDER_CLASS_NOT_FOUND");
            return candidate;
        } finally {
            jar.close();
        }
    }
}
