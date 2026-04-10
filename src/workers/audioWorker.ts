/**
 * @file src/workers/audioWorker.ts — Sonic Pro DSP Engine v5
 *
 * Production-grade Web Worker. Zero external dependencies — pure math.
 *
 * References:
 *   ITU-R BS.1770-4  https://www.itu.int/rec/R-REC-BS.1770/en
 *   EBU Tech 3341    https://tech.ebu.ch/docs/tech/tech3341.pdf
 *   Audio EQ Cookbook https://www.musicdsp.org/
 *
 * Worker message protocol:
 *   IN:  INIT                → OUT: ENGINE_READY
 *   IN:  ANALYZE_TRACK       → OUT: PROGRESS, TRACK_ANALYZED, DELTA_READY, ERROR
 *   IN:  COMPUTE_DELTA_ONLY  → OUT: DELTA_READY, ERROR
 *   IN:  RESET               → OUT: RESET_OK
 */

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────

const FFT_SIZE         = 8192;   // 2.69 Hz/bin at 22050 Hz — 16 sub-bass bins
const HOP_SIZE         = FFT_SIZE / 2;
const DECIMATED_SR     = 22050;
const SEGMENT_SECONDS  = 10;
const DB_FLOOR         = -120;
const SR_MIN           = 8000;
const SR_MAX           = 384000;
const MAX_DURATION_S   = 1200;   // 20-minute Free tier limit
const FLATNESS_THRESH  = 0.65;

/** 7-band spectral analysis (matches UI targets gallery) */
const SPECTRAL_BANDS = {
  sub:        { lo: 20,   hi: 60   },
  bass:       { lo: 60,   hi: 250  },
  lowMid:     { lo: 250,  hi: 500  },
  mid:        { lo: 500,  hi: 2000 },
  highMid:    { lo: 2000, hi: 4000 },
  presence:   { lo: 4000, hi: 6000 },
  brilliance: { lo: 6000, hi: 11025 }, // capped at Nyquist after decimation
} as const;

type BandKey = keyof typeof SPECTRAL_BANDS;

// ─────────────────────────────────────────────────────────────
//  TYPES (exported via postMessage shape — not TS exports)
// ─────────────────────────────────────────────────────────────

export interface SpectralBands {
  sub: number; bass: number; lowMid: number; mid: number;
  highMid: number; presence: number; brilliance: number;
}

