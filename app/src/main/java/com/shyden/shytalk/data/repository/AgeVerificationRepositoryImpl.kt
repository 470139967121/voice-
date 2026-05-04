package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class AgeVerificationRepositoryImpl(
    private val api: WorkerApiClient,
    private val httpClient: OkHttpClient,
) : AgeVerificationRepository {
    override suspend fun requestUploadUrl(
        contentType: AgeVerificationRepository.ContentType,
    ): Resource<AgeVerificationRepository.UploadHandle> =
        firebaseCall("Failed to request upload URL") {
            val resp =
                api.post(
                    "/api/age-verification/upload-url",
                    JSONObject().put("contentType", contentType.wireValue),
                )
            AgeVerificationRepository.UploadHandle(
                uploadUrl = resp.getString("uploadUrl"),
                r2Key = resp.getString("r2Key"),
                expiresInSec = resp.optInt("expiresInSec", 300),
            )
        }

    override suspend fun uploadImage(
        uploadUrl: String,
        contentType: AgeVerificationRepository.ContentType,
        bytes: ByteArray,
    ): Resource<Unit> =
        firebaseCall("Failed to upload ID image") {
            // The signed URL IS the auth — no Bearer header. PUT the
            // bytes raw with the matching Content-Type so R2's signature
            // verification passes.
            val response =
                httpClient
                    .newCall(
                        Request
                            .Builder()
                            .url(uploadUrl)
                            .put(bytes.toRequestBody(contentType.wireValue.toMediaType()))
                            .build(),
                    ).executeAsync()
            response.use {
                if (!it.isSuccessful) {
                    throw RuntimeException("R2 PUT failed: HTTP ${it.code}")
                }
            }
        }

    override suspend fun submit(
        idMethod: AgeVerificationRepository.IdMethod,
        r2Key: String,
    ): Resource<Unit> =
        firebaseCall("Failed to submit verification") {
            api.post(
                "/api/age-verification/submit",
                JSONObject()
                    .put("idMethod", idMethod.wireValue)
                    .put("r2Key", r2Key),
            )
        }
}

private suspend fun Call.executeAsync(): Response =
    suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) = cont.resumeWithException(e)

                override fun onResponse(
                    call: Call,
                    response: Response,
                ) = cont.resume(response)
            },
        )
    }
