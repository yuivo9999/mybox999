package com.yuivo9999.mybox123;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;

import java.util.UUID;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Host-side protocol client for the isolated CatVod boundary. */
public final class TVBoxJarIsolatedClient implements AutoCloseable {
    private static final long DEFAULT_TIMEOUT_MS = 25_000L;
    private final Context context;
    private final TVBoxJarHostProxy hostProxy;
    private final HandlerThread callbackThread = new HandlerThread("tvbox-jar-isolated-callback");
    private final Handler callbackHandler;
    private final Messenger incoming;
    private final java.util.Map<String, String> responses = new java.util.HashMap<>();
    private Messenger remote;
    private boolean bound;
    private ServiceConnection connection;

    public TVBoxJarIsolatedClient(Context context) {
        this.context = context.getApplicationContext();
        this.hostProxy = new TVBoxJarHostProxy(this.context);
        callbackThread.start();
        callbackHandler = new Handler(callbackThread.getLooper()) {
            @Override public void handleMessage(Message message) {
                String requestId = message.getData().getString(TVBoxJarExecutionService.KEY_REQUEST_ID, "");
                String payload = message.getData().getString(TVBoxJarExecutionService.KEY_PAYLOAD, "");
                if (message.what == TVBoxJarExecutionService.MSG_NETWORK_REQUEST || message.what == TVBoxJarExecutionService.MSG_FILE_READ) {
                    String result;
                    try {
                        JSONObject object = new JSONObject(payload == null || payload.isEmpty() ? "{}" : payload);
                        result = message.what == TVBoxJarExecutionService.MSG_NETWORK_REQUEST
                                ? hostProxy.network(object)
                                : hostProxy.readFile(object);
                    } catch (Exception error) {
                        result = errorPayload("TVBOX_JAR_PROXY_REQUEST_INVALID");
                    }
                    if (message.replyTo != null) {
                        Message response = Message.obtain(null,
                                message.what == TVBoxJarExecutionService.MSG_NETWORK_REQUEST
                                        ? TVBoxJarExecutionService.MSG_NETWORK_RESULT
                                        : TVBoxJarExecutionService.MSG_FILE_RESULT);
                        Bundle data = new Bundle();
                        data.putString(TVBoxJarExecutionService.KEY_REQUEST_ID, requestId);
                        data.putString(TVBoxJarExecutionService.KEY_PAYLOAD, result);
                        response.setData(data);
                        try { message.replyTo.send(response); } catch (Exception ignored) { }
                    }
                    return;
                }
                synchronized (responses) {
                    responses.put(requestId, payload);
                    responses.notifyAll();
                }
            }
        };
        incoming = new Messenger(callbackHandler);
    }

    private static String errorPayload(String code) {
        try {
            return new JSONObject().put("ok", false).put("code", code).toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"code\":\"TVBOX_JAR_PROXY_REQUEST_INVALID\"}";
        }
    }

    public synchronized void connect() throws InterruptedException {
        if (bound && remote != null) return;
        CountDownLatch latch = new CountDownLatch(1);
        Intent intent = new Intent(context, TVBoxJarExecutionService.class);
        connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, android.os.IBinder service) { synchronized (TVBoxJarIsolatedClient.this) { remote = new Messenger(service); bound = true; } latch.countDown(); }
            @Override public void onServiceDisconnected(ComponentName name) { synchronized (TVBoxJarIsolatedClient.this) { remote = null; bound = false; } }
        };
        if (!context.bindService(intent, connection, Context.BIND_AUTO_CREATE)) {
            connection = null;
            throw new IllegalStateException("TVBOX_JAR_ISOLATED_BIND_FAILED");
        }
        if (!latch.await(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) throw new IllegalStateException("TVBOX_JAR_ISOLATED_CONNECT_TIMEOUT");
    }

    public String execute(File jarFile, String className, String operation, String payload) throws Exception {
        if (jarFile == null || !jarFile.isFile()) throw new IllegalArgumentException("TVBOX_JAR_FILE_REQUIRED");
        connect();
        ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(jarFile, ParcelFileDescriptor.MODE_READ_ONLY);
        try {
            String requestId = UUID.randomUUID().toString();
            Message message = Message.obtain(null, TVBoxJarExecutionService.MSG_EXECUTE);
            Bundle data = new Bundle();
            data.putString(TVBoxJarExecutionService.KEY_REQUEST_ID, requestId);
            data.putString(TVBoxJarExecutionService.KEY_OPERATION, operation == null ? "" : operation);
            data.putString(TVBoxJarExecutionService.KEY_CLASS_NAME, className == null ? "" : className);
            data.putString(TVBoxJarExecutionService.KEY_PAYLOAD, payload == null ? "{}" : payload);
            data.putParcelable(TVBoxJarExecutionService.KEY_JAR_FD, descriptor);
            message.setData(data);
            message.replyTo = incoming;
            remote.send(message);
            long deadline = System.currentTimeMillis() + DEFAULT_TIMEOUT_MS;
            synchronized (responses) {
                while (!responses.containsKey(requestId)) {
                    long remaining = deadline - System.currentTimeMillis();
                    if (remaining <= 0) throw new IllegalStateException("TVBOX_JAR_ISOLATED_REQUEST_TIMEOUT");
                    responses.wait(remaining);
                }
                return responses.remove(requestId);
            }
        } finally {
            try { descriptor.close(); } catch (Exception ignored) { }
        }
    }

    public String capabilities() throws Exception {
        connect();
        return request(TVBoxJarExecutionService.MSG_CAPABILITIES, "{}");
    }

    public synchronized String request(int what, String payload) throws Exception {
        if (!bound || remote == null) throw new IllegalStateException("TVBOX_JAR_ISOLATED_NOT_CONNECTED");
        String requestId = UUID.randomUUID().toString();
        Message message = Message.obtain(null, what);
        Bundle data = new Bundle();
        data.putString(TVBoxJarExecutionService.KEY_REQUEST_ID, requestId);
        data.putString(TVBoxJarExecutionService.KEY_PAYLOAD, payload == null ? "" : payload);
        message.setData(data);
        message.replyTo = incoming;
        remote.send(message);
        long deadline = System.currentTimeMillis() + DEFAULT_TIMEOUT_MS;
        synchronized (responses) {
            while (!responses.containsKey(requestId)) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) throw new IllegalStateException("TVBOX_JAR_ISOLATED_REQUEST_TIMEOUT");
                responses.wait(remaining);
            }
            return responses.remove(requestId);
        }
    }

    @Override public synchronized void close() {
        if (bound) {
            try { if (connection != null) context.unbindService(connection); } catch (Exception ignored) { }
        }
        connection = null;
        remote = null;
        bound = false;
        callbackThread.quitSafely();
    }
}
