package org.hodos.app;

/** Server responses which are safe to remove from the active retry loop. */
final class UploadResponsePolicy {
  private UploadResponsePolicy() {}

  // 409 means the server already has our stable row ID; treat as acknowledged.
  static boolean accepted(int status) {
    return (status >= 200 && status < 300) || status == 409;
  }

  // Preserve these rows in a separate on-device table for diagnosis.
  // Never quarantine 401/403, rate limiting, or 5xx: those may recover.
  static boolean isPermanentlyRejected(int status) {
    return status == 400 || status == 413 || status == 422;
  }
}
