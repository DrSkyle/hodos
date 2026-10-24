package org.hodos.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
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

  EventOutbox(Context context) {
    super(context.getApplicationContext(), "hodos-events.db", null, 1);
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE " + TABLE + " (" +
        "id TEXT NOT NULL PRIMARY KEY," +
        "payload TEXT NOT NULL," +
        "created_at INTEGER NOT NULL)");
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    throw new IllegalStateException("Outbox migration required before changing the schema");
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

  static final class Entry {
    final String id;
    final String payload;

    Entry(String id, String payload) {
      this.id = id;
      this.payload = payload;
    }
  }
}
