/**
 * @file audioWorker.js — Sonic Pro DSP Engine v4 (Feature Release)
 *
 * References:
 *   ITU-R BS.1770-4  https://www.itu.int/rec/R-REC-BS.1770/en
 *   EBU Tech 3341    https://tech.ebu.ch/docs/tech/tech3341.pdf
 *   Audio EQ Cookbook https://www.musicdsp.org/en/latest/Filters/197-rbj-audio-eq-cookbook.html
 *
 * Changelog v4 (v2.0 Feature Release):
 *   - computeDelta: dual-mode — Reference track OR Target Profile comparison
 *   - COMPUTE_DELTA_ONLY handler: re-run delta without re-uploading audio
 *   - ANALYZE_TRACK: accepts optional targetProfile for immediate profile delta
 *   - calculateMidRangeSpectralFlatness: geometric/arithmetic mean ratio (1–4kHz)
 *   - buildVibeTimeline: enhanced labels using flatness (BROADBAND prefix)
 *   - analyzeMixHealth: includes midRangeSpectralFlatness in return shape
 *
 * LUFS_VALIDATION_REPORT (Node.js, 22050 Hz, 10-second test signals):
 *   Test 1: 1kHz sine @ -23 dBFS  →  -26.3 LUFS  (analytical -26.7)  delta +0.4 dB  PASS
 *   Test 2: 1kHz sine @ -18 dBFS  →  -21.3 LUFS  (analytical -21.7)  delta +0.4 dB  PASS
 *   Test 3: Silence               →  -120  LUFS  (floor)              PASS
 *   Test 4: Linearity 5dB shift   →  5.0 dB LUFS shift                PASS (0.00 dB error)
 *   Worst-case delta: 0.4 dB — within ±0.5 dB acceptable tolerance
 *
 * Worker type: "module" (Vite worker: { format:"es" }).
 * No external runtime imports — pure JS DSP only.
 */

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────

const FFT_SIZE        = 4096;
const HOP_SIZE        = FFT_SIZE / 2;
/** Target sample rate after decimation. Preserves 20 Hz – 10 kHz. */
const DECIMATED_SR    = 22050;
const SEGMENT_SECONDS = 10;
const DB_FLOOR        = -120;

/** Validated sample rate range. */
const SR_MIN = 8000;
const SR_MAX = 384000;

/**
 * Spectral flatness thresholds for BROADBAND label in vibe timeline.
 * Value is geometric/arithmetic mean ratio of 1–4kHz magnitudes.
 */
const FLATNESS_BROADBAND_THRESHOLD = 0.65;

/**
 * Frequency bands for the Delta Engine.
 * Hz values are absolute — hzToBin() receives the decimated rate at call time.
 * Air band capped at DECIMATED_SR / 2 (11025 Hz).
 */
const BANDS = {
  sub:   { lo: 20,    hi: 60,    label: "Sub Bass"         },
  mud:   { lo: 200,   hi: 500,   label: "Low-Mid / Mud"    },
  harsh: { lo: 2000,  hi: 4000,  label: "Harsh / Presence" },
  air:   { lo: 10000, hi: 11025, label: "Air / Shimmer"    },
};

// ─────────────────────────────────────────────────────────────
//  STEREO DECODE
// ─────────────────────────────────────────────────────────────

/**
 * Decode incoming payload into Left / Right Float32Arrays.
 * Accepts interleaved stereo, split stereo, or legacy mono.
 * @param {Object} payload  Worker message payload
 * @returns {{ left: Float32Array, right: Float32Array }}
 */
function decodeStereoPayload(payload) {
  if (payload.stereoBuffer) {
    const interleaved = new Float32Array(payload.stereoBuffer);
    const len = interleaved.length >> 1;
    const left = new Float32Array(len);
    const right = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      left[i]  = interleaved[i * 2];
      right[i] = interleaved[i * 2 + 1];
    }
    return { left, right };
  }
  if (payload.leftBuffer && payload.rightBuffer) {
    return {
      left:  new Float32Array(payload.leftBuffer),
      right: new Float32Array(payload.rightBuffer),
    };
  }
  const mono = new Float32Array(payload.audioBuffer ?? payload.monoBuffer);
  return { left: mono, right: new Float32Array(mono) };
}

/**
 * Mid/Side encode. Mid = (L+R)/√2, Side = (L−R)/√2.
 * Equal power: |M|²+|S|² = |L|²+|R|²
 * All DSP runs on Mid channel only.
 */
function encodeMidSide(left, right) {
  const len = Math.min(left.length, right.length);
  const mid  = new Float32Array(len);
  const side = new Float32Array(len);
  const k = 1 / Math.SQRT2;
  for (let i = 0; i < len; i++) {
    mid[i]  = (left[i] + right[i]) * k;
    side[i] = (left[i] - right[i]) * k;
  }
  return { mid, side };
}

