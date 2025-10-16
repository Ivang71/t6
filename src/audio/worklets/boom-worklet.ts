class BoomEngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'engineSpeed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'engineLevel', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'shot', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'shell', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'reload', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'profile', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }

  rng = 1;
  t = 0;
  lowState = 0;
  band1 = 0; band2 = 0;
  envEngine = 0;
  envShot = 0; envTail = 0; envCrack = 0; envClank = 0; envSubShot = 0;
  envShell = 0; envReload = 0;
  subPhase = 0;
  subShotPhase = 0; subShotFreq = 60;
  gearPhase = 0; ringPhase1 = 0; ringPhase2 = 0;
  envChug = 0; chugTimer = 0; chugNext = 0.1; envDuck = 0;
  envExhaust = 0; exhaustTimer = 0; exLP = 0; engineLP = 0;
  exhaustPeriod = 0.05;
  shellPhase = 0; reloadPhase = 0;
  sampleRateInv = 1 / sampleRate;

  lcg() { this.rng = (1664525 * this.rng + 1013904223) >>> 0; return this.rng / 0xffffffff; }
  noise() { return this.lcg() * 2 - 1; }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const out = outputs[0];
    const ch0 = out[0];
    const N = ch0.length;
    const engineSpeed = parameters.engineSpeed[0];
    const engineLevel = parameters.engineLevel[0];
    const shot = parameters.shot[0];
    const shell = parameters.shell[0];
    const reload = parameters.reload[0];
    const profile = parameters.profile[0];
    for (let i = 0; i < N; i++) {
      const rpm = 20 + engineSpeed * 80;
      this.subPhase += rpm * 2 * Math.PI * this.sampleRateInv;
      if (this.subPhase > Math.PI * 2) this.subPhase -= Math.PI * 2;
      const sub = Math.sin(this.subPhase);
      const n = this.noise();
      this.lowState += 0.02 * (n - this.lowState);
      const throb = this.lowState * (0.4 + 0.6 * engineSpeed);

      // diesel-like exhaust pulses synced to RPM (4-stroke, 6cyl): pulses = rpm*3
      const pulsesPerSec = (20 + engineSpeed * 80) * 3;
      this.exhaustPeriod = 1 / Math.max(1, pulsesPerSec);
      this.exhaustTimer += this.sampleRateInv;
      if (this.exhaustTimer >= this.exhaustPeriod) {
        this.exhaustTimer -= this.exhaustPeriod;
        this.envExhaust = 1.0;
      }
      this.envExhaust *= 1 - 1 / (0.08 * sampleRate);
      const exhaust = this.envExhaust * (0.6 + 0.4 * Math.abs(this.lowState));

      // engine disabled for pure shot boom output
      let engineOut = 0;
      this.envEngine += 0.0006 * (engineLevel - this.envEngine);

      if (shot > 0.5 && this.envShot < 0.001) {
        // one-shot heavy boom: strong shock + sub sweep, minimal tail
        this.envShot = 1.6;
        this.envSubShot = 1.4;
        this.envTail = 0.6;
        this.envCrack = 0.0;
        this.envClank = 0.0;
        this.subShotFreq = 90;
        this.subShotPhase = 0;
        this.envDuck = 1.0;
      }
      if (shell > 0.5 && this.envShell < 0.001) {
        this.envShell = 1.0;
        this.shellPhase = 0;
      }
      if (reload > 0.5 && this.envReload < 0.001) {
        this.envReload = 1.0;
        this.reloadPhase = 0;
      }
      this.envShot *= 1 - 1 / (0.035 * sampleRate);
      this.envCrack *= 1 - 1 / (0.03 * sampleRate);
      this.envClank *= 1 - 1 / (0.03 * sampleRate);
      this.envTail *= 1 - 1 / (0.5 * sampleRate);
      this.envSubShot *= 1 - 1 / (0.4 * sampleRate);
      this.envDuck *= 1 - 1 / (0.6 * sampleRate);

      // sub-bass sweep for the boom (80 -> ~30 Hz)
      this.subShotFreq += (30 - this.subShotFreq) * 0.005;
      this.subShotPhase += (this.subShotFreq * 2 * Math.PI) * this.sampleRateInv;
      if (this.subShotPhase > Math.PI * 2) this.subShotPhase -= Math.PI * 2;
      const subBoom = Math.sin(this.subShotPhase) * this.envSubShot;

      // crack (very short, bright BP noise)
      const crackNoise = this.noise();
      this.band2 += 0.25 * (crackNoise - this.band2);
      const crack = (crackNoise - this.band2) * (this.envShot > 0 ? 0.8 : 0) * 0.9;

      this.band1 += 0.01 * (this.lowState - this.band1);
      const shock = this.band1 * this.envShot;

      // shell ejection: metallic high ring ~1.6kHz
      this.shellPhase += 1600 * 2 * Math.PI * this.sampleRateInv;
      if (this.shellPhase > Math.PI * 2) this.shellPhase -= Math.PI * 2;
      const shellTone = Math.sin(this.shellPhase) * this.envShell;
      this.envShell *= 1 - 1 / (0.15 * sampleRate);

      // reload clunk: low-mid thump + ring ~220Hz
      this.reloadPhase += 220 * 2 * Math.PI * this.sampleRateInv;
      if (this.reloadPhase > Math.PI * 2) this.reloadPhase -= Math.PI * 2;
      const reloadTone = Math.sin(this.reloadPhase) * this.envReload;
      const reloadNoise = this.lowState * this.envReload;
      this.envReload *= 1 - 1 / (0.25 * sampleRate);
      // (duplicates removed)
      const tail = this.lowState * this.envTail;
      const tailGain = profile > 0.5 ? 0.8 : 0.5;
      const engineDucked = (engineOut * this.envEngine) * (1 - 0.75 * this.envDuck);
      let y = (engineDucked * 0.0) + (crack * 0.9) + (shock * 4.2) + (subBoom * 4.2) + (shellTone * 0.35) + ((reloadTone + reloadNoise) * 0.6) + (tail * tailGain * 0.7);
      const drive = 1.5; // soft clipper to tame extremes
      y = Math.tanh(y * drive) / drive;
      ch0[i] = y;
      this.t += this.sampleRateInv;
    }
    return true;
  }
}

// @ts-ignore
registerProcessor('boom-engine', BoomEngineProcessor);


