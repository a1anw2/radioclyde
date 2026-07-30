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

import java.util.List;

public class ServerAddressStepFragment extends GuidedStepSupportFragment {

    private static final long ACTION_ID_HOST = 1;
    private static final long ACTION_ID_PORT = 2;
    private static final long ACTION_ID_CONTINUE = 3;

    @NonNull
    @Override
    public GuidanceStylist.Guidance onCreateGuidance(Bundle savedInstanceState) {
        return new GuidanceStylist.Guidance(
                getString(R.string.guidance_server_title),
                getString(R.string.guidance_server_description),
                null,
                null);
    }

    @Override
    public void onCreateActions(@NonNull List<GuidedAction> actions, Bundle savedInstanceState) {
        Context context = requireContext();
        SettingsRepository settings = new SettingsRepository(context);

        String currentPort = settings.getPort();
        actions.add(new GuidedAction.Builder(context)
                .id(ACTION_ID_HOST)
                .title(getString(R.string.action_host))
                .description(settings.getHost())
                .descriptionEditable(true)
                .descriptionEditInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI)
                .build());

        actions.add(new GuidedAction.Builder(context)
                .id(ACTION_ID_PORT)
                .title(getString(R.string.action_port))
                .description(currentPort.isEmpty() ? SettingsRepository.DEFAULT_PORT_HINT : currentPort)
                .descriptionEditable(true)
                .descriptionEditInputType(InputType.TYPE_CLASS_NUMBER)
                .build());

        actions.add(new GuidedAction.Builder(context)
                .id(ACTION_ID_CONTINUE)
                .title(getString(R.string.action_continue))
                .build());
    }

    @Override
    public void onGuidedActionClicked(@NonNull GuidedAction action) {
        if (action.getId() != ACTION_ID_CONTINUE) return;

        String host = textOf(findActionById(ACTION_ID_HOST));
        String port = textOf(findActionById(ACTION_ID_PORT));

        if (host.isEmpty() || !port.matches("\\d+")) {
            Toast.makeText(requireContext(), R.string.toast_connect_failed, Toast.LENGTH_SHORT).show();
            return;
        }

        new SettingsRepository(requireContext()).saveServerConfig(host, port);
        GuidedStepSupportFragment.add(getParentFragmentManager(), new CredentialsStepFragment());
    }

    private static String textOf(@Nullable GuidedAction action) {
        return action == null || action.getDescription() == null
                ? ""
                : action.getDescription().toString().trim();
    }
}
