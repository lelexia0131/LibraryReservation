package cn.libraryreservation.android;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.appcompat.app.AppCompatActivity;
import androidx.activity.OnBackPressedCallback;
import java.lang.ref.WeakReference;

public final class CasActivity extends AppCompatActivity {
    static WeakReference<AndroidCasBrowser> pending = new WeakReference<>(null);
    private AndroidCasBrowser session;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        session = pending.get();
        if (session == null) { finish(); return; }
        session.activity = this;
        setTitle("浙江大学统一身份认证");
        if (session.view.getParent() instanceof android.view.ViewGroup parent) parent.removeView(session.view);
        setContentView(session.view);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { session.cancel(); }
        });
    }
    @Override protected void onDestroy() {
        if (session != null && session.activity == this) session.cancel();
        super.onDestroy();
    }
}
