package kr.co.catharsis.owner.data

import kr.co.catharsis.owner.BuildConfig
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class OwnerApi(
    private val baseUrl: String = BuildConfig.API_BASE,
) {
    fun pair(
        accessKey: String,
        deviceName: String,
    ): String {
        val body =
            JSONObject()
                .put("accessKey", accessKey)
                .put("deviceName", deviceName)
                .toString()

        val response =
            request(
                method = "POST",
                path = "/api/owner-app/pair",
                body = body,
            )
        val json = JSONObject(response)
        if (!json.optBoolean("ok", false)) {
            throw ApiException(json.optString("message", "운영 키를 확인해 주세요."))
        }
        return json.optString("token").takeIf { it.isNotBlank() && it != "null" }
            ?: throw ApiException("장치 연결 토큰을 받지 못했습니다.")
    }

    fun fetchAlerts(
        token: String,
        after: Long,
        limit: Int = 100,
    ): AlertPage {
        val response =
            request(
                method = "GET",
                path = "/api/owner-app/alerts?after=$after&limit=$limit",
                token = token,
            )
        return AlertPayloadParser.parsePage(response, pageSize = limit)
    }

    fun unpair(token: String) {
        request(
            method = "DELETE",
            path = "/api/owner-app/device",
            token = token,
        )
    }

    fun registerPushInstallation(
        token: String,
        installationId: String,
    ) {
        request(
            method = "PATCH",
            path = "/api/owner-app/device",
            body = JSONObject().put("installationId", installationId).toString(),
            token = token,
        )
    }

    private fun request(
        method: String,
        path: String,
        body: String? = null,
        token: String? = null,
    ): String {
        val connection =
            (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 12_000
                readTimeout = 15_000
                useCaches = false
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-store")
                if (token != null) setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }

        try {
            if (body != null) {
                connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val message =
                    runCatching {
                        val json = JSONObject(response)
                        json
                            .optJSONObject("error")
                            ?.optString("message")
                            .orEmpty()
                            .ifBlank { json.optString("message") }
                    }.getOrNull().orEmpty().ifBlank {
                        if (status == 401 || status == 403) {
                            "운영 키 또는 장치 연결을 확인해 주세요."
                        } else {
                            "서버 연결에 실패했습니다. ($status)"
                        }
                    }
                throw ApiException(message, status)
            }
            return response
        } finally {
            connection.disconnect()
        }
    }
}
