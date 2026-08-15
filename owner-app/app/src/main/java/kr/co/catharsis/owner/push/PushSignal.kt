package kr.co.catharsis.owner.push

object PushSignal {
    fun alertId(data: Map<String, String>): Long? =
        data["alertId"]
            ?.takeIf { it.matches(Regex("[1-9][0-9]{0,18}")) }
            ?.toLongOrNull()
            ?.takeIf { it > 0 }
}
