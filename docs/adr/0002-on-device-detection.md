# Detect on the device; upload only the conclusion

Impacts are detected on the phone and only the resulting impact — position,
magnitude, severity, time, speed — is uploaded. Raw accelerometer and GPS
traces never leave the device. This is a privacy decision and a bandwidth and
battery decision at once, and it shapes the whole pipeline: the client must
carry the detector, so `@hodos/core` is pure, testable, and platform-free.