export interface MixWarning {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export interface MixHealth {
  peakDb: number;
  crestFactor: number;
  centroid: number;
  rolloff: number;
  integratedLufs: number;
  stereoWidth: number;
  clippingPercent: number;
  midRangeSpectralFlatness: number;
  spectralBands: SpectralBands;
  warnings: MixWarning[];
}

export interface VibeSegment {
  startTime: number;
  endTime: number;
  energyDb: number;
  normalizedEnergy: number;
  normalizedFlux: number;
  midRangeFlatness: number;
  label: string;
}

export interface DeltaBands {
  sub: number; bass: number; lowMid: number; mid: number;
  highMid: number; presence: number; brilliance: number;
}

export interface DeltaResult {
  bands: Record<string, { label: string; userDb: number; refDb: number; delta: number; verdict: string }>;
  gainOffset: number;
  userLufs: number;
  referenceLufs: number | null;
  profileId: string | null;
  profileMode: boolean;
  score: number;
  suggestions: string[];
}

// ─────────────────────────────────────────────────────────────
//  BIQUAD FILTER DESIGN (Audio EQ Cookbook)
// ─────────────────────────────────────────────────────────────

interface BiquadCoeffs { b: number[]; a: number[] }

function designBiquad(fc: number, fs: number, type: 'lowpass' | 'highpass'): BiquadCoeffs {
  const Q = Math.SQRT1_2, K = Math.tan(Math.PI * fc / fs), K2 = K * K;
  const n = 1 / (1 + K / Q + K2);
  if (type === 'lowpass') return { b: [K2*n, 2*K2*n, K2*n], a: [2*(K2-1)*n, (1-K/Q+K2)*n] };
  return { b: [n, -2*n, n], a: [2*(K2-1)*n, (1-K/Q+K2)*n] };
}

function designHighShelf(f0: number, dBgain: number, fs: number): BiquadCoeffs {
  const A = Math.pow(10, dBgain/40), w0 = 2*Math.PI*f0/fs;
  const cosw = Math.cos(w0), sinw = Math.sin(w0), alpha = sinw/Math.SQRT2, sqA = Math.sqrt(A);
  const a0 = (A+1)-(A-1)*cosw+2*sqA*alpha;
  return {
    b: [A*((A+1)+(A-1)*cosw+2*sqA*alpha)/a0, -2*A*((A-1)+(A+1)*cosw)/a0, A*((A+1)+(A-1)*cosw-2*sqA*alpha)/a0],
    a: [2*((A-1)-(A+1)*cosw)/a0, ((A+1)-(A-1)*cosw-2*sqA*alpha)/a0],
  };
}

function applyBiquad(c: BiquadCoeffs, input: Float32Array | Float64Array): Float64Array {
  const out = new Float64Array(input.length);
  let w1 = 0, w2 = 0;
  for (let n = 0; n < input.length; n++) {
    const x = input[n], y = c.b[0]*x + w1;
    w1 = c.b[1]*x - c.a[0]*y + w2;
    w2 = c.b[2]*x - c.a[1]*y;
    out[n] = y;
  }
  return out;
}

function filtfilt(coeff: BiquadCoeffs, input: Float32Array): Float64Array {
  const fwd = applyBiquad(coeff, input);
  const rev = fwd.slice().reverse();
  const bwd = applyBiquad(coeff, rev as unknown as Float64Array);
  return bwd.reverse() as unknown as Float64Array;
}

// ─────────────────────────────────────────────────────────────
//  DECIMATION (Butterworth LP anti-alias + downsample)
// ─────────────────────────────────────────────────────────────

function decimate(signal: Float32Array, srcRate: number): { data: Float32Array; rate: number } {
  if (srcRate <= DECIMATED_SR) return { data: signal, rate: srcRate };
  const lp = designBiquad(10000, srcRate, 'lowpass');
  const filtered = filtfilt(lp, signal);
  const ratio = srcRate / DECIMATED_SR;
  const newLen = Math.floor(signal.length / ratio);
  const output = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) output[i] = filtered[Math.floor(i * ratio)];
  return { data: output, rate: DECIMATED_SR };
}

// ─────────────────────────────────────────────────────────────
//  MID/SIDE + STEREO CORRELATION
// ─────────────────────────────────────────────────────────────

function encodeMidSide(left: Float32Array, right: Float32Array): { mid: Float32Array; side: Float32Array } {
  const len = Math.min(left.length, right.length);
  const mid = new Float32Array(len), side = new Float32Array(len);
  const k = 1 / Math.SQRT2;
  for (let i = 0; i < len; i++) {
    mid[i]  = (left[i] + right[i]) * k;
    side[i] = (left[i] - right[i]) * k;
  }
  return { mid, side };
}

function stereoCorrelation(left: Float32Array, right: Float32Array): number {
  const WIN = 4096, eps = 1e-12;
  const len = Math.min(left.length, right.length);
  let sumR = 0, count = 0, silent = 0;
  for (let s = 0; s + WIN <= len; s += WIN) {
    let sL=0, sR=0, sLL=0, sRR=0, sLR=0;
    for (let i=0; i<WIN; i++) {
      const l=left[s+i], r=right[s+i];
      sL+=l; sR+=r; sLL+=l*l; sRR+=r*r; sLR+=l*r;
    }
    const mL=sL/WIN, mR=sR/WIN;
    const varL=sLL/WIN-mL*mL, varR=sRR/WIN-mR*mR, cov=sLR/WIN-mL*mR;
    const den=Math.sqrt(varL*varR);
    if (den > eps) { sumR += cov/den; count++; }
    else if (varL < eps && varR < eps) silent++;
  }
  return count > 0 ? sumR/count : (silent > 0 ? 1.0 : 0.0);
}

// ─────────────────────────────────────────────────────────────
//  EBU R128 INTEGRATED LUFS  (ITU-R BS.1770-4)
// ─────────────────────────────────────────────────────────────

function applyKWeighting(signal: Float32Array | Float64Array, fs: number): Float64Array {
  const shelf = designHighShelf(1681.974, 3.99984385397, fs);
  const s1 = applyBiquad(shelf, signal as Float32Array);
  const K = Math.tan(Math.PI*38.135085/fs), K2=K*K, Q2=0.5003270373;
  const n2 = 1/(1+K/Q2+K2);
  const hp: BiquadCoeffs = { b:[n2,-2*n2,n2], a:[2*(K2-1)*n2,(1-K/Q2+K2)*n2] };
  return applyBiquad(hp, s1 as unknown as Float32Array);
}

