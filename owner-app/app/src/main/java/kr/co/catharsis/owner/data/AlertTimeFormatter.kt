package kr.co.catharsis.owner.data

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val sqliteUtcFormatter =
    DateTimeFormatter.ofPattern(
        "yyyy-MM-dd HH:mm:ss",
        Locale.ROOT,
    )
private val ownerTimeFormatter =
    DateTimeFormatter
        .ofPattern(
            "M월 d일 a h:mm",
            Locale.KOREAN,
        ).withZone(ZoneId.of("Asia/Seoul"))

fun formatCreatedAt(value: String): String =
    runCatching {
        val instant =
            runCatching { Instant.parse(value) }.getOrElse {
                LocalDateTime.parse(value, sqliteUtcFormatter).toInstant(ZoneOffset.UTC)
            }
        ownerTimeFormatter.format(instant)
    }.getOrElse { value.replace('T', ' ').take(16) }
