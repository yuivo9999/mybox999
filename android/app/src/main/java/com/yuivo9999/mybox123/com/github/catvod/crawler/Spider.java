package com.github.catvod.crawler;

import android.content.Context;

import java.util.HashMap;
import java.util.List;

/**
 * Minimal CatVod Spider ABI supplied by MyBox.
 *
 * This is a compatibility surface for external Spider JARs. It intentionally
 * contains no network implementation or privileged helpers.
 */
public abstract class Spider {
    public void init(Context context, String extend) throws Exception {}

    public String homeContent(boolean filter) throws Exception { return "{\"class\":[],\"list\":[]}"; }

    public String homeVideoContent() throws Exception { return "{\"list\":[]}"; }

    public String categoryContent(String tid, String pg, boolean filter,
                                  HashMap<String, String> extend) throws Exception {
        return "{\"list\":[],\"pagecount\":0}";
    }

    public String detailContent(List<String> ids) throws Exception {
        return "{\"list\":[]}"; 
    }

    public String searchContent(String key, boolean quick) throws Exception {
        return "{\"list\":[]}"; 
    }

    public String searchContent(String key, boolean quick, String pg) throws Exception {
        return searchContent(key, quick);
    }

    public String playerContent(String flag, String id, List<String> vipFlags) throws Exception {
        return "{\"parse\":0,\"url\":\"" + id.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
    }

    public void destroy() {}
}
