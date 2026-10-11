package com.yuivo9999.mybox123;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

/**
 * Controlled DOM/selector helper for Drpy selector rules.
 *
 * Supports the common jq-style grammar used by Drpy:
 *   selector&&Text
 *   selector&&Html
 *   selector&&attr
 *   selector&&selector2&&Text
 *   body&&...
 *
 * pdfa returns JSON objects carrying serialized element HTML and base URL so
 * selector results can safely be passed back into pdfh/pd without exposing a
 * Java DOM object to Rhino.
 */
public final class DrpyDomRuntime {
    private DrpyDomRuntime() {}

    public static String pdfh(String input, String parse, String baseUrl) {
        if (parse == null || parse.trim().isEmpty()) return "";
        DomValue value = DomValue.from(input);
        return extract(value.html, parse.trim(), baseUrl, false);
    }

    public static String pdfa(String input, String parse, String baseUrl) {
        if (parse == null || parse.trim().isEmpty()) return "[]";
        DomValue value = DomValue.from(input);
        String selector = normalizeSelector(parse.trim(), true);
        Elements elements = select(value.html, selector);
        JSONArray result = new JSONArray();
        for (Element element : elements) {
            JSONObject item = new JSONObject();
            try {
                item.put("__drpyDom", true);
                item.put("html", element.outerHtml());
                item.put("baseUrl", baseUrl == null ? value.baseUrl : baseUrl);
                result.put(item);
            } catch (Exception e) {
                throw new IllegalStateException("DRPY_DOM_RESULT_ERROR", e);
            }
        }
        return result.toString();
    }

    public static String pd(String input, String parse, String uri, String baseUrl) {
        String value = pdfh(input, parse, baseUrl);
        if (value == null || value.isEmpty()) return "";
        String option = optionOf(parse);
        if (isUrlAttribute(option) && !isSpecialUrl(value)) {
            String target = value;
            int http = target.indexOf("http");
            if (http > 0) target = target.substring(http);
            if (!target.matches("(?i)^https?://.*")) {
                String base = uri == null || uri.isEmpty() ? baseUrl : uri;
                target = resolve(base, target);
            }
            return target;
        }
        return value;
    }

    public static String selectText(String input, String selector, String baseUrl) {
        return pdfh(input, selector + "&&Text", baseUrl);
    }

    private static String extract(String html, String parse, String baseUrl, boolean listMode) {
        String selector = normalizeSelector(parse, false);
        String option = optionOf(parse);
        Elements elements = select(html, selector);
        if (elements.isEmpty()) return "";

        Element first = elements.first();
        if ("Text".equalsIgnoreCase(option)) return first.text();
        if ("Html".equalsIgnoreCase(option)) return first.html();
        if ("OuterHtml".equalsIgnoreCase(option)) return first.outerHtml();
        if ("Value".equalsIgnoreCase(option)) return first.val();

        if (option != null && !option.isEmpty()) {
            String value = first.attr(option);
            if (option.toLowerCase().contains("style") && value.contains("url(")) {
                int start = value.indexOf("url(") + 4;
                int end = value.indexOf(')', start);
                if (end > start) value = value.substring(start, end).replaceAll("^[\\\"']|[\\\"']$", "");
            }
            if (isUrlAttribute(option) && !isSpecialUrl(value) && !value.matches("(?i)^https?://.*")) {
                value = resolve(baseUrl, value);
            }
            return value;
        }
        return first.outerHtml();
    }

    private static Elements select(String html, String selector) {
        Document document = Jsoup.parse(html == null ? "" : html);
        try {
            return document.select(selector);
        } catch (Exception e) {
            throw new IllegalArgumentException("DRPY_SELECTOR_INVALID:" + selector);
        }
    }

    private static String normalizeSelector(String parse, boolean arrayMode) {
        String[] parts = parse.split("&&");
        List<String> selectors = new ArrayList<>();
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i].trim();
            if (i == parts.length - 1 && isOption(part)) continue;
            if (part.isEmpty()) continue;
            boolean intermediate = i < parts.length - 1;
            if (intermediate && isSimpleSelector(part)) {
                // pdfh/pd use the first match for each intermediate && segment.
                // pdfa must preserve the full result set; otherwise
                // "ul&&li&&a" incorrectly collapses to one anchor.
                selectors.add(part + (arrayMode ? "" : ":eq(0)"));
            } else {
                selectors.add(part);
            }
        }
        if (selectors.isEmpty()) return "*";
        return String.join(" ", selectors);
    }

    private static String optionOf(String parse) {
        String[] parts = parse.split("&&");
        if (parts.length < 2) return "";
        String last = parts[parts.length - 1].trim();
        return isOption(last) ? last : "";
    }

    private static boolean isOption(String value) {
        if ("Text".equalsIgnoreCase(value) || "Html".equalsIgnoreCase(value)) return true;
        if (value == null || value.isEmpty()) return false;
        return isAttributeName(value) || "OuterHtml".equalsIgnoreCase(value) || "Value".equalsIgnoreCase(value);
    }

    private static boolean isAttributeName(String value) {
        String lower = value.toLowerCase();
        return lower.equals("href") || lower.equals("src") || lower.equals("url") || lower.equals("value")
                || lower.equals("title") || lower.equals("alt") || lower.equals("class")
                || lower.equals("id") || lower.equals("style") || lower.equals("data-src")
                || lower.endsWith("-url") || lower.contains("poster");
    }

    private static boolean isSimpleSelector(String value) {
        return value.matches("^[A-Za-z][A-Za-z0-9_-]*$");
    }

    private static boolean looksLikeSelector(String value) {
        return value.contains(".") || value.contains("#") || value.contains("[")
                || value.contains(":") || value.contains(">") || value.contains("+")
                || value.contains("~") || value.contains("*") || value.matches("^[A-Za-z][A-Za-z0-9_-]*$");
    }

    private static boolean isUrlAttribute(String option) {
        if (option == null) return false;
        String lower = option.toLowerCase();
        return lower.equals("href") || lower.equals("src") || lower.equals("url")
                || lower.equals("data-src") || lower.endsWith("-url") || lower.contains("poster");
    }

    private static boolean isSpecialUrl(String value) {
        String lower = value.toLowerCase();
        return lower.startsWith("http://") || lower.startsWith("https://")
                || lower.startsWith("data:") || lower.startsWith("javascript:")
                || lower.startsWith("magnet:") || lower.startsWith("file:");
    }

    private static String resolve(String base, String relative) {
        if (relative == null || relative.isEmpty()) return relative;
        if (base == null || base.isEmpty()) return relative;
        try {
            return URI.create(base).resolve(relative).toString();
        } catch (Exception ignored) {
            return relative;
        }
    }

    private static final class DomValue {
        final String html;
        final String baseUrl;
        private DomValue(String html, String baseUrl) {
            this.html = html;
            this.baseUrl = baseUrl;
        }

        static DomValue from(String input) {
            if (input == null) return new DomValue("", "");
            String trimmed = input.trim();
            if (trimmed.startsWith("{") && trimmed.contains("\"__drpyDom\"")) {
                try {
                    JSONObject object = new JSONObject(trimmed);
                    return new DomValue(object.optString("html", ""), object.optString("baseUrl", ""));
                } catch (Exception ignored) {}
            }
            return new DomValue(input, "");
        }
    }
}
