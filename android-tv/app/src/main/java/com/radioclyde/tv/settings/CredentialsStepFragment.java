package com.radioclyde.tv.settings;

import android.content.Context;
import android.os.Bundle;
import android.text.InputType;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.leanback.widget.GuidanceStylist;
import androidx.leanback.app.GuidedStepSupportFragment;
import androidx.leanback.widget.GuidedAction;

import com.radioclyde.tv.R;
import com.radioclyde.tv.net.ApiClient;
import com.radioclyde.tv.util.AppExecutors;

import java.io.IOException;
import java.util.List;

public class CredentialsStepFragment extends GuidedStepSupportFragment {

    private static final long ACTION_ID_USERNAME = 1;
    private static final long ACTION_ID_PASSWORD = 2;
    private static final long ACTION_ID_SAVE = 3;

    @NonNull
    @Override
    public GuidanceStylist.Guidance onCreateGuidance(Bundle savedInstanceState) {
        return new GuidanceStylist.Guidance(
                getString(R.string.guidance_credentials_title),
                getString(R.string.guidance_credentials_description),
                null,
                null);
    }

    @Override
    public void onCreateActions(@NonNull List<GuidedAction> actions, Bundle savedInstanceState) {
        Context context = requireContext();
        SettingsRepository settings = new SettingsRepository(context);

        actions.add(new GuidedAction.Builder(context)
                .id(ACTION_ID_USERNAME)
                .title(getString(R.string.action_username))
                .description(settings.getUsername())
                .descriptionEditable(true)
                .descriptionEditInputType(InputType.TYPE_CLASS_TEXT)
                .build());

        actions.add(new GuidedAction.Builder(context)
                .id(ACTION_ID_PASSWORD)
                .title(getString(R.string.action_password))
                .description(settings.getPassword())
                .descriptionEditable(true)
                .descriptionEditInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD)
                .build());

        actions.add(new GuidedAction.Builder(context)
                .id(ACTION_ID_SAVE)
                .title(getString(R.string.action_save))
                .build());
    }

    @Override
    public void onGuidedActionClicked(@NonNull GuidedAction action) {
        if (action.getId() != ACTION_ID_SAVE) return;

        String username = textOf(findActionById(ACTION_ID_USERNAME));
        String password = textOf(findActionById(ACTION_ID_PASSWORD));

        Context appContext = requireContext().getApplicationContext();
        SettingsRepository settings = new SettingsRepository(appContext);
        settings.saveCredentials(username, password);

        String hostForToast = settings.getHost();

        // Probe the server so the user gets an immediate signal, but never
        // trap them here -- finish back to PlaybackActivity either way,
        // which re-checks isConfigured() once credentials are saved (even
        // if this particular probe failed, e.g. a transient network hiccup).
        AppExecutors.runOnBackground(() -> {
            boolean reachable;
            try {
                new ApiClient(settings).fetchNowPlaying();
                reachable = true;
            } catch (IOException e) {
                reachable = false;
            }
            boolean finalReachable = reachable;
            AppExecutors.runOnMain(() -> {
                if (isAdded()) {
                    Toast.makeText(appContext,
                            finalReachable
                                    ? getString(R.string.toast_connected, hostForToast)
                                    : getString(R.string.toast_connect_failed),
                            Toast.LENGTH_LONG).show();
                }
                if (getActivity() != null) {
                    getActivity().finish();
                }
            });
        });
    }

    private static String textOf(@Nullable GuidedAction action) {
        return action == null || action.getDescription() == null
                ? ""
                : action.getDescription().toString().trim();
    }
}