function computeIntegratedLufs(signal: Float32Array, fs: number): number {
  const kw = applyKWeighting(signal, fs);
  const blockSamps = Math.round(0.4*fs), hopSamps = Math.round(0.1*fs);
  const powers: number[] = [];
  for (let s=0; s+blockSamps<=kw.length; s+=hopSamps) {
    let sq=0;
    for (let i=0; i<blockSamps; i++) { const v=kw[s+i]; sq+=v*v; }
    powers.push(sq/blockSamps);
  }
  if (!powers.length) return DB_FLOOR;
  const absThresh = Math.pow(10, (-70+0.691)/10);
  const ag = powers.filter(p => p>absThresh);
  if (!ag.length) return DB_FLOOR;
  const meanAbs = ag.reduce((a,b)=>a+b,0)/ag.length;
  const rg = ag.filter(p => p>meanAbs/10);
  if (!rg.length) return DB_FLOOR;
  const fin = rg.reduce((a,b)=>a+b,0)/rg.length;
  return parseFloat((-0.691+10*Math.log10(fin)).toFixed(2));
}

// ─────────────────────────────────────────────────────────────
//  FFT — Cooley-Tukey radix-2 DIT (no external libs)
// ─────────────────────────────────────────────────────────────

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const N = re.length;
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t=re[i]; re[i]=re[j]; re[j]=t;
      t=im[i]; im[i]=im[j]; im[j]=t;
    }
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
        re[i+k]=uRe+vRe; im[i+k]=uIm+vIm;
        re[i+k+half]=uRe-vRe; im[i+k+half]=uIm-vIm;
        const nw=wRe*wbRe-wIm*wbIm; wIm=wRe*wbIm+wIm*wbRe; wRe=nw;
      }
    }
  }
}

function magnitudeSpectrum(samples: Float32Array): Float32Array {
  const N=FFT_SIZE, re=new Float64Array(N), im=new Float64Array(N);
  const len=Math.min(samples.length,N);
  for (let i=0;i<len;i++) re[i]=samples[i]*0.5*(1-Math.cos(2*Math.PI*i/(N-1)));
  fftInPlace(re,im);
  const half=N/2, mags=new Float32Array(half);
  for (let i=0;i<half;i++) mags[i]=Math.sqrt(re[i]*re[i]+im[i]*im[i])/N;
  return mags;
}

function averageSpectrum(data: Float32Array, sr: number): Float32Array {
  const nF=Math.floor((data.length-FFT_SIZE)/HOP_SIZE)+1;
  if (nF<=0) return magnitudeSpectrum(data);
  const acc=new Float64Array(FFT_SIZE/2);
  for (let f=0;f<nF;f++) {
    const mags=magnitudeSpectrum(data.subarray(f*HOP_SIZE, f*HOP_SIZE+FFT_SIZE));
    for (let i=0;i<acc.length;i++) acc[i]+=mags[i];
  }
  const out=new Float32Array(FFT_SIZE/2);
  for (let i=0;i<acc.length;i++) out[i]=acc[i]/nF;
  return out;
}

// ─────────────────────────────────────────────────────────────
//  SPECTRAL UTILITIES
// ─────────────────────────────────────────────────────────────

function hzToBin(hz: number, sr: number): number { return Math.round(hz*FFT_SIZE/sr); }
function toDb(x: number): number { return x<1e-10 ? DB_FLOOR : 20*Math.log10(x); }

function bandRmsDb(mags: Float32Array, lo: number, hi: number, sr: number): number {
  const loBin=Math.max(1,hzToBin(lo,sr)), hiBin=Math.min(mags.length-1,hzToBin(hi,sr));
  if (loBin>hiBin) return DB_FLOOR;
  let sq=0;
  for (let i=loBin;i<=hiBin;i++) sq+=mags[i]*mags[i];
  return toDb(Math.sqrt(sq/(hiBin-loBin+1)));
}

function spectralCentroid(mags: Float32Array, sr: number): number {
  const bHz=sr/FFT_SIZE; let wS=0,tot=0;
  for (let i=1;i<mags.length;i++){wS+=i*bHz*mags[i];tot+=mags[i];}
  return tot<1e-10?0:wS/tot;
}