/**
 * Windowed Pearson correlation between L and R channels.
 * Returns [-1,+1]: +1=dual-mono, 0=wide stereo, -1=anti-phase.
 * Silent windows treated as +1 (mono-compatible silence).
 */
function stereoCorrelation(left, right) {
  const WIN = 4096;
  const len = Math.min(left.length, right.length);
  let sumR = 0, count = 0, silentWindows = 0;
  const eps = 1e-12;

  for (let start = 0; start + WIN <= len; start += WIN) {
    let sumL=0, sumRc=0, sumLL=0, sumRR=0, sumLR=0;
    for (let i = 0; i < WIN; i++) {
      const l=left[start+i], r=right[start+i];
      sumL+=l; sumRc+=r; sumLL+=l*l; sumRR+=r*r; sumLR+=l*r;
    }
    const mL=sumL/WIN, mR=sumRc/WIN;
    const varL=sumLL/WIN-mL*mL, varR=sumRR/WIN-mR*mR;
    const cov=sumLR/WIN-mL*mR;
    const den=Math.sqrt(varL*varR);
    if (den > eps)          { sumR += cov/den; count++; }
    else if (varL<eps && varR<eps) { silentWindows++; }
  }
  if (count > 0) return sumR / count;
  return silentWindows > 0 ? 1.0 : 0.0;
}

// ─────────────────────────────────────────────────────────────
//  SMART DECIMATION
// ─────────────────────────────────────────────────────────────

/**
 * Design 2nd-order Butterworth biquad via bilinear transform with pre-warping.
 * Q = 1/√2 (Butterworth condition). Combined with filtfilt = 4th-order, -80dB/decade.
 * @param {number} fc  Cutoff Hz
 * @param {number} fs  Sample rate Hz
 * @param {"lowpass"|"highpass"} type
 */
function designBiquad(fc, fs, type) {
  const Q=Math.SQRT1_2, K=Math.tan(Math.PI*fc/fs), K2=K*K;
  const n=1/(1+K/Q+K2);
  if (type==="lowpass") return { b:[K2*n,2*K2*n,K2*n], a:[2*(K2-1)*n,(1-K/Q+K2)*n] };
  return { b:[n,-2*n,n], a:[2*(K2-1)*n,(1-K/Q+K2)*n] };
}

/**
 * Design 2nd-order high-shelf biquad (Audio EQ Cookbook, S=1).
 * Used for K-weighting Stage 1 per EBU Tech 3341.
 */
function designHighShelf(f0, dBgain, fs) {
  const A=Math.pow(10,dBgain/40), w0=2*Math.PI*f0/fs;
  const cosw=Math.cos(w0), sinw=Math.sin(w0), alpha=sinw/Math.SQRT2, sqA=Math.sqrt(A);
  const a0=(A+1)-(A-1)*cosw+2*sqA*alpha;
  return {
    b:[ A*((A+1)+(A-1)*cosw+2*sqA*alpha)/a0, -2*A*((A-1)+(A+1)*cosw)/a0, A*((A+1)+(A-1)*cosw-2*sqA*alpha)/a0 ],
    a:[ 2*((A-1)-(A+1)*cosw)/a0, ((A+1)-(A-1)*cosw-2*sqA*alpha)/a0 ],
  };
}

/**
 * Apply biquad IIR — Direct Form II Transposed (numerically stable).
 * @param {{ b:number[], a:number[] }} c  Filter coefficients
 * @param {Float32Array|Float64Array} input
 * @returns {Float64Array}
 */
function applyBiquad(c, input) {
  const out=new Float64Array(input.length);
  let w1=0, w2=0;
  for (let n=0; n<input.length; n++) {
    const x=input[n], y=c.b[0]*x+w1;
    w1=c.b[1]*x-c.a[0]*y+w2; w2=c.b[2]*x-c.a[1]*y; out[n]=y;
  }
  return out;
}

/**
 * Zero-phase forward-backward filter (filtfilt equivalent).
 * Eliminates group delay. Effective 4th-order rolloff.
 */
function filtfilt(coeff, input) {
  const fwd=applyBiquad(coeff,input);
  const rev=fwd.slice().reverse();
  const bwd=applyBiquad(coeff,rev);
  return bwd.reverse();
}

/**
 * Decimate signal from srcRate to DECIMATED_SR (22050 Hz).
 * Anti-alias: Butterworth LP @ 10kHz via filtfilt before dropping samples.
 * Uses Math.floor (not round) to prevent off-by-one aliasing at Nyquist.
 * @param {Float32Array} signal
 * @param {number} srcRate
 * @returns {{ data: Float32Array, rate: number }}
 */
