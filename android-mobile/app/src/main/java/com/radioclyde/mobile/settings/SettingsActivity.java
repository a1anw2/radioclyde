package com.radioclyde.mobile.settings;

import android.os.Bundle;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.materialswitch.MaterialSwitch;
import com.google.android.material.textfield.TextInputEditText;

import com.radioclyde.mobile.R;
import com.radioclyde.mobile.RadioMobileApplication;
import com.radioclyde.mobile.net.ActiveProfileResolver;

/**
 * Plain touch form (not android-tv's GuidedStepSupportFragment wizard --
 * that's Leanback-only) for both server profiles at once. A read-only
 * status row shows which profile ActiveProfileResolver currently considers
 * reachable; there is no manual switch, per the deliberate choice of
 * auto-detect over a toggle. Save persists both profiles and finishes
 * unconditionally -- like android-tv's CredentialsStepFragment, this never
 * traps the user on a failed probe.
 */
public class SettingsActivity extends AppCompatActivity implements ActiveProfileResolver.Listener {

    private ProfileRepository profileRepository;
    private ActiveProfileResolver resolver;

    private TextView statusText;
    private TextInputEditText internalHost;
    private TextInputEditText internalPort;
    private TextInputEditText externalHost;
    private TextInputEditText externalUsername;
    private TextInputEditText externalPassword;
    private MaterialSwitch httpsSwitch;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        RadioMobileApplication app = (RadioMobileApplication) getApplication();
        profileRepository = app.getProfileRepository();
        resolver = app.getActiveProfileResolver();

        setSupportActionBar(findViewById(R.id.toolbar));

        statusText = findViewById(R.id.status_text);
        internalHost = findViewById(R.id.internal_host);
        internalPort = findViewById(R.id.internal_port);
        externalHost = findViewById(R.id.external_host);
        externalUsername = findViewById(R.id.external_username);
        externalPassword = findViewById(R.id.external_password);
        httpsSwitch = findViewById(R.id.https_switch);
        MaterialButton saveButton = findViewById(R.id.save_button);

        ServerProfile internal = profileRepository.getInternal();
        internalHost.setText(internal.host);
        internalPort.setText(internal.port.isEmpty() ? ProfileRepository.DEFAULT_PORT_HINT : internal.port);

        ServerProfile external = profileRepository.getExternal();
        externalHost.setText(external.host);
        externalUsername.setText(external.username);
        externalPassword.setText(external.password);
        httpsSwitch.setChecked(!"http".equals(external.scheme));

        saveButton.setOnClickListener(v -> onSave());

        renderStatus(resolver.getActiveProfile());
    }

    @Override
    protected void onStart() {
        super.onStart();
        resolver.addListener(this);
        resolver.requestProbe(true);
    }

    @Override
    protected void onStop() {
        super.onStop();
        resolver.removeListener(this);
    }

    private void onSave() {
        String iHost = textOf(internalHost);
        String iPort = textOf(internalPort);
        String eHost = textOf(externalHost);

        if (!iHost.isEmpty() && !iPort.matches("\\d+")) {
            Toast.makeText(this, R.string.toast_invalid_port, Toast.LENGTH_SHORT).show();
            return;
        }

        profileRepository.saveInternal("http", iHost, iPort);
        profileRepository.saveExternal(
                httpsSwitch.isChecked() ? "https" : "http",
                eHost,
                textOf(externalUsername), textOf(externalPassword));

        resolver.requestProbe(true);
        Toast.makeText(this, R.string.toast_settings_saved, Toast.LENGTH_SHORT).show();
        finish();
    }

    @Override
    public void onActiveProfileChanged(@Nullable ServerProfile profile) {
        renderStatus(profile);
    }

    private void renderStatus(@Nullable ServerProfile profile) {
        if (profile == null) {
            statusText.setText(R.string.status_not_connected);
        } else {
            statusText.setText(getString(R.string.status_connected_format, profile.getLabel(), profile.getHostDisplay()));
        }
    }

    private static String textOf(TextInputEditText field) {
        return field.getText() == null ? "" : field.getText().toString().trim();
    }
}