function spectralRolloff(mags: Float32Array, sr: number, t=0.85): number {
  const bHz=sr/FFT_SIZE; let tot=0;
  for (let i=0;i<mags.length;i++) tot+=mags[i];
  let cum=0;
  for (let i=0;i<mags.length;i++){cum+=mags[i];if(cum>=tot*t)return i*bHz;}
  return (mags.length-1)*bHz;
}

function spectralFlux(cur: Float32Array, prev: Float32Array | null): number {
  if (!prev) return 0;
  let f=0;
  for (let i=0;i<cur.length;i++){const d=cur[i]-prev[i];if(d>0)f+=d*d;}
  return Math.sqrt(f);
}

/**
 * Mid-Range Spectral Flatness (1–4kHz)
 * geometric_mean / arithmetic_mean → 0=tonal, 1=noise-like
 */
function calcMidRangeFlatness(mags: Float32Array, sr: number): number {
  const loBin=Math.max(1,hzToBin(1000,sr)), hiBin=Math.min(mags.length-1,hzToBin(4000,sr));
  let sum=0, logSum=0, count=0;
  for (let i=loBin;i<=hiBin;i++) {
    const m=mags[i];
    if (m>1e-10) { sum+=m; logSum+=Math.log(m); count++; }
  }
  if (!count) return 0;
  return parseFloat(Math.min(1, Math.exp(logSum/count)/(sum/count)).toFixed(3));
}

function computeSpectralBands(mags: Float32Array, sr: number): SpectralBands {
  return {
    sub:        parseFloat(bandRmsDb(mags, SPECTRAL_BANDS.sub.lo,        SPECTRAL_BANDS.sub.hi,        sr).toFixed(2)),
    bass:       parseFloat(bandRmsDb(mags, SPECTRAL_BANDS.bass.lo,       SPECTRAL_BANDS.bass.hi,       sr).toFixed(2)),
    lowMid:     parseFloat(bandRmsDb(mags, SPECTRAL_BANDS.lowMid.lo,     SPECTRAL_BANDS.lowMid.hi,     sr).toFixed(2)),
    mid:        parseFloat(bandRmsDb(mags, SPECTRAL_BANDS.mid.lo,        SPECTRAL_BANDS.mid.hi,        sr).toFixed(2)),
    highMid:    parseFloat(bandRmsDb(mags, SPECTRAL_BANDS.highMid.lo,    SPECTRAL_BANDS.highMid.hi,    sr).toFixed(2)),
    presence:   parseFloat(bandRmsDb(mags, SPECTRAL_BANDS.presence.lo,   SPECTRAL_BANDS.presence.hi,   sr).toFixed(2)),
    brilliance: parseFloat(bandRmsDb(mags, SPECTRAL_BANDS.brilliance.lo, SPECTRAL_BANDS.brilliance.hi, sr).toFixed(2)),
  };
}

// ─────────────────────────────────────────────────────────────
//  MIX HEALTH
// ─────────────────────────────────────────────────────────────

function rms(s: Float32Array): number { let sq=0; for (let i=0;i<s.length;i++) sq+=s[i]*s[i]; return Math.sqrt(sq/s.length); }
function truePeak(s: Float32Array): number { let p=0; for (let i=0;i<s.length;i++){const a=Math.abs(s[i]);if(a>p)p=a;} return p; }

