package com.yuivo9999.mybox123;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.content.UriMatcher;

/** Read-only cross-application endpoint for the current MyBox UI state JSON. */
public final class MyBoxUiStateProvider extends ContentProvider {
    public static final String AUTHORITY = "com.yuivo9999.mybox123.ui-state";
    public static final Uri CONTENT_URI = Uri.parse("content://" + AUTHORITY + "/state");
    public static final String COLUMN_ID = "_id";
    public static final String COLUMN_JSON = "json";

    private static final int STATE = 1;
    private static final UriMatcher URI_MATCHER = new UriMatcher(UriMatcher.NO_MATCH);

    static {
        URI_MATCHER.addURI(AUTHORITY, "state", STATE);
    }

    @Override
    public boolean onCreate() {
        return getContext() != null;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        if (URI_MATCHER.match(uri) != STATE) throw new IllegalArgumentException("Unsupported UI state URI: " + uri);
        if (getContext() == null) return null;

        SharedPreferences preferences = getContext().getSharedPreferences(
            MyBoxUiStateBridge.PREFS_NAME,
            android.content.Context.MODE_PRIVATE
        );
        String json = preferences.getString(MyBoxUiStateBridge.SNAPSHOT_KEY, defaultSnapshot());
        String[] columns = projection == null || projection.length == 0
            ? new String[]{COLUMN_ID, COLUMN_JSON}
            : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int index = 0; index < columns.length; index++) {
            if (COLUMN_ID.equals(columns[index])) row[index] = 1;
            else if (COLUMN_JSON.equals(columns[index])) row[index] = json;
            else row[index] = null;
        }
        cursor.addRow(row);
        cursor.setNotificationUri(getContext().getContentResolver(), CONTENT_URI);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        if (URI_MATCHER.match(uri) != STATE) throw new IllegalArgumentException("Unsupported UI state URI: " + uri);
        return "vnd.android.cursor.item/vnd.com.yuivo9999.mybox123.ui-state";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("MyBox UI state provider is read-only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("MyBox UI state provider is read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("MyBox UI state provider is read-only");
    }

    private static String defaultSnapshot() {
        return "{"
            + "\"schemaVersion\":1,"
            + "\"appId\":\"com.yuivo9999.mybox123\","
            + "\"runtime\":\"android-webview\","
            + "\"currentPage\":\"unknown\","
            + "\"pageName\":\"未知页面\","
            + "\"tab\":\"home\","
            + "\"route\":\"\","
            + "\"displayMode\":\"embedded\","
            + "\"fullscreen\":false,"
            + "\"immersive\":false,"
            + "\"playerKind\":\"none\","
            + "\"playerState\":\"idle\","
            + "\"selectedTitle\":\"\","
            + "\"currentChannel\":\"\","
            + "\"menuOpen\":false,"
            + "\"overlayOpen\":false,"
            + "\"activePanel\":\"\","
            + "\"controlsVisible\":false,"
            + "\"documentVisibility\":\"unknown\","
            + "\"appLifecycle\":\"unknown\","
            + "\"viewportWidth\":0,"
            + "\"viewportHeight\":0,"
            + "\"updatedAt\":\"\""
            + "}";
    }
}
