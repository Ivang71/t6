class BoomEngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'engineSpeed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'engineLevel', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'shot', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'profile', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.rng = 1;
    this.t = 0;
    this.lowState = 0;
    this.band1 = 0; this.band2 = 0;
    this.envEngine = 0;
    this.envShot = 0; this.envTail = 0; this.envCrack = 0; this.envClank = 0;
    this.subPhase = 0;
    this.sampleRateInv = 1 / sampleRate;
  }

  lcg() {
    this.rng = (1664525 * this.rng + 1013904223) >>> 0;
    return this.rng / 0xffffffff;
  }

  noise() { return this.lcg() * 2 - 1; }

  process(inputs, outputs, parameters) {
    const out = outputs[0];
    const ch0 = out[0];
    const N = ch0.length;
    const engineSpeed = parameters.engineSpeed[0];
    const engineLevel = parameters.engineLevel[0];
    const shot = parameters.shot[0];
    const profile = parameters.profile[0];

    for (let i = 0; i < N; i++) {
      // engine: sub + colored noise throb
      const rpm = 20 + engineSpeed * 80;
      this.subPhase += rpm * 2 * Math.PI * this.sampleRateInv;
      if (this.subPhase > Math.PI * 2) this.subPhase -= Math.PI * 2;
      const sub = Math.sin(this.subPhase);
      // brown noise lowpass
      const n = this.noise();
      this.lowState += 0.02 * (n - this.lowState);
      // soft throb
      const throb = this.lowState * (0.4 + 0.6 * engineSpeed);
      const engine = 0.5 * sub + throb;
      this.envEngine += 0.002 * ((engineLevel) - this.envEngine);

      // shot envelope trigger on rising edge of shot param
      if (shot > 0.5 && this.envShot < 0.001) {
        this.envShot = 1.0;      // shock
        this.envTail = 0.8;      // tail
        this.envCrack = 0.9;     // supersonic crack
        this.envClank = 0.7;     // mechanical
      }
      // shot decays
      this.envShot *= 1 - 1/(0.035 * sampleRate);   // very fast
      this.envCrack *= 1 - 1/(0.06 * sampleRate);   // fast
      this.envClank *= 1 - 1/(0.12 * sampleRate);   // medium
      this.envTail *= 1 - 1/(0.8 * sampleRate);     // long

      // shockwave (low boom)
      this.band1 += 0.01 * ((this.lowState) - this.band1);
      const shock = this.band1 * this.envShot;

      // crack (BP ~ 4kHz)
      const crackNoise = this.noise();
      // simple 2-pole bandpass approx
      this.band2 += 0.3 * (crackNoise - this.band2);
      const crack = (crackNoise - this.band2) * this.envCrack;

      // clank (ringing)
      const ring = Math.sin(this.t * 2 * Math.PI * 300) * this.envClank;

      // tail (wide noise lowpassed more for 'inside')
      const tail = this.lowState * this.envTail;
      const tailGain = profile > 0.5 ? 0.7 : 0.4; // outside louder tail

      const y = engine * this.envEngine + shock * 1.2 + crack * 0.4 + ring * 0.2 + tail * tailGain;
      ch0[i] = y * 0.6;
      this.t += this.sampleRateInv;
    }
    return true;
  }
}

registerProcessor('boom-engine', BoomEngineProcessor);


