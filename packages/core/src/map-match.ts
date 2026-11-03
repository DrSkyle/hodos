/**
 * Hidden Markov Map Matching Through Noise and Sparseness.
 * Implementation based on Paul Newson & John Krumm (Microsoft Research, ACM SIGSPATIAL 2009).
 */

export interface GPSFix {
  lat: number;
  lng: number;
  t?: number;
  accuracy?: number;
}

export interface RoadSegment {
  id: string;
  name?: string;
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
}

export interface MatchedFix {
  original: GPSFix;
  snapped: { lat: number; lng: number };
  segmentId: string;
  distanceM: number;
}

const DEFAULT_SIGMA_Z = 4.07; // Measurement standard deviation in meters (Newson & Krumm 2009)
const DEFAULT_BETA = 5.0; // Transition distance difference parameter in meters

/**
 * Great-circle distance between two points on Earth in meters.
 */
export function haversineDistanceM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371008.8; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Project a point onto a line segment (start -> end).
 * Returns the nearest point on the segment and the distance in meters.
 */
export function projectPointToSegment(
  p: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): { point: { lat: number; lng: number }; distanceM: number } {
  // Approximate flat-earth projection for local projection parameter t
  const midLat = ((start.lat + end.lat) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(midLat);

  const dx = (end.lng - start.lng) * cosLat;
  const dy = end.lat - start.lat;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return {
      point: { lat: start.lat, lng: start.lng },
      distanceM: haversineDistanceM(p.lat, p.lng, start.lat, start.lng)
    };
  }

  const px = (p.lng - start.lng) * cosLat;
  const py = p.lat - start.lat;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));

  const projLat = start.lat + t * (end.lat - start.lat);
  const projLng = start.lng + t * (end.lng - start.lng);

  return {
    point: { lat: projLat, lng: projLng },
    distanceM: haversineDistanceM(p.lat, p.lng, projLat, projLng)
  };
}

/**
 * Calculate log emission probability:
 * log p(z_t | r_{t,i}) = log(1 / (sqrt(2*pi)*sigma)) - (d^2 / (2 * sigma^2))
 */
function logEmissionProb(distM: number, sigmaZ = DEFAULT_SIGMA_Z): number {
  const normConst = -Math.log(Math.sqrt(2 * Math.PI) * sigmaZ);
  return normConst - (distM * distM) / (2 * sigmaZ * sigmaZ);
}

/**
 * Calculate log transition probability:
 * log p(r_{t+1,j} | r_{t,i}) = log(1 / beta) - (|d_network - d_euclid| / beta)
 */
function logTransitionProb(
  dNetwork: number,
  dEuclid: number,
  beta = DEFAULT_BETA
): number {
  const diff = Math.abs(dNetwork - dEuclid);
  return -Math.log(beta) - diff / beta;
}

/**
 * Perform HMM Map Matching on a sequence of GPS fixes against candidate road segments
 * using the Viterbi algorithm in log space.
 */
