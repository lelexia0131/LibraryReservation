package cn.libraryreservation.android;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Set;
import org.json.JSONObject;

@CapacitorPlugin(name = "LibraryApplication")
public final class LibraryApplicationPlugin extends Plugin {
    static final Set<String> COMMANDS = Set.of("auth:get-status", "auth:login", "auth:logout", "booking:open-web",
        "availability:list", "availability:seats", "reservation:manual", "autoselect:start", "autoselect:stop", "autoselect:status");
    @PluginMethod public void invoke(PluginCall call) {
        String command = call.getString("command");
        if (command == null || !COMMANDS.contains(command)) { call.reject("Forbidden"); return; }
        for (var keys = call.getData().keys(); keys.hasNext();) {
            if (!Set.of("command", "input").contains(keys.next())) { call.reject("Forbidden"); return; }
        }
        Object input = call.getData().opt("input");
        if (input != null && input != JSONObject.NULL && !(input instanceof JSONObject)) { call.reject("Invalid input"); return; }
        getActivity().runOnUiThread(() -> {
            boolean debug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
                && !Set.of("auth:get-status", "autoselect:status").contains(command);
            if (debug) android.util.Log.i("LibraryApplication", "[LibraryApplication] invoke command=" + command);
            CoreRuntime core = ((MainActivity) getActivity()).core;
            if (core == null) { call.resolve(new JSObject().put("reply", CoreRuntime.failure(command))); return; }
            core.invoke(command, input, reply -> {
                if (debug) android.util.Log.i("LibraryApplication", "[LibraryApplication] resolved command=" + command + " ok=" + reply.optBoolean("ok"));
                call.resolve(new JSObject().put("reply", reply));
            });
        });
    }
}
