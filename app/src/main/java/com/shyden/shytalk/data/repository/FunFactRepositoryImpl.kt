package com.shyden.shytalk.data.repository

import android.content.Context
import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class FunFactRepositoryImpl(
    private val api: WorkerApiClient,
    private val context: Context
) : FunFactRepository {

    private val cacheFile get() = File(context.filesDir, "fun_facts_cache.json")

    @Volatile
    private var memoryCache: List<FunFact>? = null

    override suspend fun syncFacts(): List<FunFact> {
        val arr = api.getArray("/api/fun-facts")
        val facts = (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            FunFact.fromMap(obj.toMap(), obj.getString("id"))
        }

        // Persist to local cache
        val jsonArray = JSONArray()
        for (fact in facts) {
            val obj = JSONObject()
            obj.put("id", fact.id)
            obj.put("text", fact.text)
            obj.put("category", fact.category)
            obj.put("emoji", fact.emoji)
            obj.put("sourceLanguage", fact.sourceLanguage)
            jsonArray.put(obj)
        }
        cacheFile.writeText(jsonArray.toString())
        memoryCache = facts
        return facts
    }

    override fun getCachedFacts(): List<FunFact> {
        memoryCache?.let { return it }

        if (!cacheFile.exists()) return emptyList()

        return try {
            val arr = JSONArray(cacheFile.readText())
            val facts = (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                FunFact(
                    id = obj.getString("id"),
                    text = obj.getString("text"),
                    category = obj.optString("category", "trivia"),
                    emoji = obj.optString("emoji", ""),
                    sourceLanguage = obj.optString("sourceLanguage", "")
                )
            }
            memoryCache = facts
            facts
        } catch (_: Exception) {
            emptyList()
        }
    }
}
