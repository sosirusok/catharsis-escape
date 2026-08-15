package kr.co.catharsis.owner.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class AlertDatabaseHelper(
    context: Context,
) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE alerts (
                id INTEGER PRIMARY KEY,
                type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                booking_code TEXT NOT NULL,
                theme_name TEXT NOT NULL,
                service_date TEXT NOT NULL,
                service_time TEXT NOT NULL,
                party_size INTEGER NOT NULL,
                customer_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                amount INTEGER NOT NULL,
                payment_status TEXT NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX alerts_created_idx ON alerts(created_at DESC)")
    }

    override fun onUpgrade(
        db: SQLiteDatabase,
        oldVersion: Int,
        newVersion: Int,
    ) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE alerts ADD COLUMN phone TEXT NOT NULL DEFAULT ''")
            db.execSQL("UPDATE alerts SET phone = phone_last4 WHERE phone = ''")
        }
    }

    @Synchronized
    fun upsert(alerts: List<BookingAlert>): List<BookingAlert> {
        if (alerts.isEmpty()) return emptyList()
        val inserted = mutableListOf<BookingAlert>()
        writableDatabase.beginTransaction()
        try {
            alerts.forEach { alert ->
                val existingRead = readState(alert.id)
                val values = alert.toValues(existingRead ?: false)
                if (existingRead == null) {
                    writableDatabase.insertOrThrow("alerts", null, values)
                    inserted += alert
                } else {
                    writableDatabase.update("alerts", values, "id = ?", arrayOf(alert.id.toString()))
                }
            }
            writableDatabase.setTransactionSuccessful()
        } finally {
            writableDatabase.endTransaction()
        }
        return inserted
    }

    @Synchronized
    fun all(): List<BookingAlert> =
        readableDatabase
            .query(
                "alerts",
                COLUMNS,
                null,
                null,
                null,
                null,
                "id DESC",
            ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.toAlert()) } }

    @Synchronized
    fun maxId(): Long =
        readableDatabase
            .rawQuery(
                "SELECT COALESCE(MAX(id), 0) FROM alerts",
                null,
            ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }

    @Synchronized
    fun markRead(id: Long) {
        writableDatabase.update(
            "alerts",
            ContentValues().apply { put("is_read", 1) },
            "id = ?",
            arrayOf(id.toString()),
        )
    }

    @Synchronized
    fun clear() {
        writableDatabase.delete("alerts", null, null)
    }

    @Synchronized
    fun pruneExpired() {
        writableDatabase.delete(
            "alerts",
            "service_date < date('now', '-5 years')",
            null,
        )
    }

    private fun readState(id: Long): Boolean? =
        readableDatabase
            .query(
                "alerts",
                arrayOf("is_read"),
                "id = ?",
                arrayOf(id.toString()),
                null,
                null,
                null,
                "1",
            ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) == 1 else null }

    private fun BookingAlert.toValues(read: Boolean) =
        ContentValues().apply {
            put("id", id)
            put("type", type)
            put("created_at", createdAt)
            put("booking_code", reservation.bookingCode)
            put("theme_name", reservation.themeName)
            put("service_date", reservation.serviceDate)
            put("service_time", reservation.time)
            put("party_size", reservation.partySize)
            put("customer_name", reservation.name)
            put("phone", reservation.phone)
            put("amount", reservation.amount)
            put("payment_status", reservation.paymentStatus)
            put("is_read", if (read) 1 else 0)
        }

    private fun Cursor.toAlert() =
        BookingAlert(
            id = getLong(getColumnIndexOrThrow("id")),
            type = getString(getColumnIndexOrThrow("type")),
            createdAt = getString(getColumnIndexOrThrow("created_at")),
            reservation =
                ReservationSummary(
                    bookingCode = getString(getColumnIndexOrThrow("booking_code")),
                    themeName = getString(getColumnIndexOrThrow("theme_name")),
                    serviceDate = getString(getColumnIndexOrThrow("service_date")),
                    time = getString(getColumnIndexOrThrow("service_time")),
                    partySize = getInt(getColumnIndexOrThrow("party_size")),
                    name = getString(getColumnIndexOrThrow("customer_name")),
                    phone = getString(getColumnIndexOrThrow("phone")),
                    amount = getLong(getColumnIndexOrThrow("amount")),
                    paymentStatus = getString(getColumnIndexOrThrow("payment_status")),
                ),
            isRead = getInt(getColumnIndexOrThrow("is_read")) == 1,
        )

    companion object {
        private const val DATABASE_NAME = "catharsis_alerts.db"
        private const val DATABASE_VERSION = 2
        private val COLUMNS =
            arrayOf(
                "id",
                "type",
                "created_at",
                "booking_code",
                "theme_name",
                "service_date",
                "service_time",
                "party_size",
                "customer_name",
                "phone",
                "amount",
                "payment_status",
                "is_read",
            )
    }
}