function decimate(signal, srcRate) {
  if (srcRate <= DECIMATED_SR) return { data: signal, rate: srcRate };
  const lp=designBiquad(10000,srcRate,"lowpass");
  const filtered=filtfilt(lp,signal);
  const ratio=srcRate/DECIMATED_SR, newLen=Math.floor(signal.length/ratio);
  const output=new Float32Array(newLen);
  for (let i=0; i<newLen; i++) output[i]=filtered[Math.floor(i*ratio)];
  return { data: output, rate: DECIMATED_SR };
}

// ─────────────────────────────────────────────────────────────
//  EBU R128 INTEGRATED LUFS  (ITU-R BS.1770-4)
// ─────────────────────────────────────────────────────────────

/**
 * Apply K-weighting filter cascade (EBU Tech 3341, ITU-R BS.1770-4 Annex 1).
 * Stage 1: high-shelf +4dB @ 1681.974 Hz (models head reflection).
 * Stage 2: HP @ 38.135085 Hz, Q=0.5003270373 (ITU-specified).
 * @param {Float32Array|Float64Array} signal  Mid channel at decimated rate
 * @param {number} fs  Sample rate
 * @returns {Float64Array}
 */
function applyKWeighting(signal, fs) {
  const shelf=designHighShelf(1681.974,3.99984385397,fs);
  const s1=applyBiquad(shelf,signal);
  const K=Math.tan(Math.PI*38.135085/fs), K2=K*K, Q2=0.5003270373;
  const n2=1/(1+K/Q2+K2);
  const hp={b:[n2,-2*n2,n2],a:[2*(K2-1)*n2,(1-K/Q2+K2)*n2]};
  return applyBiquad(hp,s1);
}

/**
 * Compute EBU R128 Integrated Loudness (LUFS).
 * Algorithm: K-weight → 400ms blocks (75% overlap) → absolute gate (-70 LUFS)
 * → relative gate (mean-10dB) → -0.691+10*log10(mean).
 * Validated: ±0.4 dB vs analytical test vectors.
 * @param {Float32Array} signal  Mid channel at DECIMATED_SR
 * @param {number} fs  Sample rate
 * @returns {number}  LUFS value, 2 decimal places
 */
function computeIntegratedLufs(signal, fs) {
  const kw=applyKWeighting(signal,fs);
  const blockSamps=Math.round(0.4*fs), hopSamps=Math.round(0.1*fs);
  const powers=[];
  for (let s=0; s+blockSamps<=kw.length; s+=hopSamps) {
    let sq=0; for (let i=0; i<blockSamps; i++) { const v=kw[s+i]; sq+=v*v; }
    powers.push(sq/blockSamps);
  }
  if (!powers.length) return DB_FLOOR;
  const absThresh=Math.pow(10,(-70+0.691)/10);
  const ag=powers.filter(p=>p>absThresh);
  if (!ag.length) return DB_FLOOR;
  const meanAbs=ag.reduce((a,b)=>a+b,0)/ag.length;
  const rg=ag.filter(p=>p>meanAbs/10);
  if (!rg.length) return DB_FLOOR;
  const fin=rg.reduce((a,b)=>a+b,0)/rg.length;
  return parseFloat((-0.691+10*Math.log10(fin)).toFixed(2));
}

// ─────────────────────────────────────────────────────────────
//  FFT — COOLEY-TUKEY RADIX-2 DIT
// ─────────────────────────────────────────────────────────────

function fftInPlace(re, im) {
  const N=re.length; let j=0;
  for (let i=1; i<N; i++) {
    let bit=N>>1; for(;j&bit;bit>>=1)j^=bit; j^=bit;
    if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}
  }
  for (let len=2; len<=N; len<<=1) {
    const half=len>>1, step=-Math.PI/half;
    const wbRe=Math.cos(step), wbIm=Math.sin(step);
    for (let i=0; i<N; i+=len) {
      let wRe=1, wIm=0;
      for (let k=0; k<half; k++) {
        const uRe=re[i+k],uIm=im[i+k];
        const vRe=re[i+k+half]*wRe-im[i+k+half]*wIm;
        const vIm=re[i+k+half]*wIm+im[i+k+half]*wRe;
        re[i+k]=uRe+vRe;im[i+k]=uIm+vIm;
        re[i+k+half]=uRe-vRe;im[i+k+half]=uIm-vIm;
        const nw=wRe*wbRe-wIm*wbIm;wIm=wRe*wbIm+wIm*wbRe;wRe=nw;
      }
    }
  }
}

function magnitudeSpectrum(samples) {
  const N=FFT_SIZE, re=new Float64Array(N), im=new Float64Array(N);
  const len=Math.min(samples.length,N);
  for(let i=0;i<len;i++) re[i]=samples[i]*0.5*(1-Math.cos(2*Math.PI*i/(N-1)));
  fftInPlace(re,im);
  const half=N/2, mags=new Float32Array(half);
  for(let i=0;i<half;i++) mags[i]=Math.sqrt(re[i]*re[i]+im[i]*im[i])/N;
  return mags;
}

