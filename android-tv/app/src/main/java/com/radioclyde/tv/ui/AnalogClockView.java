package com.radioclyde.tv.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;
import android.util.AttributeSet;
import android.view.View;

import androidx.annotation.Nullable;

import java.util.Calendar;

/**
 * Self-drawn analog clock face -- android.widget.AnalogClock was deprecated
 * years ago and has since been removed from the platform entirely, so it
 * can't be relied on here.
 */
public class AnalogClockView extends View {

    private final Paint facePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint rimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint tickPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint hourHandPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint minuteHandPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint secondHandPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tickRunnable = this::tick;

    public AnalogClockView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);

        facePaint.setColor(0xFF1C222E);
        facePaint.setStyle(Paint.Style.FILL);

        rimPaint.setColor(0xFF3A4252);
        rimPaint.setStyle(Paint.Style.STROKE);
        rimPaint.setStrokeWidth(4f);

        tickPaint.setColor(0xFF8890A0);
        tickPaint.setStrokeWidth(3f);

        hourHandPaint.setColor(0xFFFFFFFF);
        hourHandPaint.setStrokeWidth(9f);
        hourHandPaint.setStrokeCap(Paint.Cap.ROUND);

        minuteHandPaint.setColor(0xFFFFFFFF);
        minuteHandPaint.setStrokeWidth(6f);
        minuteHandPaint.setStrokeCap(Paint.Cap.ROUND);

        secondHandPaint.setColor(0xFFE63946);
        secondHandPaint.setStrokeWidth(3f);
        secondHandPaint.setStrokeCap(Paint.Cap.ROUND);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        handler.post(tickRunnable);
    }

    @Override
    protected void onDetachedFromWindow() {
        handler.removeCallbacks(tickRunnable);
        super.onDetachedFromWindow();
    }

    private void tick() {
        invalidate();
        handler.postDelayed(tickRunnable, 1000);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);

        float cx = getWidth() / 2f;
        float cy = getHeight() / 2f;
        float radius = Math.min(getWidth(), getHeight()) / 2f - rimPaint.getStrokeWidth();

        canvas.drawCircle(cx, cy, radius, facePaint);
        canvas.drawCircle(cx, cy, radius, rimPaint);

        for (int i = 0; i < 12; i++) {
            double angle = Math.toRadians(i * 30);
            float sin = (float) Math.sin(angle);
            float cos = (float) Math.cos(angle);
            canvas.drawLine(
                    cx + sin * radius * 0.80f, cy - cos * radius * 0.80f,
                    cx + sin * radius * 0.92f, cy - cos * radius * 0.92f,
                    tickPaint);
        }

        Calendar now = Calendar.getInstance();
        int hour = now.get(Calendar.HOUR);
        int minute = now.get(Calendar.MINUTE);
        int second = now.get(Calendar.SECOND);

        drawHand(canvas, cx, cy, radius * 0.5f, hour * 30f + minute * 0.5f, hourHandPaint);
        drawHand(canvas, cx, cy, radius * 0.72f, minute * 6f + second * 0.1f, minuteHandPaint);
        drawHand(canvas, cx, cy, radius * 0.85f, second * 6f, secondHandPaint);

        canvas.drawCircle(cx, cy, 6f, secondHandPaint);
    }

    private static void drawHand(Canvas canvas, float cx, float cy, float length, float angleDegrees, Paint paint) {
        double angle = Math.toRadians(angleDegrees);
        canvas.drawLine(cx, cy, cx + (float) Math.sin(angle) * length, cy - (float) Math.cos(angle) * length, paint);
    }
}
