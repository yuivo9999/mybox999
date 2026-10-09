package com.yuivo9999.mybox123;

import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;

import org.json.JSONObject;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Isolated-process CatVod Spider execution boundary.
 *
 * The Spider is loaded from an FD into memory. The isolated process is not
 * granted host file/network permissions; the proxy protocol remains reserved
 * for a future proxy-aware Spider ABI.
 */
public final class TVBoxJarExecutionService extends Service {
    public static final String ACTION = "com.yuivo9999.mybox123.TVBOX_JAR_EXECUTE";
    private static final String PROTOCOL_VERSION = "1";
    public static final int MSG_PING = 1;
    public static final int MSG_CAPABILITIES = 2;
    public static final int MSG_EXECUTE = 3;
    public static final int MSG_NETWORK_REQUEST = 4;
    public static final int MSG_FILE_READ = 5;
    public static final int MSG_RESULT = 100;
    public static final int MSG_NETWORK_RESULT = 101;
    public static final int MSG_FILE_RESULT = 102;
    private static final int MAX_MESSAGE_CHARS = 256 * 1024;
    private static final int MAX_PROXY_BODY_CHARS = 192 * 1024;
    public static final String KEY_REQUEST_ID = "requestId";
    public static final String KEY_PAYLOAD = "payload";
    public static final String KEY_OPERATION = "operation";
    public static final String KEY_CLASS_NAME = "className";
    public static final String KEY_JAR_FD = "jarFd";

    private HandlerThread handlerThread;
    private Messenger messenger;
    private final ExecutorService spiderExecutor = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        handlerThread = new HandlerThread("tvbox-jar-isolated-service");
        handlerThread.start();
        messenger = new Messenger(new IncomingHandler(handlerThread.getLooper()));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return messenger.getBinder();
    }

    @Override
    public void onDestroy() {
        if (handlerThread != null) handlerThread.quitSafely();
        handlerThread = null;
        messenger = null;
        spiderExecutor.shutdownNow();
        super.onDestroy();
    }

    private final class IncomingHandler extends Handler {
        IncomingHandler(android.os.Looper looper) { super(looper); }

        @Override public void handleMessage(Message message) {
            if (message.what == MSG_PING || message.what == MSG_CAPABILITIES) {
                reply(message, capabilities(), MSG_RESULT);
                return;
            }
            if (message.what == MSG_EXECUTE) {
                execute(message);
                return;
            }
            // These messages are reserved for a future proxy-aware Spider ABI.
            if (message.what == MSG_NETWORK_REQUEST) {
                reply(message, error("TVBOX_JAR_NETWORK_PROXY_REQUEST_UNEXPECTED"), MSG_NETWORK_RESULT);
                return;
            }
            if (message.what == MSG_FILE_READ) {
                reply(message, error("TVBOX_JAR_FILE_PROXY_REQUEST_UNEXPECTED"), MSG_FILE_RESULT);
                return;
            }
            if (message.what == MSG_NETWORK_RESULT || message.what == MSG_FILE_RESULT) {
                // Result messages are consumed by the requesting isolated
                // runtime in the future. They are deliberately not interpreted
                // as executable commands by this protocol boundary.
                return;
            }
            super.handleMessage(message);
        }
    }

    private void execute(Message request) {
        ParcelFileDescriptor descriptor = null;
        try {
            String operation = request.getData().getString(KEY_OPERATION, "");
            String className = request.getData().getString(KEY_CLASS_NAME, "");
            String payload = request.getData().getString(KEY_PAYLOAD, "{}");
            descriptor = request.getData().getParcelable(KEY_JAR_FD);
            if (descriptor == null) throw new IllegalArgumentException("TVBOX_JAR_FD_REQUIRED");
            final ParcelFileDescriptor executionDescriptor = descriptor;
            final JSONObject data = new JSONObject(payload == null || payload.isEmpty() ? "{}" : payload);
            final TVBoxJarIsolatedExecutor executor = new TVBoxJarIsolatedExecutor(getApplicationContext());
            final String executionOperation = operation;
            final String executionClassName = className;
            Future<String> future = spiderExecutor.submit(new Callable<String>() {
                @Override public String call() throws Exception {
                    return executor.invoke(executionDescriptor, executionClassName, executionOperation, data);
                }
            });
            descriptor = null;
            try {
                reply(request, future.get(20_000L, TimeUnit.MILLISECONDS), MSG_RESULT);
            } catch (TimeoutException timeout) {
                future.cancel(true);
                reply(request, error("TVBOX_JAR_ISOLATED_EXECUTION_TIMEOUT"), MSG_RESULT);
            } catch (ExecutionException failure) {
                Throwable cause = failure.getCause();
                reply(request, error(cause == null || cause.getMessage() == null
                        ? "TVBOX_JAR_ISOLATED_EXECUTION_FAILED" : cause.getMessage()), MSG_RESULT);
            } finally {
                try { executionDescriptor.close(); } catch (Exception ignored) { }
            }
        } catch (Throwable error) {
            if (descriptor != null) {
                try { descriptor.close(); } catch (Exception ignored) { }
            }
            reply(request, error(error.getMessage() == null ? "TVBOX_JAR_ISOLATED_EXECUTION_ERROR" : error.getMessage()), MSG_RESULT);
        }
    }

    private void reply(Message request, String payload, int what) {
        if (request.replyTo == null) return;
        String safePayload = payload == null ? "" : payload;
        if (safePayload.length() > MAX_MESSAGE_CHARS) safePayload = error("TVBOX_JAR_PROTOCOL_PAYLOAD_TOO_LARGE");
        Message response = Message.obtain(null, what);
        android.os.Bundle data = new android.os.Bundle();
        data.putString(KEY_REQUEST_ID, request.getData().getString(KEY_REQUEST_ID, ""));
        data.putString(KEY_PAYLOAD, safePayload);
        response.setData(data);
        try { request.replyTo.send(response); } catch (Exception ignored) { }
    }

    private String capabilities() {
        try {
            return new JSONObject()
                    .put("ok", true)
                    .put("protocolVersion", PROTOCOL_VERSION)
                    .put("executionEnabled", true)
                    .put("executionMode", "isolated-in-memory-dex")
                    .put("networkProxyRequired", true)
                    .put("networkAccess", "not-granted-to-isolated-process")
                    .put("hostFileProxyRequired", true)
                    .put("maxMessageChars", MAX_MESSAGE_CHARS)
                    .put("networkMessage", MSG_NETWORK_REQUEST)
                    .put("fileMessage", MSG_FILE_READ)
                    .put("networkResultMessage", MSG_NETWORK_RESULT)
                    .put("fileResultMessage", MSG_FILE_RESULT)
                    .put("maxProxyBodyChars", MAX_PROXY_BODY_CHARS)
                    .toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"code\":\"TVBOX_JAR_ISOLATED_CAPABILITY_ERROR\"}";
        }
    }

    private String error(String code) {
        try {
            return new JSONObject().put("ok", false).put("code", code).put("protocolVersion", PROTOCOL_VERSION).toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"TVBOX_JAR_ISOLATED_ERROR\"}";
        }
    }
}