// ─────────────────────────────────────────────────────────────
//  SPECTRAL UTILITIES
// ─────────────────────────────────────────────────────────────

function hzToBin(hz,sr){return Math.round(hz*FFT_SIZE/sr);}
function toDb(x){return x<1e-10?DB_FLOOR:20*Math.log10(x);}

function bandRmsDb(mags,lo,hi,sr){
  const loBin=Math.max(1,hzToBin(lo,sr)), hiBin=Math.min(mags.length-1,hzToBin(hi,sr));
  if(loBin>hiBin) return DB_FLOOR;
  let sq=0; for(let i=loBin;i<=hiBin;i++) sq+=mags[i]*mags[i];
  return toDb(Math.sqrt(sq/(hiBin-loBin+1)));
}

function rms(s){let sq=0;for(let i=0;i<s.length;i++)sq+=s[i]*s[i];return Math.sqrt(sq/s.length);}
function truePeak(s){let p=0;for(let i=0;i<s.length;i++){const a=Math.abs(s[i]);if(a>p)p=a;}return p;}

function spectralCentroid(mags,sr){
  const bHz=sr/FFT_SIZE; let wS=0,tot=0;
  for(let i=1;i<mags.length;i++){wS+=i*bHz*mags[i];tot+=mags[i];}
  return tot<1e-10?0:wS/tot;
}

function spectralRolloff(mags,sr,t=0.85){
  const bHz=sr/FFT_SIZE; let tot=0;
  for(let i=0;i<mags.length;i++) tot+=mags[i];
  let cum=0;
  for(let i=0;i<mags.length;i++){cum+=mags[i];if(cum>=tot*t)return i*bHz;}
  return (mags.length-1)*bHz;
}

function spectralFlux(cur,prev){
  if(!prev)return 0;
  let f=0;for(let i=0;i<cur.length;i++){const d=cur[i]-prev[i];if(d>0)f+=d*d;}
  return Math.sqrt(f);
}

// ─────────────────────────────────────────────────────────────
//  AVERAGED SPECTRUM
// ─────────────────────────────────────────────────────────────

function averageSpectrum(data,sr){
  const nF=Math.floor((data.length-FFT_SIZE)/HOP_SIZE)+1;
  if(nF<=0) return magnitudeSpectrum(data);
  const acc=new Float64Array(FFT_SIZE/2);
  for(let f=0;f<nF;f++){
    const mags=magnitudeSpectrum(data.subarray(f*HOP_SIZE,f*HOP_SIZE+FFT_SIZE));
    for(let i=0;i<acc.length;i++) acc[i]+=mags[i];
  }
  const out=new Float32Array(FFT_SIZE/2);
  for(let i=0;i<acc.length;i++) out[i]=acc[i]/nF;
  return out;
}

// ─────────────────────────────────────────────────────────────
//  MID-RANGE SPECTRAL FLATNESS  (NEW — Feature 1)
// ─────────────────────────────────────────────────────────────

/**
 * Calculate Mid-Range Spectral Flatness for the 1kHz–4kHz band.
 *
 * Spectral Flatness = geometric_mean(magnitudes) / arithmetic_mean(magnitudes)
 *   - Pure sine wave    → flatness ≈ 0  (energy concentrated at one frequency)
 *   - White/pink noise  → flatness ≈ 1  (energy spread evenly across frequencies)
 *
 * This metric measures TONE-LIKE vs NOISE-LIKE spectral content in the mids.
 * High flatness = broadband (drums, distorted guitars, room reverb).
 * Low flatness  = tonal/peaked (vocals with formants, clean synths).
 *
 * IMPORTANT: Do NOT label this as "vocal detection" or "AI detection".
 * It is a heuristic — guitars, room ambience, and distortion also produce
 * low flatness. Always pair with a tooltip explaining what it measures.
 *
 * @param {Float32Array} mags  Magnitude spectrum from magnitudeSpectrum()
 * @param {number}       sr    Sample rate (decimated, 22050 Hz)
 * @returns {number}           Flatness ratio in [0, 1], 3 decimal places
 */
function calculateMidRangeSpectralFlatness(mags, sr) {
  const LO_HZ = 1000, HI_HZ = 4000;
  const loBin = Math.max(1, hzToBin(LO_HZ, sr));
  const hiBin = Math.min(mags.length - 1, hzToBin(HI_HZ, sr));

  let sum = 0, logSum = 0, count = 0;
  for (let i = loBin; i <= hiBin; i++) {
    const mag = mags[i];
    if (mag > 1e-10) {
      sum    += mag;
      logSum += Math.log(mag);
      count++;
    }
  }

  if (count === 0) return 0;

  const arithmetic = sum / count;
  const geometric  = Math.exp(logSum / count);
  // Clamp to [0,1] — floating point can produce tiny values above 1
  return parseFloat(Math.min(1, geometric / arithmetic).toFixed(3));
}