function analyzeMixHealth(
  originalMid: Float32Array,
  decimMid: Float32Array,
  avgSpectrum: Float32Array,
  origRate: number,
  decimRate: number,
  stereoWidth: number
): MixHealth {
  const peakLin=truePeak(originalMid), peakDb=toDb(peakLin);
  let clipped=0;
  for (let i=0;i<originalMid.length;i++) if(Math.abs(originalMid[i])>=0.9998) clipped++;
  const clippingPercent=(clipped/originalMid.length)*100;
  const lufs=computeIntegratedLufs(decimMid,decimRate);
  const rmsLin=rms(decimMid), crestFactor=peakDb-toDb(rmsLin);
  const centroid=spectralCentroid(avgSpectrum,decimRate);
  const rolloff=spectralRolloff(avgSpectrum,decimRate);
  const midRangeSpectralFlatness=calcMidRangeFlatness(avgSpectrum,decimRate);
  const spectralBands=computeSpectralBands(avgSpectrum,decimRate);

  const warnings: MixWarning[] = [];
  if (clippingPercent>0.01) warnings.push({type:'CLIPPING',severity:'critical',message:`Hard clipping on ${clippingPercent.toFixed(3)}% of samples. Fix before mastering.`});
  if (crestFactor<3) warnings.push({type:'OVER_COMPRESSED',severity:'critical',message:`Crest factor ${crestFactor.toFixed(1)} dB — over-compressed, no dynamic punch.`});
  else if (crestFactor<6) warnings.push({type:'OVER_COMPRESSED',severity:'warning',message:`Crest factor ${crestFactor.toFixed(1)} dB — slightly over-compressed.`});
  if (lufs>-9) warnings.push({type:'TOO_LOUD',severity:'warning',message:`Integrated loudness ${lufs} LUFS — above streaming target of -14 LUFS.`});
  else if (lufs<-20) warnings.push({type:'QUIET_MIX',severity:'info',message:`Integrated loudness ${lufs} LUFS — very quiet. Consider gain staging.`});
  if (centroid<1500) warnings.push({type:'MUFFY',severity:'warning',message:`Spectral centroid ${centroid.toFixed(0)} Hz — mix sounds muffled.`});
  else if (centroid>4500) warnings.push({type:'HARSH',severity:'warning',message:`Spectral centroid ${centroid.toFixed(0)} Hz — may sound harsh/fatiguing.`});
  if (stereoWidth<0.3) warnings.push({type:'NARROW_STEREO',severity:'warning',message:`Stereo correlation ${stereoWidth.toFixed(2)} — very narrow image.`});
  else if (stereoWidth>0.95) warnings.push({type:'PHASE_RISK',severity:'info',message:`Stereo correlation ${stereoWidth.toFixed(2)} — possible phase issues.`});

  return {
    peakDb:                  parseFloat(peakDb.toFixed(2)),
    crestFactor:             parseFloat(crestFactor.toFixed(2)),
    centroid:                parseFloat(centroid.toFixed(1)),
    rolloff:                 parseFloat(rolloff.toFixed(1)),
    integratedLufs:          lufs,
    stereoWidth:             parseFloat(stereoWidth.toFixed(3)),
    clippingPercent:         parseFloat(clippingPercent.toFixed(4)),
    midRangeSpectralFlatness,
    spectralBands,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────
//  VIBE TIMELINE
// ─────────────────────────────────────────────────────────────

function buildVibeTimeline(data: Float32Array, sr: number): VibeSegment[] {
  const segSamps=Math.floor(SEGMENT_SECONDS*sr);
  const nSegs=Math.ceil(data.length/segSamps);
  const raw: any[] = [];
  let prevMags: Float32Array | null = null;

  for (let s=0;s<nSegs;s++) {
    const start=s*segSamps, end=Math.min(start+segSamps,data.length);
    const slice=data.subarray(start,end);
    const energy=rms(slice);
    const mid=Math.max(0,Math.floor((slice.length-FFT_SIZE)/2));
    const mags=magnitudeSpectrum(slice.subarray(mid,mid+FFT_SIZE));
    const flux=spectralFlux(mags,prevMags);
    const segFlatness=calcMidRangeFlatness(mags,sr);
    raw.push({
      startTime:parseFloat((s*SEGMENT_SECONDS).toFixed(2)),
      endTime:parseFloat((end/sr).toFixed(2)),
      energy, energyDb:parseFloat(toDb(energy).toFixed(2)),
      flux, midRangeFlatness:segFlatness,
    });
    prevMags=mags;
  }

  const maxE=Math.max(...raw.map(s=>s.energy),1e-10);
  const maxF=Math.max(...raw.map(s=>s.flux),  1e-10);

  return raw.map((seg,i)=>{
    const ne=seg.energy/maxE, nf=seg.flux/maxF;
    const hasBroadbandMids=seg.midRangeFlatness>FLATNESS_THRESH;
    let label='VERSE';
    if      (i===0&&ne<0.35)          label=hasBroadbandMids?'BROADBAND INTRO':'INTRO';
    else if (i===raw.length-1&&ne<0.45)label=hasBroadbandMids?'BROADBAND OUTRO':'OUTRO';
    else if (ne>0.75&&nf>0.55)         label=hasBroadbandMids?'BROADBAND DROP':'DROP / CHORUS';
    else if (ne>0.40&&nf>0.65&&ne<0.80)label=hasBroadbandMids?'BROADBAND BUILD':'BUILD';
    else if (ne<0.25&&nf<0.25)         label='BREAKDOWN';
    else if (hasBroadbandMids&&ne>0.45)label='BROADBAND SECTION';
    return {
      startTime:seg.startTime, endTime:seg.endTime,
      energyDb:seg.energyDb,
      normalizedEnergy:parseFloat(ne.toFixed(3)),
      normalizedFlux:parseFloat(nf.toFixed(3)),
      midRangeFlatness:seg.midRangeFlatness,
      label,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  DELTA ENGINE (dual-mode: reference track OR genre profile)
// ─────────────────────────────────────────────────────────────

/** Stored analysis data for delta computation */
interface StoredTrack {
  spectrum: Float32Array;
  decimRate: number;
  integratedLufs: number;
  spectralBands: SpectralBands;
}

const BAND_LABELS: Record<BandKey, string> = {
  sub: 'Sub Bass (20–60 Hz)', bass: 'Bass (60–250 Hz)', lowMid: 'Low-Mid (250–500 Hz)',
  mid: 'Mid (500–2kHz)', highMid: 'High-Mid (2–4kHz)', presence: 'Presence (4–6kHz)', brilliance: 'Brilliance (6kHz+)',
};

function computeDeltaFromSpectra(
  userSpectrum: Float32Array,
  userLufs: number,
  userBands: SpectralBands,
  sr: number,
  refSpectrum: Float32Array | null,
  refLufs: number | null,
  targetProfile: any | null
): DeltaResult {
  let gainOffset = 0, normRef: Float32Array | null = null, profileMode = false;

  if (refSpectrum && refLufs !== null) {
    gainOffset = userLufs - refLufs;
    const gainLinear = Math.pow(10, gainOffset/20);
    normRef = new Float32Array(refSpectrum.length);
    for (let i=0;i<refSpectrum.length;i++) normRef[i]=refSpectrum[i]*gainLinear;
  } else if (targetProfile) {
    profileMode = true;
  } else {
    throw new Error('computeDelta: provide refSpectrum or targetProfile');
  }

  // Anchor for profile mode = median of non-silent user band levels
  let anchorDb = userBands.sub;
  if (profileMode) {
    const vals = Object.values(userBands).filter((v: number) => v > DB_FLOOR+10).sort((a: number,b: number)=>a-b);
    if (vals.length) anchorDb = vals[Math.floor(vals.length/2)] as number;
  }

  const result: Record<string, any> = {};
  const suggestions: string[] = [];
  let totalError = 0;

  for (const key of Object.keys(SPECTRAL_BANDS) as BandKey[]) {
    const band = SPECTRAL_BANDS[key];
    const userDb = bandRmsDb(userSpectrum, band.lo, band.hi, sr);
    let refDb: number;

    if (profileMode) {
      const relOffset = targetProfile.bandRatios?.[key]?.relative ?? 0;
      refDb = anchorDb + relOffset;
    } else {
      refDb = bandRmsDb(normRef!, band.lo, band.hi, sr);
    }

    const delta = userDb - refDb;
    const abs = Math.abs(delta), dir = delta>=0?'higher':'lower';
    totalError += abs;

    let verdict: string;
    if (abs<0.5)     verdict=`${BAND_LABELS[key]} matches target.`;
    else if (abs<2)  verdict=`${abs.toFixed(1)} dB ${dir} — subtle adjustment suggested.`;
    else if (abs<6)  verdict=`${abs.toFixed(1)} dB ${dir} — noticeable difference.`;
    else             verdict=`${abs.toFixed(1)} dB ${dir} — significant imbalance.`;

    if (delta > 3)  suggestions.push(`Decrease ${BAND_LABELS[key]} by ${abs.toFixed(1)} dB.`);
    if (delta < -3) suggestions.push(`Increase ${BAND_LABELS[key]} by ${abs.toFixed(1)} dB.`);

    result[key] = {
      label: BAND_LABELS[key],
      userDb: parseFloat(userDb.toFixed(2)),
      refDb:  parseFloat(refDb.toFixed(2)),
      delta:  parseFloat(delta.toFixed(2)),
      verdict,
    };
  }

  return {
    bands: result,
    gainOffset: profileMode ? 0 : parseFloat(gainOffset.toFixed(2)),
    userLufs,
    referenceLufs: profileMode ? null : refLufs,
    profileId: targetProfile?.id ?? null,
    profileMode,
    score: Math.max(0, Math.round(100 - totalError * 2)),
    suggestions,
  };
}

// ─────────────────────────────────────────────────────────────
//  FULL ANALYSIS PIPELINE
// ─────────────────────────────────────────────────────────────

async function analyzeTrack(payload: any): Promise<{ mixHealth: MixHealth; vibeTimeline: VibeSegment[]; storedTrack: StoredTrack }> {
  const { leftBuffer, rightBuffer, sampleRate, trackType } = payload;

  // Duration guard (redundant with client-side check)
  const durationS = (leftBuffer.byteLength / 4) / sampleRate;
  if (durationS > MAX_DURATION_S) {
    const mins = (durationS/60).toFixed(1);
    throw new Error(`File too long for Free Tier (${mins} min). Upgrade to Pro for unlimited analysis.`);
  }

  const left  = new Float32Array(leftBuffer);
  const right = new Float32Array(rightBuffer);

  postProgress(trackType, 5);

  const sw = stereoCorrelation(left, right);
  const { mid } = encodeMidSide(left, right);

  postProgress(trackType, 15);

  const { data: decimMid, rate: decimRate } = decimate(mid, sampleRate);

  postProgress(trackType, 30);

  const avgSpectrum = averageSpectrum(decimMid, decimRate);

  postProgress(trackType, 55);

  const mixHealth = analyzeMixHealth(mid, decimMid, avgSpectrum, sampleRate, decimRate, sw);

  postProgress(trackType, 75);

  const vibeTimeline = buildVibeTimeline(decimMid, decimRate);

  postProgress(trackType, 95);

  const storedTrack: StoredTrack = {
    spectrum:       avgSpectrum,
    decimRate,
    integratedLufs: mixHealth.integratedLufs,
    spectralBands:  mixHealth.spectralBands,
  };

  return { mixHealth, vibeTimeline, storedTrack };
}

function postProgress(trackType: string, percent: number) {
  (self as any).postMessage({ type: 'PROGRESS', trackType, percent });
}

// ─────────────────────────────────────────────────────────────
//  WORKER STATE + MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────

const store: { user: StoredTrack | null; reference: StoredTrack | null } = {
  user: null, reference: null,
};

(self as any).onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT':
      (self as any).postMessage({ type: 'ENGINE_READY' });
      break;

    case 'ANALYZE_TRACK': {
      const { trackType, targetProfile } = payload;
      try {
        const { mixHealth, vibeTimeline, storedTrack } = await analyzeTrack(payload);
        store[trackType as 'user' | 'reference'] = storedTrack;

        (self as any).postMessage({
          type: 'TRACK_ANALYZED', trackType,
          payload: { mixHealth, vibeTimeline },
        });
        (self as any).postMessage({ type: 'PROGRESS', trackType, percent: 100 });

        // Emit delta if user track is loaded
        if (store.user) {
          const sr = store.user.decimRate;
          if (store.reference) {
            const delta = computeDeltaFromSpectra(
              store.user.spectrum, store.user.integratedLufs, store.user.spectralBands, sr,
              store.reference.spectrum, store.reference.integratedLufs, null
            );
            (self as any).postMessage({ type: 'DELTA_READY', payload: { delta } });
          } else if (targetProfile) {
            const delta = computeDeltaFromSpectra(
              store.user.spectrum, store.user.integratedLufs, store.user.spectralBands, sr,
              null, null, targetProfile
            );
            (self as any).postMessage({ type: 'DELTA_READY', payload: { delta } });
          }
        }
      } catch (err: any) {
        (self as any).postMessage({ type: 'ERROR', trackType, error: err.message ?? 'Analysis failed' });
      }
      break;
    }

    case 'COMPUTE_DELTA_ONLY': {
      if (!store.user) {
        (self as any).postMessage({ type: 'ERROR', error: 'No user track analyzed yet.' });
        break;
      }
      try {
        const { targetProfile } = payload;
        const sr = store.user.decimRate;
        const delta = computeDeltaFromSpectra(
          store.user.spectrum, store.user.integratedLufs, store.user.spectralBands, sr,
          store.reference?.spectrum ?? null,
          store.reference?.integratedLufs ?? null,
          targetProfile ?? null
        );
        (self as any).postMessage({ type: 'DELTA_READY', payload: { delta } });
      } catch (err: any) {
        (self as any).postMessage({ type: 'ERROR', error: err.message });
      }
      break;
    }

    case 'RESET':
      store.user = null; store.reference = null;
      (self as any).postMessage({ type: 'RESET_OK' });
      break;

    default:
      break;
  }
};
