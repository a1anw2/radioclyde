package com.radioclyde.tv.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import com.radioclyde.tv.R;
import com.radioclyde.tv.model.HistoryEntry;
import com.radioclyde.tv.net.GlideAuthHeaderFactory;
import com.radioclyde.tv.settings.SettingsRepository;

import java.util.ArrayList;
import java.util.List;

/** Plain display list -- no click handling, mirrors the web player's "Recently played" list. */
public class HistoryAdapter extends RecyclerView.Adapter<HistoryAdapter.ViewHolder> {

    private final SettingsRepository settings;
    private final List<HistoryEntry> entries = new ArrayList<>();

    public HistoryAdapter(SettingsRepository settings) {
        this.settings = settings;
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

        if (entry.artUrl != null) {
            String absoluteUrl = settings.getBaseUrl() + entry.artUrl;
            try {
                Glide.with(holder.art.getContext())
                        .load(GlideAuthHeaderFactory.buildGlideUrl(absoluteUrl, settings))
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