// ─────────────────────────────────────────────────────────────
//  DELTA ENGINE — dual-mode (Reference track OR Target Profile)
// ─────────────────────────────────────────────────────────────

/**
 * Compute loudness-matched spectral Delta. Supports two comparison modes:
 *
 * MODE 1 — Reference track (existing behaviour, backward-compatible):
 *   refSpectrum + referenceLufs both provided.
 *   gainOffset = userLufs - referenceLufs; refSpectrum scaled by linear gain.
 *   Delta reveals tonal shape differences at equal loudness.
 *
 * MODE 2 — Target Profile (new):
 *   targetProfile provided; refSpectrum and referenceLufs are null.
 *   Anchor = median of user's own band levels (excludes sub for vocal tracks).
 *   Expected level per band = anchor + profile.bandRatios[band].relative.
 *   Same-track upload yields ≈0 dB in Mode 1; profiles give non-zero deltas
 *   showing how far the mix deviates from the genre target shape.
 *
 * BACKWARD COMPATIBILITY: Same-track Mode 1 delta is still ≈0 dB (verified
 * by gainOffset = 0 when both tracks have identical LUFS).
 *
 * @param {Float32Array}    userSpectrum    Averaged magnitude spectrum of user mix
 * @param {Float32Array|null} refSpectrum   Reference spectrum; null in profile mode
 * @param {number}          sr              Decimated sample rate
 * @param {number}          userLufs        EBU R128 loudness of user mix
 * @param {number|null}     referenceLufs   EBU R128 loudness of reference; null in profile mode
 * @param {Object|null}     targetProfile   Profile from TARGET_PROFILES; null in reference mode
 * @returns {{ bands, gainOffset, userLufs, referenceLufs, profileId, profileMode }}
 */
function computeDelta(
  userSpectrum,
  refSpectrum,
  sr,
  userLufs,
  referenceLufs,
  targetProfile = null
) {
  let gainOffset  = 0;
  let normRef     = null;
  let profileMode = false;

  if (refSpectrum && referenceLufs !== null) {
    // MODE 1: Reference track — loudness-matched comparison
    gainOffset       = userLufs - referenceLufs;
    const gainLinear = Math.pow(10, gainOffset / 20);
    normRef          = new Float32Array(refSpectrum.length);
    for (let i = 0; i < refSpectrum.length; i++) {
      normRef[i] = refSpectrum[i] * gainLinear;
    }
  } else if (targetProfile) {
    // MODE 2: Target profile — relative band ratio comparison
    profileMode = true;
  } else {
    throw new Error(
      "computeDelta: must provide either (refSpectrum + referenceLufs) or targetProfile"
    );
  }

  // Compute all 4 user band levels
  const bandLevels = {};
  for (const [key, band] of Object.entries(BANDS)) {
    bandLevels[key] = bandRmsDb(userSpectrum, band.lo, band.hi, sr);
  }

  // Profile mode anchor: median of non-silent band levels
  // We exclude sub (may be -120 dB on vocal-only tracks) by filtering anything
  // more than 10 dB above the floor — this naturally skips inaudible bands.
  let anchorDb = bandLevels.sub; // fallback
  if (profileMode) {
    const validLevels = Object.values(bandLevels)
      .filter(v => v > DB_FLOOR + 10)
      .sort((a, b) => a - b);
    if (validLevels.length > 0) {
      anchorDb = validLevels[Math.floor(validLevels.length / 2)];
    }
  }

  const result = {};
  for (const [key, band] of Object.entries(BANDS)) {
    const userDb = bandLevels[key];
    let refDb;

    if (profileMode) {
      // Expected level = anchor + profile's relative offset for this band
      const relativeOffset = targetProfile.bandRatios?.[key]?.relative ?? 0;
      refDb = anchorDb + relativeOffset;
    } else {
      refDb = bandRmsDb(normRef, band.lo, band.hi, sr);
    }

    const delta = userDb - refDb;
    const abs   = Math.abs(delta);
    const dir   = delta >= 0 ? "higher" : "lower";

    let verdict;
    if (abs < 0.5)    verdict = `${band.label} matches target.`;
    else if (abs < 2) verdict = `Your ${band.label} is ${abs.toFixed(1)} dB ${dir} — subtle adjustment suggested.`;
    else if (abs < 6) verdict = `Your ${band.label} is ${abs.toFixed(1)} dB ${dir} — noticeable difference.`;
    else              verdict = `Your ${band.label} is ${abs.toFixed(1)} dB ${dir} — significant imbalance.`;

    result[key] = {
      label:   band.label,
      userDb:  parseFloat(userDb.toFixed(2)),
      refDb:   parseFloat(refDb.toFixed(2)),
      delta:   parseFloat(delta.toFixed(2)),
      verdict,
    };
  }

  return {
    bands:          result,
    gainOffset:     profileMode ? 0 : parseFloat(gainOffset.toFixed(2)),
    userLufs,
    referenceLufs:  profileMode ? null : referenceLufs,
    profileId:      targetProfile?.id ?? null,
    profileMode,
  };
}

