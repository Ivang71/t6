// minimal Web Audio + AudioWorklet engine; preserves audioEngine API
(function(){
  let started=false;
  let ctx; let workletNode; let profile=1; // 1 outside, 0 inside

  async function ensureWorklet() {
    if (ctx && workletNode) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const src = `class BoomEngineProcessor extends AudioWorkletProcessor{static get parameterDescriptors(){return[{name:'engineSpeed',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},{name:'engineLevel',defaultValue:0.2,minValue:0,maxValue:1,automationRate:'k-rate'},{name:'shot',defaultValue:0,minValue:0,maxValue:1,automationRate:'k-rate'},{name:'profile',defaultValue:1,minValue:0,maxValue:1,automationRate:'k-rate'}]}constructor(){super();this.rng=1;this.t=0;this.lowState=0;this.band1=0;this.band2=0;this.envEngine=0;this.envShot=0;this.envTail=0;this.envCrack=0;this.envClank=0;this.subPhase=0;this.sampleRateInv=1/sampleRate;}lcg(){this.rng=1664525*this.rng+1013904223>>>0;return this.rng/0xffffffff}noise(){return 2*this.lcg()-1}process(e,t,a){const r=t[0],n=r[0],s=n.length,i=a.engineSpeed[0],o=a.engineLevel[0],l=a.shot[0],p=a.profile[0];for(let e=0;e<s;e++){const t=20+80*i;this.subPhase+=t*2*Math.PI*this.sampleRateInv,this.subPhase>2*Math.PI&&(this.subPhase-=2*Math.PI);const a=Math.sin(this.subPhase),r=this.noise();this.lowState+=.02*(r-this.lowState);const c=this.lowState*(.4+.6*i),u=.5*a+c;this.envEngine+=.002*(o-this.envEngine),l>.5&&this.envShot<.001&&(this.envShot=1,this.envTail=.8,this.envCrack=.9,this.envClank=.7),this.envShot*=1-1/(.035*sampleRate),this.envCrack*=1-1/(.06*sampleRate),this.envClank*=1-1/(.12*sampleRate),this.envTail*=1-1/(.8*sampleRate),this.band1+=.01*(this.lowState-this.band1);const f=this.band1*this.envShot,h=this.noise();this.band2+=.3*(h-this.band2);const d=(h-this.band2)*this.envCrack,g=Math.sin(this.t*2*Math.PI*300)*this.envClank,m=this.lowState*this.envTail,y=p>.5?.7:.4;n[e]=.6*(u*this.envEngine+1.2*f+.4*d+.2*g+m*y),this.t+=this.sampleRateInv}return!0}}registerProcessor('boom-engine',BoomEngineProcessor);`;
    const blob = new Blob([src], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    workletNode = new AudioWorkletNode(ctx, 'boom-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    workletNode.connect(ctx.destination);
    workletNode.parameters.get('engineSpeed').setValueAtTime(0, ctx.currentTime);
    workletNode.parameters.get('engineLevel').setValueAtTime(0.2, ctx.currentTime);
    workletNode.parameters.get('profile').setValueAtTime(profile, ctx.currentTime);
  }

  function start(){
    if (started) return;
    ensureWorklet().then(()=>ctx.resume()).then(()=>{ started=true; });
  }

  function update(deltaMs, speedRatio, isAccelerating){
    if (!workletNode || !ctx) return;
    const s = Math.max(0, Math.min(1, speedRatio || 0));
    const level = isAccelerating ? 0.7 : (s>0.6?0.6:(s>0.08?0.5:(s>0.01?0.35:0.2)));
    workletNode.parameters.get('engineSpeed').setValueAtTime(s, ctx.currentTime);
    workletNode.parameters.get('engineLevel').setValueAtTime(level, ctx.currentTime);
  }

  function shoot(){
    if (!workletNode || !ctx) return;
    const p = workletNode.parameters.get('shot');
    p.setValueAtTime(1, ctx.currentTime);
    p.setValueAtTime(0, ctx.currentTime + 0.01);
  }

  function setShotProfile(mode){ profile = mode==='inside' ? 0 : 1; if (workletNode && ctx) workletNode.parameters.get('profile').setValueAtTime(profile, ctx.currentTime); }

  window.audioEngine={ start, update, shoot, setShotProfile };
})();


