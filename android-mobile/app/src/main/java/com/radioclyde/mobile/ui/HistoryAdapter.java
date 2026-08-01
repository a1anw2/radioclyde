package com.radioclyde.mobile.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import com.radioclyde.mobile.R;
import com.radioclyde.mobile.model.HistoryEntry;
import com.radioclyde.mobile.net.ActiveProfileResolver;
import com.radioclyde.mobile.net.GlideAuthHeaderFactory;
import com.radioclyde.mobile.settings.ServerProfile;

import java.util.ArrayList;
import java.util.List;

/** Plain display list -- no click handling, mirrors android-tv's HistoryAdapter. */
public class HistoryAdapter extends RecyclerView.Adapter<HistoryAdapter.ViewHolder> {

    private final ActiveProfileResolver resolver;
    private final List<HistoryEntry> entries = new ArrayList<>();

    public HistoryAdapter(ActiveProfileResolver resolver) {
        this.resolver = resolver;
    }

    public void submit(List<HistoryEntry> newEntries) {
        entries.clear();
        entries.addAll(newEntries);
        notifyDataSetChanged();
    }

    @Override
    public ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_history, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(ViewHolder holder, int position) {
        HistoryEntry entry = entries.get(position);
        holder.text.setText(holder.text.getContext().getString(R.string.history_entry_format, entry.artist, entry.title));

        ServerProfile profile = resolver.getActiveProfile();
        if (entry.artUrl != null && profile != null) {
            String absoluteUrl = profile.getBaseUrl() + entry.artUrl;
            try {
                Glide.with(holder.art.getContext())
                        .load(GlideAuthHeaderFactory.buildGlideUrl(absoluteUrl, profile))
                        .placeholder(R.drawable.card_placeholder)
                        .error(R.drawable.card_placeholder)
                        .into(holder.art);
            } catch (IllegalArgumentException e) {
                // Hosting Activity already destroyed -- nothing to bind.
            }
        } else {
            holder.art.setImageResource(R.drawable.card_placeholder);
        }
    }

    @Override
    public void onViewRecycled(ViewHolder holder) {
        try {
            Glide.with(holder.art.getContext()).clear(holder.art);
        } catch (IllegalArgumentException e) {
            // Hosting Activity already destroyed -- nothing to clear.
        }
    }

    @Override
    public int getItemCount() {
        return entries.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final ImageView art;
        final TextView text;

        ViewHolder(View itemView) {
            super(itemView);
            art = itemView.findViewById(R.id.history_art);
            text = itemView.findViewById(R.id.history_text);
        }
    }
}
