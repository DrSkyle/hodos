# Hodos

Hodos is a passive, crowdsourced road-hazard map: phones sense road defects as
people travel, and the defects accumulate into a public map without anyone
filing a report.

## Language

**Hazard**:
A road defect at a fixed location — a pothole, a speed bump, or rough pavement — that Hodos maps.
_Avoid_: report, issue, complaint, bump

**Impact**:
A single vertical acceleration event a Device detects at a point in space and time.
_Avoid_: jolt, spike, thud

**Event**:
An Impact as it is recorded in the write-only observation log.
_Avoid_: ping, reading, sample, hit

**Pass**:
One traversal of a hazard by a Device, counted as one unit of corroboration.
_Avoid_: trip, visit, crossing

**Device**:
An anonymous client that senses, identified only by a rotating random id.
_Avoid_: user, account, phone owner

**Corroboration**:
Agreement between independent Passes from distinct Devices that a Hazard exists.
_Avoid_: verification, validation

**Confidence**:
The degree to which a Hazard is believed to exist, derived from the Passes that corroborate it.
_Avoid_: score, rating, certainty