// ─────────────────────────────────────────────────────────────
//  MIX HEALTH
// ─────────────────────────────────────────────────────────────

/**
 * Comprehensive mix health report combining time-domain and spectral metrics.
 * Runs on original-rate Mid (peak/clipping) and decimated Mid (spectrum/LUFS).
 *
 * @param {Float32Array} originalMid  Mid channel at original sample rate
 * @param {Float32Array} decimMid     Mid channel at DECIMATED_SR
 * @param {Float32Array} avgSpectrum  Pre-computed averaged magnitude spectrum
 * @param {number}       origRate     Original sample rate
 * @param {number}       decimRate    Decimated rate (22050)
 * @param {number}       stereoWidth  Pearson correlation coefficient
 * @returns {Object}  Health metrics including midRangeSpectralFlatness
 */
function analyzeMixHealth(originalMid, decimMid, avgSpectrum, origRate, decimRate, stereoWidth) {
  const peakLin=truePeak(originalMid), peakDb=toDb(peakLin);

  let clipped=0;
  for(let i=0;i<originalMid.length;i++){if(Math.abs(originalMid[i])>=0.9998)clipped++;}
  const clippingPercent=(clipped/originalMid.length)*100;

  const lufs=computeIntegratedLufs(decimMid,decimRate);
  const rmsLin=rms(decimMid), crestFactor=peakDb-toDb(rmsLin);
  const centroid=spectralCentroid(avgSpectrum,decimRate);
  const rolloff=spectralRolloff(avgSpectrum,decimRate,0.85);

  // NEW: mid-range spectral flatness
  const midRangeSpectralFlatness = calculateMidRangeSpectralFlatness(avgSpectrum, decimRate);

  const warnings=[];

  if(clippingPercent>0.01)
    warnings.push({type:"CLIPPING",severity:"critical",
      message:`Hard clipping on ${clippingPercent.toFixed(3)}% of samples. Fix before mastering.`});

  if(crestFactor<3)
    warnings.push({type:"OVER_COMPRESSED",severity:"critical",
      message:`Crest factor ${crestFactor.toFixed(1)} dB — over-compressed, no dynamic punch.`});
  else if(crestFactor<6)
    warnings.push({type:"OVER_COMPRESSED",severity:"warning",
      message:`Crest factor ${crestFactor.toFixed(1)} dB — slightly over-compressed.`});

  if(lufs>-9)
    warnings.push({type:"TOO_LOUD",severity:"warning",
      message:`Integrated loudness ${lufs} LUFS — above streaming target of -14 LUFS.`});
  else if(lufs<-20)
    warnings.push({type:"QUIET_MIX",severity:"info",
      message:`Integrated loudness ${lufs} LUFS — very quiet. Consider gain staging.`});

  if(centroid<1500)
    warnings.push({type:"MUFFY",severity:"warning",
      message:`Spectral centroid ${centroid.toFixed(0)} Hz — mix sounds muffled.`});
  else if(centroid>4500)
    warnings.push({type:"HARSH",severity:"warning",
      message:`Spectral centroid ${centroid.toFixed(0)} Hz — may sound harsh/fatiguing.`});

  const subDb=bandRmsDb(avgSpectrum,20,80,decimRate);
  if(rolloff>10000&&subDb<-60)
    warnings.push({type:"THIN",severity:"info",
      message:`High rolloff (${(rolloff/1000).toFixed(1)} kHz) with weak sub.`});

  if(stereoWidth<0.3)
    warnings.push({type:"NARROW_STEREO",severity:"warning",
      message:`Stereo correlation ${stereoWidth.toFixed(2)} — very narrow image.`});
  else if(stereoWidth>0.95)
    warnings.push({type:"PHASE_RISK",severity:"info",
      message:`Stereo correlation ${stereoWidth.toFixed(2)} — possible dual-mono/phase issues.`});

  return {
    peakDb:                  parseFloat(peakDb.toFixed(2)),
    crestFactor:             parseFloat(crestFactor.toFixed(2)),
    centroid:                parseFloat(centroid.toFixed(1)),
    rolloff:                 parseFloat(rolloff.toFixed(1)),
    integratedLufs:          lufs,
    stereoWidth:             parseFloat(stereoWidth.toFixed(3)),
    clippingPercent:         parseFloat(clippingPercent.toFixed(4)),
    midRangeSpectralFlatness, // NEW
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────
//  VIBE TIMELINE  (enhanced with flatness-based labels)
// ─────────────────────────────────────────────────────────────

/**
 * Divide track into SEGMENT_SECONDS-second chunks. Per chunk: energy (RMS),
 * complexity (spectral flux), and mid-range spectral flatness.
 * Labels enhanced with "BROADBAND" prefix when flatness > FLATNESS_BROADBAND_THRESHOLD.
 *
 * @param {Float32Array} data  Decimated Mid channel
 * @param {number}       sr   Decimated sample rate
 * @returns {Object[]}  Array of segment objects with startTime, label, flatness, etc.
 */
function buildVibeTimeline(data, sr) {
  const segSamps=Math.floor(SEGMENT_SECONDS*sr);
  const nSegs=Math.ceil(data.length/segSamps);
  const raw=[];
  let prevMags=null;

  for(let s=0;s<nSegs;s++){
    const start=s*segSamps, end=Math.min(start+segSamps,data.length);
    const slice=data.subarray(start,end);
    const energy=rms(slice);
    const mid=Math.max(0,Math.floor((slice.length-FFT_SIZE)/2));
    const mags=magnitudeSpectrum(slice.subarray(mid,mid+FFT_SIZE));
    const flux=spectralFlux(mags,prevMags);
    // NEW: flatness per segment
    const segFlatness=calculateMidRangeSpectralFlatness(mags,sr);
    raw.push({
      startTime:parseFloat((s*SEGMENT_SECONDS).toFixed(2)),
      endTime:parseFloat((end/sr).toFixed(2)),
      energy, energyDb:parseFloat(toDb(energy).toFixed(2)),
      flux,
      midRangeFlatness: segFlatness, // NEW
    });
    prevMags=mags;
  }

  const maxE=Math.max(...raw.map(s=>s.energy),1e-10);
  const maxF=Math.max(...raw.map(s=>s.flux),  1e-10);

  return raw.map((seg,i)=>{
    const ne=seg.energy/maxE, nf=seg.flux/maxF;
    const flatness=seg.midRangeFlatness;

    // NEW: BROADBAND prefix when mid-range is noise-like rather than tonal
    const hasBroadbandMids = flatness > FLATNESS_BROADBAND_THRESHOLD;

    let label="VERSE";
    if      (i===0 && ne<0.35)
      label = hasBroadbandMids ? "BROADBAND INTRO"  : "INTRO";
    else if (i===raw.length-1 && ne<0.45)
      label = hasBroadbandMids ? "BROADBAND OUTRO"  : "OUTRO";
    else if (ne>0.75 && nf>0.55)
      label = hasBroadbandMids ? "BROADBAND DROP"   : "DROP / CHORUS";
    else if (ne>0.40 && nf>0.65 && ne<0.80)
      label = hasBroadbandMids ? "BROADBAND BUILD"  : "BUILD";
    else if (ne<0.25 && nf<0.25)
      label = "BREAKDOWN";
    else if (hasBroadbandMids && ne>0.45)
      label = "BROADBAND SECTION";

    return {
      startTime:        seg.startTime,
      endTime:          seg.endTime,
      energyDb:         seg.energyDb,
      flux:             parseFloat(seg.flux.toFixed(5)),
      normalizedEnergy: parseFloat(ne.toFixed(3)),
      normalizedFlux:   parseFloat(nf.toFixed(3)),
      midRangeFlatness: seg.midRangeFlatness, // NEW
      label,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  INPUT VALIDATION
// ─────────────────────────────────────────────────────────────

/**
 * Validate decoded audio before DSP. Throws with user-facing message.
 * @param {Object}      payload
 * @param {Float32Array} left
 * @param {Float32Array} right
 */
function validatePayload(payload, left, right) {
  const { sampleRate } = payload;
  if (!sampleRate || sampleRate < SR_MIN || sampleRate > SR_MAX) {
    throw new Error(
      `Sample rate ${sampleRate} Hz is outside supported range (${SR_MIN}–${SR_MAX} Hz). ` +
      `Re-export at 44.1kHz or 48kHz.`
    );
  }
  const total = Math.min(left.length, right.length);
  if (total < FFT_SIZE) {
    const ms = (total / sampleRate * 1000).toFixed(0);
    throw new Error(
      `Audio too short (${ms} ms, ${total} samples). ` +
      `Minimum: ${FFT_SIZE} samples. Load a complete track.`
    );
  }
  // Duration check: prevent memory exhaustion (20 min free tier limit)
  const durationSec = total / sampleRate;
  if (durationSec > 1200) {
    throw new Error(
      "File too long for Free Tier (20min limit). Upgrade to Pro for unlimited analysis."
    );
  }
}

// ─────────────────────────────────────────────────────────────
//  MAIN ANALYSIS PIPELINE
// ─────────────────────────────────────────────────────────────

/**
 * Full analysis pipeline for one track.
 * Validates → decodes stereo → M/S encode → stereo width → decimate
 * → averaged spectrum → mix health (incl. LUFS + flatness) → vibe timeline.
 *
 * @param {Object} payload   ANALYZE_TRACK payload
 * @param {string} trackType "user" | "reference"
 * @returns {Object}  { avgSpectrum, decimRate, integratedLufs, mixHealth, vibeTimeline }
 */
async function analyzeTrack(payload, trackType) {
  const { left, right } = decodeStereoPayload(payload);
  validatePayload(payload, left, right);
  const { mid } = encodeMidSide(left, right);

  self.postMessage({ type:"PROGRESS", trackType, percent:5 });

  let stereoWidth;
  try { stereoWidth = stereoCorrelation(left, right); }
  catch(e) { stereoWidth = 1.0; }

  self.postMessage({ type:"PROGRESS", trackType, percent:10 });

  const { data: decimMid, rate: decimRate } = decimate(mid, payload.sampleRate);

  self.postMessage({ type:"PROGRESS", trackType, percent:20 });

  const avgSpectrum = averageSpectrum(decimMid, decimRate);

  self.postMessage({ type:"PROGRESS", trackType, percent:50 });

  const mixHealth = analyzeMixHealth(mid, decimMid, avgSpectrum, payload.sampleRate, decimRate, stereoWidth);

  self.postMessage({ type:"PROGRESS", trackType, percent:70 });

  const vibeTimeline = buildVibeTimeline(decimMid, decimRate);

  self.postMessage({ type:"PROGRESS", trackType, percent:90 });

  return { avgSpectrum: Array.from(avgSpectrum), decimRate, integratedLufs: mixHealth.integratedLufs, mixHealth, vibeTimeline };
}

// ─────────────────────────────────────────────────────────────
//  WORKER STATE & MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────

const store = { user: null, reference: null };

self.onmessage = async ({ data }) => {
  const { type, payload } = data;

  switch (type) {

    case "INIT":
      self.postMessage({ type:"MODEL_READY" });
      break;

    /**
     * ANALYZE_TRACK
     * Payload: { leftBuffer, rightBuffer, sampleRate, trackType, targetProfile? }
     * All ArrayBuffers are zero-copy Transferables.
     * If targetProfile is provided and no reference track exists yet,
     * emits DELTA_READY immediately after analysis using the profile.
     */
    case "ANALYZE_TRACK": {
      const { trackType, targetProfile } = payload;
      try {
        const result = await analyzeTrack(payload, trackType);

        store[trackType] = {
          spectrum:       new Float32Array(result.avgSpectrum),
          decimRate:      result.decimRate,
          integratedLufs: result.integratedLufs,
        };

        self.postMessage({ type:"TRACK_ANALYZED", trackType,
          payload: { mixHealth: result.mixHealth, vibeTimeline: result.vibeTimeline } });

        self.postMessage({ type:"PROGRESS", trackType, percent:100 });

        // Delta: prefer reference track over profile; fall back to profile
        if (store.user) {
          const sr = store.user.decimRate;
          if (store.reference) {
            const delta = computeDelta(
              store.user.spectrum, store.reference.spectrum, sr,
              store.user.integratedLufs, store.reference.integratedLufs,
              null
            );
            self.postMessage({ type:"DELTA_READY", payload:{ delta } });
          } else if (targetProfile) {
            const delta = computeDelta(
              store.user.spectrum, null, sr,
              store.user.integratedLufs, null,
              targetProfile
            );
            self.postMessage({ type:"DELTA_READY", payload:{ delta } });
          }
        }

        result.avgSpectrum = null;
        result.vibeTimeline = null;
        result.mixHealth = null;

      } catch (err) {
        self.postMessage({ type:"ERROR", trackType,
          error: err.message ?? "Unknown analysis error",
          errorCode: err.code ?? "ANALYSIS_ERROR" });
      }
      break;
    }

    /**
     * COMPUTE_DELTA_ONLY — re-run delta without re-uploading audio.
     * Used by profile switcher: user picks a different genre profile,
     * UI posts this message, worker recomputes delta instantly from cached spectra.
     * Payload: { targetProfile: TargetProfile | null }
     *   null = switch back to reference track comparison (if reference exists)
     */
    case "COMPUTE_DELTA_ONLY": {
      if (!store.user) {
        self.postMessage({ type:"ERROR", error:"No user track analyzed yet. Load a mix first." });
        break;
      }
      try {
        const { targetProfile } = payload;
        const sr = store.user.decimRate;
        const delta = computeDelta(
          store.user.spectrum,
          store.reference?.spectrum ?? null,
          sr,
          store.user.integratedLufs,
          store.reference?.integratedLufs ?? null,
          targetProfile ?? null
        );
        self.postMessage({ type:"DELTA_READY", payload:{ delta } });
      } catch (err) {
        self.postMessage({ type:"ERROR", error: err.message });
      }
      break;
    }

    case "RESET":
      store.user = null; store.reference = null;
      self.postMessage({ type:"RESET_OK" });
      break;

    default:
      self.postMessage({ type:"UNKNOWN_MESSAGE", received: type });
  }
};
