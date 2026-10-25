package org.hodos.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.DatabaseUtils;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/**
 * Durable, idempotent outbox for geolocated road observations.
 *
 * Events are written to private app storage before network submission. A stable
 * row ID prevents duplicated evidence when the server accepted a request but
 * the response was lost. Successful uploads are removed after acknowledgement.
 * Never store accelerometer samples or secrets here.
 */
final class EventOutbox extends SQLiteOpenHelper {
  private static final String TABLE = "pending_events";
  private static final String REJECTED_TABLE = "rejected_events";

  EventOutbox(Context context) {
    super(context.getApplicationContext(), "hodos-events.db", null, 2);
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE " + TABLE + " (" +
        "id TEXT NOT NULL PRIMARY KEY," +
        "payload TEXT NOT NULL," +
        "created_at INTEGER NOT NULL)");
    createRejectedTable(db);
  }

  private static void createRejectedTable(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE IF NOT EXISTS " + REJECTED_TABLE + " (" +
        "id TEXT NOT NULL PRIMARY KEY," +
        "payload TEXT NOT NULL," +
        "http_status INTEGER NOT NULL," +
        "rejected_at INTEGER NOT NULL)");
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    if (oldVersion == 1 && newVersion == 2) {
      createRejectedTable(db); // Never discard existing pending evidence.
      return;
    }
    throw new IllegalStateException("Unsupported outbox migration");
  }

  synchronized boolean enqueue(String id, String payload) {
    ContentValues values = new ContentValues();
    values.put("id", id);
    values.put("payload", payload);
    values.put("created_at", System.currentTimeMillis());
    return getWritableDatabase().insertWithOnConflict(
        TABLE, null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1;
  }

  synchronized List<Entry> pending(int limit) {
    List<Entry> result = new ArrayList<>();
    try (Cursor cursor = getReadableDatabase().query(
        TABLE, new String[]{"id", "payload"}, null, null, null, null,
        "created_at ASC, id ASC", String.valueOf(Math.max(1, Math.min(limit, 200))))) {
      while (cursor.moveToNext()) {
        result.add(new Entry(cursor.getString(0), cursor.getString(1)));
      }
    }
    return result;
  }

  synchronized void acknowledge(String id) {
    getWritableDatabase().delete(TABLE, "id = ?", new String[]{id});
  }

  synchronized int pendingCount() {
    return (int) DatabaseUtils.longForQuery(getReadableDatabase(),
        "SELECT COUNT(*) FROM " + TABLE, null);
  }

  synchronized int rejectedCount() {
    return (int) DatabaseUtils.longForQuery(getReadableDatabase(),
        "SELECT COUNT(*) FROM " + REJECTED_TABLE, null);
  }

  /** Transactional: a permanent HTTP rejection never destroys the payload. */
  synchronized boolean quarantine(String id, int statusCode) {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      try (Cursor row = db.query(TABLE, new String[]{"payload"}, "id = ?",
          new String[]{id}, null, null, null)) {
        if (!row.moveToFirst()) return false;
        ContentValues values = new ContentValues();
        values.put("id", id);
        values.put("payload", row.getString(0));
        values.put("http_status", statusCode);
        values.put("rejected_at", System.currentTimeMillis());
        if (db.insertWithOnConflict(REJECTED_TABLE, null, values,
            SQLiteDatabase.CONFLICT_REPLACE) == -1) return false;
      }
      db.delete(TABLE, "id = ?", new String[]{id});
      db.setTransactionSuccessful();
      return true;
    } finally {
      db.endTransaction();
    }
  }

  synchronized void deleteRejected(String id) {
    getWritableDatabase().delete(REJECTED_TABLE, "id = ?", new String[]{id});
  }

  /** Explicit user privacy control for data the server could not accept. */
  synchronized void clearRejected() {
    getWritableDatabase().delete(REJECTED_TABLE, null, null);
  }

  static final class Entry {
    final String id;
    final String payload;

    Entry(String id, String payload) {
      this.id = id;
      this.payload = payload;
    }
  }
}
