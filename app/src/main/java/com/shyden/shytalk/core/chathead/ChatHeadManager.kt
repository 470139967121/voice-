package com.shyden.shytalk.core.chathead

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.ImageView
import coil.ImageLoader
import coil.request.ImageRequest
import coil.transform.CircleCropTransformation
import com.shyden.shytalk.R
import kotlin.math.abs

class ChatHeadManager(
    private val context: Context,
    private val onBubbleTapped: () -> Unit,
    private val onBubbleDismissed: () -> Unit
) {
    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())

    private var bubbleView: View? = null
    private var closeZoneView: View? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var closeZoneParams: WindowManager.LayoutParams? = null
    private var voiceWaveView: VoiceWaveView? = null
    private var isShowing = false
    private val imageLoader by lazy { ImageLoader(context) }

    private val bubbleSizePx = dpToPx(BUBBLE_SIZE_DP)
    private val edgeMarginPx = dpToPx(EDGE_MARGIN_DP)
    private val closeZoneHeightPx = dpToPx(CLOSE_ZONE_HEIGHT_DP)

    fun show(ownerPhotoUrl: String?) {
        if (isShowing) return

        handler.post {
            try {
                createCloseZoneView()
                createBubbleView(ownerPhotoUrl)
                isShowing = true
            } catch (e: Exception) {
                // Permission not granted or window manager error
                destroy()
            }
        }
    }

    fun hide() {
        if (!isShowing) return
        handler.post {
            removeBubble()
            removeCloseZone()
            isShowing = false
        }
    }

    fun updatePhoto(ownerPhotoUrl: String?) {
        if (!isShowing) return
        handler.post {
            val view = bubbleView ?: return@post
            loadPhoto(view, ownerPhotoUrl)
        }
    }

    fun destroy() {
        handler.removeCallbacksAndMessages(null)
        handler.post {
            voiceWaveView?.stopAnimation()
            voiceWaveView = null
            removeBubble()
            removeCloseZone()
            isShowing = false
        }
    }

    private fun createBubbleView(ownerPhotoUrl: String?) {
        val view = LayoutInflater.from(context).inflate(R.layout.chathead_bubble, null)

        val params = WindowManager.LayoutParams(
            bubbleSizePx,
            bubbleSizePx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = getScreenWidth() - bubbleSizePx - edgeMarginPx
            y = getScreenHeight() / 3
        }

        setupTouchListener(view, params)
        loadPhoto(view, ownerPhotoUrl)

        voiceWaveView = view.findViewById<VoiceWaveView>(R.id.voiceWaves)
        voiceWaveView?.startAnimation()

        windowManager.addView(view, params)
        bubbleView = view
        bubbleParams = params
    }

    private fun createCloseZoneView() {
        val view = LayoutInflater.from(context).inflate(R.layout.chathead_close_zone, null)
        view.visibility = View.GONE

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            closeZoneHeightPx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                    or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.START
        }

        windowManager.addView(view, params)
        closeZoneView = view
        closeZoneParams = params
    }

    private fun loadPhoto(view: View, ownerPhotoUrl: String?) {
        val photoView = view.findViewById<ImageView>(R.id.ownerPhoto)
        val micIcon = view.findViewById<ImageView>(R.id.micIcon)

        if (ownerPhotoUrl != null) {
            photoView.visibility = View.VISIBLE
            micIcon.visibility = View.GONE

            val request = ImageRequest.Builder(context)
                .data(ownerPhotoUrl)
                .target(photoView)
                .transformations(CircleCropTransformation())
                .build()
            imageLoader.enqueue(request)
        } else {
            photoView.visibility = View.GONE
            micIcon.visibility = View.VISIBLE
        }
    }

    @Suppress("ClickableViewAccessibility")
    private fun setupTouchListener(view: View, params: WindowManager.LayoutParams) {
        val tapThreshold = ViewConfiguration.get(context).scaledTouchSlop
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var isDragging = false

        view.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    isDragging = false
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - initialTouchX
                    val dy = event.rawY - initialTouchY
                    if (!isDragging && (abs(dx) > tapThreshold || abs(dy) > tapThreshold)) {
                        isDragging = true
                        showCloseZone()
                    }
                    if (isDragging) {
                        params.x = (initialX + dx).toInt()
                        params.y = (initialY + dy).toInt()
                        try {
                            windowManager.updateViewLayout(view, params)
                        } catch (_: IllegalArgumentException) {}
                        updateCloseZoneHighlight(event.rawY)
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    if (!isDragging) {
                        onBubbleTapped()
                    } else if (isInCloseZone(event.rawY)) {
                        onBubbleDismissed()
                    } else {
                        snapToEdge(params, view)
                    }
                    hideCloseZone()
                    true
                }

                else -> false
            }
        }
    }

    private fun showCloseZone() {
        closeZoneView?.visibility = View.VISIBLE
    }

    private fun hideCloseZone() {
        closeZoneView?.visibility = View.GONE
        closeZoneView?.findViewById<ImageView>(R.id.closeIcon)?.apply {
            scaleX = 1f
            scaleY = 1f
        }
    }

    private fun isInCloseZone(rawY: Float): Boolean {
        val screenHeight = getScreenHeight()
        return rawY > screenHeight - closeZoneHeightPx
    }

    private fun updateCloseZoneHighlight(rawY: Float) {
        val closeIcon = closeZoneView?.findViewById<ImageView>(R.id.closeIcon) ?: return
        if (isInCloseZone(rawY)) {
            closeIcon.scaleX = 1.3f
            closeIcon.scaleY = 1.3f
        } else {
            closeIcon.scaleX = 1f
            closeIcon.scaleY = 1f
        }
    }

    private fun snapToEdge(params: WindowManager.LayoutParams, view: View) {
        val screenWidth = getScreenWidth()
        val bubbleCenterX = params.x + bubbleSizePx / 2
        val targetX = if (bubbleCenterX < screenWidth / 2) {
            edgeMarginPx
        } else {
            screenWidth - bubbleSizePx - edgeMarginPx
        }

        ValueAnimator.ofInt(params.x, targetX).apply {
            duration = 250
            interpolator = android.view.animation.OvershootInterpolator(1.2f)
            addUpdateListener { anim ->
                params.x = anim.animatedValue as Int
                try {
                    windowManager.updateViewLayout(view, params)
                } catch (_: IllegalArgumentException) {}
            }
            start()
        }
    }

    private fun removeBubble() {
        bubbleView?.let {
            try {
                windowManager.removeView(it)
            } catch (_: IllegalArgumentException) {}
        }
        bubbleView = null
        bubbleParams = null
    }

    private fun removeCloseZone() {
        closeZoneView?.let {
            try {
                windowManager.removeView(it)
            } catch (_: IllegalArgumentException) {}
        }
        closeZoneView = null
        closeZoneParams = null
    }

    private fun getScreenWidth(): Int {
        val metrics = context.resources.displayMetrics
        return metrics.widthPixels
    }

    private fun getScreenHeight(): Int {
        val metrics = context.resources.displayMetrics
        return metrics.heightPixels
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * context.resources.displayMetrics.density).toInt()
    }

    companion object {
        private const val BUBBLE_SIZE_DP = 56
        private const val EDGE_MARGIN_DP = 8
        private const val CLOSE_ZONE_HEIGHT_DP = 72
    }
}