export function matchTraceToRoads(
  fixes: GPSFix[],
  segments: RoadSegment[],
  maxSearchRadiusM = 50,
  sigmaZ = DEFAULT_SIGMA_Z,
  beta = DEFAULT_BETA
): MatchedFix[] {
  if (fixes.length === 0 || segments.length === 0) return [];

  // For each fix, find candidate road projections within search radius
  interface Candidate {
    segment: RoadSegment;
    point: { lat: number; lng: number };
    distM: number;
    logEmission: number;
  }

  const candidatesPerFix: Candidate[][] = [];

  for (const fix of fixes) {
    const candidates: Candidate[] = [];
    for (const seg of segments) {
      const proj = projectPointToSegment(fix, seg.start, seg.end);
      if (proj.distanceM <= maxSearchRadiusM) {
        candidates.push({
          segment: seg,
          point: proj.point,
          distM: proj.distanceM,
          logEmission: logEmissionProb(proj.distanceM, sigmaZ)
        });
      }
    }

    // If no candidate within radius, fall back to the absolute nearest segment
    if (candidates.length === 0) {
      const firstSeg = segments[0];
      if (!firstSeg) return [];
      let nearestSeg = firstSeg;
      let nearestProj = projectPointToSegment(fix, firstSeg.start, firstSeg.end);
      for (let s = 1; s < segments.length; s++) {
        const seg = segments[s];
        if (!seg) continue;
        const p = projectPointToSegment(fix, seg.start, seg.end);
        if (p.distanceM < nearestProj.distanceM) {
          nearestProj = p;
          nearestSeg = seg;
        }
      }
      candidates.push({
        segment: nearestSeg,
        point: nearestProj.point,
        distM: nearestProj.distanceM,
        logEmission: logEmissionProb(nearestProj.distanceM, sigmaZ)
      });
    }

    candidatesPerFix.push(candidates);
  }

  // Viterbi forward pass in log-space
  const T = fixes.length;
  const V: number[][] = []; // V[t][i] = max log probability
  const backpointer: number[][] = [];

  // Initial step t = 0
  const firstCandidates = candidatesPerFix[0] ?? [];
  V[0] = firstCandidates.map((c) => c.logEmission);
  backpointer[0] = firstCandidates.map(() => -1);

  // Transitions t = 1 to T - 1
  for (let t = 1; t < T; t++) {
    const vPrev = V[t - 1] ?? [];
    const prevCandidates = candidatesPerFix[t - 1] ?? [];
    const currCandidates = candidatesPerFix[t] ?? [];
    const prevFix = fixes[t - 1]!;
    const currFix = fixes[t]!;

    const vCurr: number[] = [];
    const bpCurr: number[] = [];
    const dEuclid = haversineDistanceM(
      prevFix.lat,
      prevFix.lng,
      currFix.lat,
      currFix.lng
    );

    for (let j = 0; j < currCandidates.length; j++) {
      const curr = currCandidates[j]!;
      let maxLogProb = -Infinity;
      let bestPrev = 0;

      for (let i = 0; i < prevCandidates.length; i++) {
        const prev = prevCandidates[i]!;
        const prevLogProb = vPrev[i] ?? -Infinity;
        // Straight distance between projected points as network distance approximation
        const dNetwork = haversineDistanceM(
          prev.point.lat,
          prev.point.lng,
          curr.point.lat,
          curr.point.lng
        );
        const logTrans = logTransitionProb(dNetwork, dEuclid, beta);
        const totalLogProb = prevLogProb + logTrans + curr.logEmission;

        if (totalLogProb > maxLogProb) {
          maxLogProb = totalLogProb;
          bestPrev = i;
        }
      }

      vCurr[j] = maxLogProb;
      bpCurr[j] = bestPrev;
    }

    V[t] = vCurr;
    backpointer[t] = bpCurr;
  }

  // Backtracking
  let bestLastIdx = 0;
  let maxFinalProb = -Infinity;
  const lastV = V[T - 1] ?? [];
  const lastCandidates = candidatesPerFix[T - 1] ?? [];
  for (let j = 0; j < lastCandidates.length; j++) {
    const prob = lastV[j] ?? -Infinity;
    if (prob > maxFinalProb) {
      maxFinalProb = prob;
      bestLastIdx = j;
    }
  }

  const pathIndices: number[] = new Array(T);
  pathIndices[T - 1] = bestLastIdx;
  for (let t = T - 1; t > 0; t--) {
    const bp = backpointer[t] ?? [];
    const currIdx = pathIndices[t] ?? 0;
    pathIndices[t - 1] = bp[currIdx] ?? 0;
  }

  // Construct matched output
  const result: MatchedFix[] = [];
  for (let t = 0; t < T; t++) {
    const chosenIdx = pathIndices[t] ?? 0;
    const candidates = candidatesPerFix[t] ?? [];
    const chosen = candidates[chosenIdx] ?? candidates[0];
    const originalFix = fixes[t]!;
    if (chosen) {
      result.push({
        original: originalFix,
        snapped: chosen.point,
        segmentId: chosen.segment.id,
        distanceM: chosen.distM
      });
    }
  }

  return result;
}
