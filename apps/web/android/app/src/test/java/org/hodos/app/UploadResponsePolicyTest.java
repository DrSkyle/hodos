package org.hodos.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public final class UploadResponsePolicyTest {
  @Test public void successAndIdempotentReplayAcknowledge() {
    for (int code : new int[]{200, 201, 204, 409}) {
      assertTrue(UploadResponsePolicy.accepted(code));
      assertFalse(UploadResponsePolicy.isPermanentlyRejected(code));
    }
  }

  @Test public void invalidEvidenceGoesToPrivateQuarantine() {
    for (int code : new int[]{400, 413, 422}) {
      assertTrue(UploadResponsePolicy.isPermanentlyRejected(code));
      assertFalse(UploadResponsePolicy.accepted(code));
    }
  }

  @Test public void transientAndPermissionErrorsMustRemainRetryable() {
    for (int code : new int[]{0, 401, 403, 404, 408, 429, 500, 502, 503, 504}) {
      assertFalse(UploadResponsePolicy.accepted(code));
      assertFalse(UploadResponsePolicy.isPermanentlyRejected(code));
    }
  }
}
