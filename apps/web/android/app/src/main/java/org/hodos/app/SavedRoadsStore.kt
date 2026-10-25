package org.hodos.app

import android.content.SharedPreferences

/**
 * Local-only bookmarks for publicly aggregated hazards. This is not a record of
 * where a person traveled and does not collect a new location permission.
 */
internal object SavedRoadsStore {
    private const val KEY = "saved-hazard-ids-v1"
    private const val LIMIT = 100
    private val VALID_ID = Regex("[A-Za-z0-9_-]{1,64}")

    fun normalize(ids: Collection<String>): Set<String> =
        ids.asSequence().filter { VALID_ID.matches(it) }
            .distinct().take(LIMIT).toSet()

    fun load(prefs: SharedPreferences): Set<String> =
        runCatching {
            normalize(prefs.getStringSet(KEY, emptySet())?.toSet().orEmpty())
        }.getOrDefault(emptySet())

    fun setSaved(prefs: SharedPreferences, id: String, save: Boolean): Set<String> {
        val previous = load(prefs)
        if (!VALID_ID.matches(id)) return previous
        if (save && id !in previous && previous.size >= LIMIT) return previous
        val updated = previous.toMutableSet().apply {
            if (save) add(id) else remove(id)
        }.toSet()
        val persisted = runCatching {
            prefs.edit().putStringSet(KEY, updated).commit()
        }.getOrDefault(false)
        return if (persisted) updated else previous
    }
}
