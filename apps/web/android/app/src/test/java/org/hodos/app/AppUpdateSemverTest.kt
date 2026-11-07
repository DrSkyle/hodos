package org.hodos.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateSemverTest {

    @Test
    fun newerPatchIsOffered() {
        assertTrue(AppUpdateAndShare.isRemoteNewer("2.0.2", "2.0.3"))
    }

    @Test
    fun equalVersionsAreNotOffered() {
        assertFalse(AppUpdateAndShare.isRemoteNewer("2.0.3", "2.0.3"))
    }

    @Test
    fun olderRemoteIsNotOffered() {
        assertFalse(AppUpdateAndShare.isRemoteNewer("2.1.0", "2.0.9"))
    }

    @Test
    fun majorAndMinorJumpsComparePerSegment() {
        assertTrue(AppUpdateAndShare.isRemoteNewer("1.9.9", "2.0.0"))
        assertTrue(AppUpdateAndShare.isRemoteNewer("1.9.9", "1.10.0"))
        assertFalse(AppUpdateAndShare.isRemoteNewer("1.10.0", "1.9.9"))
    }

    @Test
    fun vPrefixIsIgnored() {
        assertTrue(AppUpdateAndShare.isRemoteNewer("2.0.2", "v2.0.3"))
        assertTrue(AppUpdateAndShare.isRemoteNewer("v2.0.2", "2.0.3"))
    }

    @Test
    fun prereleaseSuffixDoesNotInflateTheSegment() {
        // The old parser turned "3-rc1" into 31, so a release candidate looked
        // newer than the final release.
        assertFalse(AppUpdateAndShare.isRemoteNewer("2.0.3", "2.0.3-rc1"))
        assertFalse(AppUpdateAndShare.isRemoteNewer("2.0.3-rc1", "2.0.3"))
        assertTrue(AppUpdateAndShare.isRemoteNewer("2.0.3", "2.0.4-rc1"))
    }

    @Test
    fun missingSegmentsTreatAsZero() {
        assertFalse(AppUpdateAndShare.isRemoteNewer("2.0.0", "2.0"))
        assertTrue(AppUpdateAndShare.isRemoteNewer("2.0", "2.0.1"))
    }
}
