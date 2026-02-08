package com.example.shytalk.core.pip

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Intent
import android.graphics.drawable.Icon
import android.util.Rational
import com.example.shytalk.core.room.RoomService

object PipHelper {
    fun enterPipMode(activity: Activity) {
        val params = buildPipParams(activity)
        activity.enterPictureInPictureMode(params)
    }

    private fun buildPipParams(activity: Activity): PictureInPictureParams {
        val leaveIntent = PendingIntent.getService(
            activity, 1,
            Intent(activity, RoomService::class.java).apply {
                action = RoomService.ACTION_STOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val leaveAction = RemoteAction(
            Icon.createWithResource(activity, android.R.drawable.ic_menu_close_clear_cancel),
            "Leave",
            "Leave the room",
            leaveIntent
        )

        return PictureInPictureParams.Builder()
            .setAspectRatio(Rational(3, 4))
            .setActions(listOf(leaveAction))
            .build()
    }
}
