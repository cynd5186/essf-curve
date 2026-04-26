import { useState, useCallback, useRef, useEffect } from "react";

var avg = function(a) { return a.length ? a.reduce(function(s,v){return s+v;},0)/a.length : 0; };
var sdc = function(a) { if (a.length<2) return 0; var m=avg(a); return Math.sqrt(a.reduce(function(s,v){return s+(v-m)*(v-m);},0)/(a.length-1)); };
var cvc = function(a) { var m=avg(a); return m ? sdc(a)/Math.abs(m) : Infinity; };
var med = function(a) { var s=a.slice().sort(function(x,y){return x-y;}); var m=Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
var APP_NAME = "eSSF Curve";
var APP_VERSION = "v5ar";
var APP_TAGLINE = "Curve analysis, fitting & quantitation";
var APP_SUBTITLE = "Plate-based assay analysis & quantitation";
var APP_SUPPORT = "Designed for plate-based assay workflows";
var BRAND_IMAGE = "./assets/essf-curve-brand-board.png";
var BRAND_LOGO = "./assets/essf-curve-logo-clean.png";
var NAVY = "#0b2a6f";
var TEAL = "#139cb6";
var TEAL_DARK = "#0f8aa2";
var LINE = "#cfd9ea";
var SURFACE = "#ffffff";
var SURFACE_TINT = "#f7fbff";
var BORDER = "#dfe7f2";
var SHADOW = "0 12px 30px rgba(11,42,111,0.06)";
function glow(gc){return "0 10px 24px rgba(11,42,111,0.08), inset 0 1px 0 rgba(255,255,255,0.55)";}
var sig3 = function(v) {
  if (v==null||isNaN(v)) return "---";
  if (v===0) return "0.00";
  var abs = Math.abs(v);
  if (abs >= 0.001 && abs < 1000000) {
    var magnitude = Math.floor(Math.log10(abs));
    var decimals = Math.max(0, 2 - magnitude);
    if (magnitude >= 3) {
      // For large numbers, round to 3 sig figs by zeroing trailing digits
      var factor = Math.pow(10, magnitude - 2);
      return String(Math.round(v / factor) * factor);
    }
    return Number(v).toFixed(decimals);
  }
  return Number(v).toPrecision(3);
};
var fm4 = function(v) { if (v==null||isNaN(v)) return "---"; return Number(v).toFixed(4); };
var fpct = function(v) { if (v==null||isNaN(v)||!isFinite(v)) return "---"; return (v*100).toFixed(1)+"%"; };
var LE = "ABCDEFGH";
var pDil = function(s) { if (!s) return NaN; var t=s.trim(); if (t.indexOf("/")>=0) { var p=t.split("/"); return p[1]*1 ? p[0]*1/(p[1]*1) : NaN; } return parseFloat(t); };
// Format a dilution factor (the "N" in "1:N" or "N×") for compact display.
// Numbers up to `sciThreshold` show as integers when clean, otherwise 3 sig figs.
// Numbers ≥ sciThreshold switch to compact scientific notation like "1e+4" or "5e+5".
var fmtDilNum = function(n, sciThreshold) {
  if (!isFinite(n) || n <= 0) return "?";
  if (sciThreshold == null) sciThreshold = 10000;
  if (n < sciThreshold) {
    if (Math.abs(n - Math.round(n)) < 0.001) return String(Math.round(n));
    return String(Number(n.toPrecision(3)));
  }
  // Compact sci notation: drop trailing zeros in mantissa, prefer "1e+5" over "1.00e+5"
  var exp = Math.floor(Math.log10(n));
  var mant = n / Math.pow(10, exp);
  var mantStr = Math.abs(mant - Math.round(mant)) < 0.01 ? String(Math.round(mant)) : String(Number(mant.toPrecision(2)));
  return mantStr + "e+" + exp;
};
// Format a single dilution as "1:N" (ratio) or "N×" (factor) form.
// `sciThreshold` controls when sci notation kicks in (smaller for tight UI like well circles).
var fmtDilution = function(df, format, sciThreshold) {
  if (!isFinite(df) || df <= 0) return "?";
  var ratio = 1 / df;
  if (Math.abs(ratio - 1) < 0.001) return format === "factor" ? "1×" : "neat";
  var numStr = fmtDilNum(ratio, sciThreshold);
  return format === "factor" ? (numStr + "×") : ("1:" + numStr);
};
// Build a formatted preview of the dilution series.
// xf1: first-dilution fraction (e.g. 0.1 for 1/10). xs: subsequent ratio (e.g. 0.5 for 1/2). n: number of rows.
// format: "ratio" (default, "1:N") or "factor" ("N×"). sciThreshold: when to switch to sci notation.
var buildDilutionPreview = function(xf1, xs, n, format, sciThreshold) {
  if (!isFinite(xf1) || !isFinite(xs) || xf1 <= 0 || xs <= 0 || n <= 0) return null;
  if (!format) format = "ratio";
  var out = [];
  for (var d = 0; d < n; d++) {
    var df = xf1 * Math.pow(xs, d);
    if (!isFinite(df) || df <= 0) return null;
    out.push(fmtDilution(df, format, sciThreshold));
  }
  return out;
};
function linReg(x,y) { var n=x.length; if(n<2) return {slope:0,intercept:0,r2:0}; var sx=0,sy=0,sxx=0,sxy=0,syy=0; for(var i=0;i<n;i++){sx+=x[i];sy+=y[i];sxx+=x[i]*x[i];sxy+=x[i]*y[i];syy+=y[i]*y[i];} var d=n*sxx-sx*sx; if(Math.abs(d)<1e-15) return {slope:0,intercept:0,r2:0}; var sl=(n*sxy-sx*sy)/d, ic=(sy-sl*sx)/n, tot=syy-sy*sy/n, rs=syy-ic*sy-sl*sxy; return {slope:sl,intercept:ic,r2:tot?1-rs/tot:0}; }
var EP = function() { return Array.from({length:8}, function(){return Array(12).fill("");}); };
// Wilcoxon signed-rank test for paired samples. Returns {W, p, n} or null if N<3.
// Uses normal approximation for larger N (N>=10), exact p unavailable.
function wilcoxonSignedRank(diffs) {
  var nz = diffs.filter(function(d){return Math.abs(d)>1e-12;});
  if(nz.length<3) return {W:null, p:null, n:nz.length, interp:"too few pairs"};
  var absd = nz.map(function(d){return {d:d, a:Math.abs(d)};});
  absd.sort(function(a,b){return a.a-b.a;});
  // Average ranks for ties
  var ranks = new Array(absd.length);
  var i=0;
  while(i<absd.length){
    var j=i;
    while(j<absd.length-1 && absd[j+1].a===absd[i].a) j++;
    var avgRank = (i+1+j+1)/2; // ranks are 1-based
    for(var k=i;k<=j;k++) ranks[k]=avgRank;
    i=j+1;
  }
  var Wp=0, Wn=0;
  for(var k=0;k<absd.length;k++){
    if(absd[k].d>0) Wp+=ranks[k];
    else Wn+=ranks[k];
  }
  var n=nz.length;
  var W=Math.min(Wp, Wn);
  // Normal approximation
  var mu=n*(n+1)/4;
  var sigma=Math.sqrt(n*(n+1)*(2*n+1)/24);
  if(sigma===0) return {W:W, p:1, n:n, interp:"all zero"};
  var z=(W-mu)/sigma;
  // two-tailed p via normal approx
  var p=2*(1-normCdf(Math.abs(z)));
  return {W:W, p:p, n:n, z:z};
}

// Standard normal CDF (Abramowitz-Stegun 26.2.17)
function normCdf(x) {
  var b1=0.319381530, b2=-0.356563782, b3=1.781477937, b4=-1.821255978, b5=1.330274429;
  var t=1/(1+0.2316419*Math.abs(x));
  var pdf=Math.exp(-x*x/2)/Math.sqrt(2*Math.PI);
  var cdf=1-pdf*(b1*t+b2*t*t+b3*Math.pow(t,3)+b4*Math.pow(t,4)+b5*Math.pow(t,5));
  return x<0 ? 1-cdf : cdf;
}



// Group color palette. GC[0] = standard (teal — design system color for the standard curve).
// GC[1..N] = samples cycled through; warm-leaning hues so they read as "sample" in family
// while still being visually distinct from each other.
var GC = [
  {bg:"#dbf0f4",hd:"#a8d8e2",tx:"#0f5c6a",cell:"#ecf7fa"},  // 0: teal (standard)
  {bg:"#fff0e6",hd:"#f0c8a0",tx:"#8a4000",cell:"#fdf5ee"},  // 1: amber/orange (sample 1)
  {bg:"#e6e6f5",hd:"#b8b8e0",tx:"#3a2e7a",cell:"#f0f0fa"},  // 2: lavender
  {bg:"#fde6ef",hd:"#f0a8c4",tx:"#9a1f5a",cell:"#fcf0f5"},  // 3: pink/rose
  {bg:"#e6f5e6",hd:"#a8d4a8",tx:"#1a5a2a",cell:"#f0faf0"},  // 4: sage green
  {bg:"#fff5d6",hd:"#e8d088",tx:"#6a4f10",cell:"#fdf9ea"},  // 5: warm yellow
  {bg:"#e6f0ff",hd:"#a0c4f0",tx:"#1a3a8a",cell:"#eef4fd"},  // 6: sky blue
  {bg:"#fde0d8",hd:"#f0a890",tx:"#8a2a10",cell:"#fcefe8"},  // 7: coral
  {bg:"#e8e0fa",hd:"#c0a8e8",tx:"#4a2080",cell:"#f4eefa"},  // 8: violet
  {bg:"#dff5ee",hd:"#9bd4be",tx:"#0f5a4a",cell:"#ecf8f3"},  // 9: mint
  {bg:"#fde8d8",hd:"#f0bc88",tx:"#8a4f10",cell:"#fcf3e8"},  // 10: peach
  {bg:"#f0e6f5",hd:"#cca8d8",tx:"#5a2a6a",cell:"#f6f0f9"},  // 11: mauve
  {bg:"#e6ecf5",hd:"#a8b8d8",tx:"#1a3a6a",cell:"#eff2fa"},  // 12: dusty blue
  {bg:"#f5f0e0",hd:"#d0c090",tx:"#5a4a10",cell:"#faf7ee"},  // 13: warm beige
  {bg:"#fde6e6",hd:"#f0a8a8",tx:"#8a1a1a",cell:"#fcf0f0"},  // 14: warm pink
  {bg:"#dff0f5",hd:"#a8d0e0",tx:"#1a5a7a",cell:"#ecf6fa"},  // 15: pale teal
];

var SM = [
  {id:"literature",short:"ICH M10",name:"Literature-backed (ICH M10)",desc:"Least-diluted qualified (IR + CV<=15%). No averaging. FDA 2018 / ICH M10."},
  {id:"mid_curve",short:"Mid-curve",name:"Mid-curve preference",desc:"IR dilution closest to midpoint of standard curve."},
  {id:"avg_all_ir",short:"Avg IR",name:"Average all in-range",desc:"Mean of all IR concentrations."},
  {id:"weighted_avg",short:"Wt avg",name:"Weighted avg (1/CV)",desc:"Inverse-CV weighted mean."},
  {id:"median_ir",short:"Median",name:"Median of in-range",desc:"Median. Robust to outliers."},
  {id:"lowest_cv",short:"Best CV",name:"Lowest CV only",desc:"Single lowest %CV."},
];

function selAll(dils,midA) {
  var ir=dils.filter(function(d){return d.ir&&d.cv<.20&&d.cS!=null;});var r={};
  SM.forEach(function(m) {
    if(!ir.length){r[m.id]={conc:null,dil:null,cv:null,note:"No qualified",meth:m.short};return;}
    if(m.id==="literature"){var q=ir.filter(function(d){return d.cv<=.15;});if(!q.length){r[m.id]={conc:null,dil:null,cv:null,note:"None CV<=15%",meth:m.short};return;}q.sort(function(a,b){return a.di-b.di;});r[m.id]={conc:q[0].cS,dil:q[0].di,cv:q[0].cv,note:"Least-diluted (#"+q[0].di+")",meth:m.short};}
    else if(m.id==="mid_curve"){var so=ir.slice().sort(function(a,b){return Math.abs(a.avgA-midA)-Math.abs(b.avgA-midA);});r[m.id]={conc:so[0].cS,dil:so[0].di,cv:so[0].cv,note:"Mid-curve",meth:m.short};}
    else if(m.id==="avg_all_ir"){r[m.id]={conc:avg(ir.map(function(d){return d.cS;})),dil:null,cv:null,note:"Avg "+ir.length,meth:m.short};}
    else if(m.id==="weighted_avg"){var wt=ir.map(function(d){return d.cv>0?1/d.cv:100;});var ws=wt.reduce(function(s,w){return s+w;},0);r[m.id]={conc:ir.reduce(function(s,d,i){return s+d.cS*wt[i];},0)/ws,dil:null,cv:null,note:"Weighted",meth:m.short};}
    else if(m.id==="median_ir"){r[m.id]={conc:med(ir.map(function(d){return d.cS;})),dil:null,cv:null,note:"Median",meth:m.short};}
    else if(m.id==="lowest_cv"){var b2=ir.slice().sort(function(a,b){return a.cv-b.cv;})[0];r[m.id]={conc:b2.cS,dil:b2.di,cv:b2.cv,note:"Best CV",meth:m.short};}
  });return r;
}

function cvBg(v){if(v==null||isNaN(v)||!isFinite(v))return"#f0f0f0";var p=v*100;if(p<2)return"#e6f5f0";if(p<5)return"#e8f5ea";if(p<10)return"#e3f0fc";if(p<20)return"#fef3e2";return"#ffeaed";}
function cvTx(v){if(v==null||isNaN(v)||!isFinite(v))return"#999";var p=v*100;if(p<2)return"#0f5c4d";if(p<5)return"#248a3d";if(p<10)return"#0058b0";if(p<20)return"#a05a00";return"#d70015";}
function CVB(props){return <span style={{background:cvBg(props.val),color:cvTx(props.val),padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,display:"inline-block"}}>{fpct(props.val)}</span>;}

function MathWalk(props) {
  var d=props.d,m=props.slope,b=props.intercept,sn=props.sn,target=props.target,unit=props.unit,instructor=props.instructor;
  if(!d) return null;
  // Display-unit conversion: if displayUnit differs from input unit, convert slope and conc outputs.
  // Intercept does NOT change. Optical-response (avgA, blank, raw) does NOT change.
  var dispUnit = props.displayUnit || unit;
  var convFactor = convertConc(1, unit, dispUnit);
  if (convFactor == null || !isFinite(convFactor) || convFactor === 0) convFactor = 1;
  var mDisp = m / convFactor;
  var bDisp = b;
  var cWDisp = d.cW != null ? d.cW * convFactor : null;
  var cSDisp = d.cS != null ? d.cS * convFactor : null;
  var bx={padding:"10px 14px",margin:"8px 0",background:"#f8fafd",borderRadius:10,fontSize:13,lineHeight:1.9,fontFamily:"monospace",borderLeft:"3px solid #0071e3"};
  var lb={fontSize:11,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginTop:14,marginBottom:4};
  return (
    <div style={{padding:"1.25rem",background:"#fafcff",borderRadius:12,border:"1px solid #e0e8f0",marginTop:8}}>
      <div style={{fontSize:15,fontWeight:700,color:"#30437a",marginBottom:14}}>Calculation walkthrough: Dilution #{d.di}</div>
      <div style={lb}>Step 1: Standard curve equation</div>
      <div style={bx}>
        <div>y = mx + b</div>
        <div>y = ({sig3(mDisp)}) x + ({sig3(bDisp)})</div>
        {instructor && <div style={{marginTop:8,paddingTop:8,borderTop:"1px dashed #cfd8e3",color:"#6e6e73",fontSize:12}}>
          <div style={{fontStyle:"italic",marginBottom:2,fontFamily:"system-ui,-apple-system,sans-serif",textTransform:"none",letterSpacing:0}}>What the variables represent here:</div>
          <div>y = optical signal (absorbance / fluorescence read by the plate reader)</div>
          <div>x = concentration of {sn} in the well ({dispUnit})</div>
          <div>m = slope of the standard curve = {sig3(mDisp)}</div>
          <div>b = y-intercept = {sig3(bDisp)}</div>
        </div>}
      </div>
      <div style={lb}>Step 2: Blank correction</div>
      <div style={bx}><div>Raw replicates: {d.raw?d.raw.map(function(v){return v.toFixed(3);}).join(", "):"N/A"}</div><div>Blank: {fm4(d.blank)}</div><div>Corrected = Raw - Blank</div><div>Corrected: {d.cor?d.cor.map(function(v){return v.toFixed(4);}).join(", "):"N/A"}</div></div>
      <div style={lb}>Step 3: Average + CV</div>
      <div style={bx}><div>Avg corrected = {fm4(d.avgA)}</div><div>CV = SD(corrected) / Mean(corrected) = {fpct(d.cv)}</div></div>
      <div style={lb}>Step 4: Solve for [{sn}] in well</div>
      <div style={bx}>
        {instructor && <div style={{marginBottom:10,paddingBottom:10,borderBottom:"1px dashed #cfd8e3",fontFamily:"system-ui,-apple-system,sans-serif",letterSpacing:0,textTransform:"none"}}>
          <div style={{fontSize:11,color:"#6337b9",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>How we rearrange the equation</div>
          <div style={{fontSize:13,color:"#30437a",lineHeight:1.8,fontFamily:"monospace"}}>
            <div>Start with the standard curve:</div>
            <div style={{marginLeft:12,marginTop:2,marginBottom:6}}>y = m x + b</div>
            <div>where y = optical signal, x = [Protein], m = slope, b = intercept.</div>
            <div style={{marginTop:8}}>Subtract b from both sides:</div>
            <div style={{marginLeft:12,marginTop:2,marginBottom:6}}>y &minus; b = m x</div>
            <div>Divide both sides by m:</div>
            <div style={{marginLeft:12,marginTop:2,marginBottom:6}}>(y &minus; b) / m = x</div>
            <div>Which gives us [Protein] in the well:</div>
            <div style={{marginLeft:12,marginTop:2,fontWeight:700,color:"#0b2a6f"}}>[Protein]<sub>well</sub> = (y &minus; b) / m</div>
          </div>
        </div>}
        <div>x = (y - b) / m</div>
        <div>x = ({fm4(d.avgA)} - {sig3(bDisp)}) / {sig3(mDisp)}</div>
        <div><strong>x = [{sn}]_well = {cWDisp!=null?sig3(cWDisp):"---"} {dispUnit}</strong></div>
      </div>
      {d.cS!=null&&(<div><div style={lb}>Step 5: Back-calculate sample concentration</div><div style={bx}><div>[{target}]_sample = [{sn}]_well / dilution factor</div><div>= {sig3(cWDisp)} / {fm4(d.df)}</div><div style={{fontSize:15,marginTop:6}}><strong>= {sig3(cSDisp)} {dispUnit}</strong></div></div></div>)}
      <div style={lb}>Quality</div>
      <div style={{padding:"10px 14px",margin:"8px 0",borderRadius:10,fontSize:13,background:d.ir?"#e6f5f0":"#ffeaed",borderLeft:d.ir?"3px solid #1b7f6a":"3px solid #d70015"}}>
        In range: {d.ir?"Yes":"No"} | CV: {fpct(d.cv)} {d.cv<=.15?" - Qualified":d.cv<=.20?" - Acceptable":" - Reject"}
      </div>
    </div>
  );
}

function StdChart(props) {
  var ref = useRef(null);
  useEffect(function() {
    var cv=ref.current; if(!cv||!props.pts.length) return;
    // Display-unit conversion: pts are stored in props.unit; if displayUnit differs, convert x-axis values + slope.
    // y-axis (optical response) does NOT change. Intercept does NOT change.
    var inUnit = props.unit;
    var dispUnit = props.displayUnit || props.unit;
    // 1 inUnit = (mgMlToUnit(concToMgMl(1, inUnit), dispUnit)) dispUnits
    // x_disp = x_in * convFactor; slope_disp = slope_in / convFactor; intercept unchanged
    var convFactor = convertConc(1, inUnit, dispUnit);
    if (convFactor == null || !isFinite(convFactor) || convFactor === 0) convFactor = 1;
    var displaySlope = props.slope / convFactor;
    var displayIntercept = props.intercept;
    var w=520,h=332,ctx=cv.getContext("2d"),dpr=window.devicePixelRatio||1;
    cv.width=w*dpr; cv.height=h*dpr; ctx.scale(dpr,dpr);
    var pd={top:52,right:30,bottom:60,left:88};
    var cw2=w-pd.left-pd.right, ch=h-pd.top-pd.bottom;
    var pts=props.pts.map(function(p){return {conc: p.conc*convFactor, avg:p.avg, sd:p.sd};});
    var xM=Math.max.apply(null,pts.map(function(p){return p.conc;}))*1.15;
    var yM=Math.max.apply(null,pts.map(function(p){return p.avg+(p.sd||0);}))*1.25;
    var sx=function(v){return pd.left+(v/xM)*cw2;};
    var sy=function(v){return pd.top+ch-(v/yM)*ch;};
    ctx.clearRect(0,0,w,h);
    var outer=ctx.createLinearGradient(0,0,w,h);
    outer.addColorStop(0,"#ffffff");
    outer.addColorStop(1,"#f6fbff");
    ctx.fillStyle=outer;
    ctx.fillRect(0,0,w,h);
    ctx.fillStyle="#15213d"; ctx.font="700 16px -apple-system,system-ui,sans-serif"; ctx.textAlign="center";
    ctx.fillText("Standard Curve",w/2,24);
    ctx.fillStyle="#7283a7";
    ctx.font="500 11px -apple-system,system-ui,sans-serif";
    ctx.fillText("Average optical response with SD error bars",w/2,40);
    var grad=ctx.createLinearGradient(pd.left,pd.top,pd.left,pd.top+ch);
    grad.addColorStop(0,"#f2f7fd");
    grad.addColorStop(1,"#fbfdff");
    ctx.fillStyle=grad;
    ctx.fillRect(pd.left,pd.top,cw2,ch);
    ctx.strokeStyle="#d9e5f3";
    ctx.lineWidth=1;
    ctx.strokeRect(pd.left+.5,pd.top+.5,cw2-1,ch-1);
    ctx.setLineDash([2,4]); ctx.strokeStyle="#d7deea"; ctx.lineWidth=0.8;
    for(var i=1;i<5;i++){ctx.beginPath();ctx.moveTo(pd.left,pd.top+ch/5*i);ctx.lineTo(pd.left+cw2,pd.top+ch/5*i);ctx.stroke();}
    for(i=1;i<5;i++){ctx.beginPath();ctx.moveTo(pd.left+cw2/5*i,pd.top);ctx.lineTo(pd.left+cw2/5*i,pd.top+ch);ctx.stroke();}
    ctx.setLineDash([]);
    ctx.strokeStyle="#8090af"; ctx.lineWidth=1.35;
    ctx.beginPath();ctx.moveTo(pd.left,pd.top);ctx.lineTo(pd.left,pd.top+ch);ctx.lineTo(pd.left+cw2,pd.top+ch);ctx.stroke();
    ctx.fillStyle="#7a88a4"; ctx.font="500 10px -apple-system,system-ui,sans-serif"; ctx.textAlign="right";
    for(i=0;i<=5;i++) ctx.fillText(sig3(yM*(5-i)/5),pd.left-8,pd.top+ch/5*i+4);
    ctx.textAlign="center";
    for(i=0;i<=5;i++) ctx.fillText(sig3(xM*i/5),pd.left+cw2/5*i,pd.top+ch+18);
    if(props.fn){
      ctx.strokeStyle="rgba(52,120,246,0.12)";
      ctx.lineWidth=8;
      ctx.lineCap="round";
      ctx.beginPath();
      // xv here is in display units; we need to convert back to props.unit before calling fn
      for(i=0;i<=200;i++){var xv=xM*i/200,yv=props.fn(xv/convFactor);var px=sx(xv),py=sy(Math.max(0,Math.min(yM*2,yv)));if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}
      ctx.stroke();
      ctx.strokeStyle="#2d74ea";
      ctx.lineWidth=3;
      ctx.beginPath();
      for(i=0;i<=200;i++){xv=xM*i/200;yv=props.fn(xv/convFactor);px=sx(xv);py=sy(Math.max(0,Math.min(yM*2,yv)));if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}
      ctx.stroke();
    }
    for(i=0;i<pts.length;i++){
      var p=pts[i],px2=sx(p.conc),py2=sy(p.avg);
      if(p.sd>0){var yt=sy(p.avg+p.sd),yb=sy(Math.max(0,p.avg-p.sd));
        ctx.strokeStyle="#10b3c8";ctx.lineWidth=2.4;
        ctx.beginPath();ctx.moveTo(px2,yt);ctx.lineTo(px2,yb);ctx.stroke();
        ctx.beginPath();ctx.moveTo(px2-7,yt);ctx.lineTo(px2+7,yt);ctx.stroke();
        ctx.beginPath();ctx.moveTo(px2-7,yb);ctx.lineTo(px2+7,yb);ctx.stroke();
      }
      ctx.shadowColor="rgba(45,116,234,0.24)";ctx.shadowBlur=10;
      ctx.fillStyle="#2d74ea";ctx.beginPath();ctx.arc(px2,py2,6.5,0,Math.PI*2);ctx.fill();
      ctx.shadowBlur=0;
      ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(px2,py2,3.2,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#dff7fb";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(px2,py2,6.5,0,Math.PI*2);ctx.stroke();
    }
    // x-axis label is rendered as HTML overlay outside the canvas (so the unit can be a clickable UnitPill).
    // Y-axis label still drawn in canvas (rotated text doesn't pair well with HTML overlay).
    ctx.fillStyle="#556682"; ctx.font="500 12px -apple-system,system-ui,sans-serif";
    ctx.save();ctx.translate(18,pd.top+ch/2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";ctx.fillText("Optical Response (avg +/- SD)",0,0);ctx.restore();
    ctx.fillStyle="#2d74ea";ctx.font="600 12px -apple-system,system-ui,sans-serif";ctx.textAlign="left";
    ctx.fillText(props.fl+" fit",pd.left+12,pd.top+18);
    ctx.fillStyle="#71819f";ctx.textAlign="right";
    ctx.fillText("R\u00b2 = "+sig3(props.r2),pd.left+cw2-12,pd.top+18);
    ctx.textAlign="left";
    ctx.fillStyle="#556682";
    ctx.font="600 13px -apple-system,system-ui,sans-serif";
    ctx.fillText("y = ("+sig3(displaySlope)+") x + ("+sig3(displayIntercept)+")", pd.left+12, pd.top+34);
    if(props.instructor){
      ctx.fillStyle="#8e9bb5";
      ctx.font="italic 500 10.5px -apple-system,system-ui,sans-serif";
      ctx.fillText("Optical Response = (slope) \u00d7 ["+props.sn+"] + (intercept)", pd.left+12, pd.top+50);
    }
  },[props.pts,props.fn,props.sn,props.fl,props.r2,props.unit,props.instructor,props.displayUnit,props.slope,props.intercept]);
  // Wrapper holds canvas + HTML x-axis label with clickable UnitPill positioned over where the canvas text was.
  // Canvas is 520x332 with the x-axis label horizontally centered; the label sits ~10px above the canvas bottom edge.
  return <div style={{position:"relative",display:"inline-block"}}>
    <canvas ref={ref} style={{width:520,height:332,maxWidth:"100%",borderRadius:16,display:"block"}} />
    <div style={{position:"absolute",left:0,right:0,bottom:6,textAlign:"center",fontSize:12,color:"#556682",fontWeight:500,pointerEvents:"none"}}>
      <span style={{pointerEvents:"auto"}}>[{props.sn}] (<UnitPill unit={props.displayUnit||props.unit} onChange={props.onDisplayUnitChange||function(){}} size={12} color="#556682" hoverColor="#0b2a6f" weight={500} />)</span>
    </div>
  </div>;
}

function CmpChart(props) {
  var ref=useRef(null);
  var cols2=["#1b7f6a","#3478F6","#bf4800","#6b4fa0","#a05a00","#248a3d"];
  useEffect(function(){var cv=ref.current;if(!cv||!props.data.length)return;var w=700,h=240,ctx=cv.getContext("2d"),dpr=window.devicePixelRatio||1;cv.width=w*dpr;cv.height=h*dpr;ctx.scale(dpr,dpr);var pd={top:16,right:16,bottom:50,left:56},cw2=w-pd.left-pd.right,ch=h-pd.top-pd.bottom;var allV=[];props.data.forEach(function(d){SM.forEach(function(m){var c=d.r[m.id];if(c&&c.conc!=null&&!isNaN(c.conc))allV.push(c.conc);});});if(!allV.length)return;var yM=Math.max.apply(null,allV)*1.2;var ssy=function(v){return pd.top+ch-(v/yM)*ch;};ctx.clearRect(0,0,w,h);var grad=ctx.createLinearGradient(pd.left,pd.top,pd.left,pd.top+ch);grad.addColorStop(0,"#f0f4fa");grad.addColorStop(1,"#fafbfd");ctx.fillStyle=grad;ctx.fillRect(pd.left,pd.top,cw2,ch);ctx.setLineDash([2,3]);ctx.strokeStyle="#d0d5de";ctx.lineWidth=0.8;for(var i=1;i<4;i++){ctx.beginPath();ctx.moveTo(pd.left,pd.top+ch/4*i);ctx.lineTo(pd.left+cw2,pd.top+ch/4*i);ctx.stroke();}ctx.setLineDash([]);ctx.strokeStyle="#888";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(pd.left,pd.top+ch);ctx.lineTo(pd.left+cw2,pd.top+ch);ctx.stroke();ctx.fillStyle="#888";ctx.font="500 10px system-ui";ctx.textAlign="right";for(i=0;i<=4;i++)ctx.fillText(sig3(yM*(4-i)/4),pd.left-4,pd.top+ch/4*i+3);var gW=cw2/props.data.length,bW=Math.min(14,gW/(SM.length+1));props.data.forEach(function(d,di){var gx=pd.left+di*gW+gW/2;SM.forEach(function(m,mi){var v=d.r[m.id]?d.r[m.id].conc:null;if(v==null||isNaN(v))return;ctx.fillStyle=cols2[mi];var bx=gx-(SM.length*bW)/2+mi*bW;ctx.fillRect(bx,ssy(v),bW-1,pd.top+ch-ssy(v));});ctx.fillStyle="#555";ctx.font="600 10px system-ui";ctx.textAlign="center";ctx.save();ctx.translate(gx,pd.top+ch+10);ctx.rotate(-.35);ctx.fillText(d.nm.length>14?d.nm.slice(0,14)+"..":d.nm,0,0);ctx.restore();});},[props.data]);
  return <canvas ref={ref} style={{width:700,height:240,maxWidth:"100%",borderRadius:14}} />;
}

function LogoMark(){return <div style={{width:40,height:40,borderRadius:12,background:"linear-gradient(135deg,#18b5c9,#0b2a6f)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:16}}>eC</div>;}

function Wordmark(props){var compact=props.compact;return <div><div style={{display:"flex",alignItems:"baseline",gap:6}}><span style={{fontSize:compact?24:48,fontWeight:300,color:"#0b2a6f"}}>eSSF</span><span style={{fontSize:compact?24:48,fontWeight:300,color:"#139cb6"}}>Curve</span></div></div>;}

function BrandHero(){return <div style={{marginBottom:"1.5rem"}}><img src={ESSF_LOGO_B64} alt="eSSF Curve" style={{height:64,objectFit:"contain",marginBottom:8,display:"block"}} /><div style={{fontSize:12,color:"#6f7fa0",marginBottom:8}}>Plate-based assay analysis and quantitation</div><div style={{height:1,background:"#cfd9ea"}} /></div>;}

var thS={padding:"8px 10px",borderBottom:"2px solid #e5e5ea",fontSize:11,color:"#6e6e73",fontWeight:700,letterSpacing:0,background:"#fafafa",whiteSpace:"normal"};
var tdS={padding:"8px 10px",borderBottom:"1px solid #f0f0f3",fontSize:12,whiteSpace:"normal"};
var TABS=["Data Entry","Analysis","Results","Recommendations","Tools"];

var ESSF_LOGO_B64 = "data:image/png;base64,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ZUuX3HXXXZMP3N7/+Sc///l5H3+yfPHmLVu5pa2dM1mbU5k8b9+xR23YuPnDm2666cBt/Ygl/OenZvxsxer1n27dtjPflkhxRzLHrW0d/NmWbcm577434+qrr+4/fvx4079Onyjxk5/8/LtLPvpk2979LdyeznNbop2bWpr5s61bef777/PqtWu5I5XkvG2xrZygBuUoh20rz8ys57y/hHv1O2TcwdalZCUrWcm+nNXXu5FB9yGjn397ocXMKmfb7GjH+1JsK82WrTiXtzlvK844zElbczKf545kkpPtCU6lktyRz3NbMsmWY7FtZziTjrOtbe5Qmtc1NvOCz/bwX+Z/yre+vJjPf+hl/sofXubwxGv3muNuYOPoG7IY/3MH467XdMS1+cgxv2L0vHjFq++vWdyRTvG3Lv+eU92tx4cArgdQV1tbO6G+vj52INj6jreopyh8yimnjOzWrdshB166P3L9AJAJIsuKrl0PHf+Vo0eNGTNmbASRfsVp0b/nhIv7kvoPGXLYD667bsI9Dzxw+NenTDmyS48eAw72uYO9dvkVVxyxcOGSoz/+ePmxW7ZsGX3WWVMG+u8tXbr0wF4rrxzk2tXfu3rEO+/MP2HZslXHvPbWvLEAqrwP4YorrjD/zhrU/vyXvzxt4cLFk996663jHnz4weNGjRo1rmu3mr/94JqredWa1SpvW+woF5xs5bCtFStHMTPb8Wyep1525W0HrmHJSlaykn2pyMl3Jg0NDerEi66+6rEH7njokG6VjuMogw0B0hbAIUgi0D/gZzkAUjmFRCqJpK2wO5HV25rb9P6kEit3NmJPokPsTKSQgomsBQAaYAOQQP/23S073tnShPLyYbIiTKA8tJLg/fHNJxzde95bT//moq1bN5U/9sgjumvXmpf79+27bO/e/Ttef/75hQuXLt1FRLjgggvkLK9jvGhiLADEZsyY0fedd+Yd3qt7LzOVTe+bNeu/VjU2Njb5DvuACbiBGgSAHitWrOA//OHhI2JduiQMKc2+vQZs+vGPr9xXBIL6ICBDQghmZvTq1Su2cOHC8r/8ZUb322+ftuvVV181zz777JaiY3+uj2r69OnmVVddZXvn0OWee+6p/OST5ZP69u392VlTz9o98ciJaQBtB9mepk+fbhRti8ceu7fmvfeWDh04cCAvX75895w5c3Yf7Nxnzpwp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";


function PageHeader(props){
  return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,padding:"10px 16px 12px 16px",background:"linear-gradient(180deg,#ffffff,#f7fbff)",borderBottom:"1px solid #dfe7f2",marginBottom:"1rem",borderRadius:"14px 14px 0 0"}}>
    <div style={{display:"flex",alignItems:"center",gap:12}}>
      <img src={ESSF_LOGO_B64} alt="eSSF Curve" style={{height:38,objectFit:"contain",display:"block"}} />
      <div style={{fontSize:10,color:"#6f7fa0",fontFamily:"Georgia,serif",letterSpacing:1,paddingLeft:8,borderLeft:"1px solid #dfe7f2"}}>{APP_VERSION}</div>
    </div>
    <ModeToggle instructor={props.instructor} setInstructor={props.setInstructor} />
  </div>;
}

function ModeToggle(props){
  var on=!!props.instructor;
  return <div style={{display:"flex",alignItems:"center",gap:10}}>
    <span style={{fontSize:11,color:on?"#8e9bb5":"#0b2a6f",fontWeight:on?500:700,letterSpacing:0.3}}>Analysis</span>
    <button 
      onClick={function(){props.setInstructor(!on);}} 
      aria-label={"Switch to "+(on?"Analysis":"Instructor")+" mode"}
      title={on?"Instructor mode: shows step-by-step math walkthroughs and extra teaching context. Click to switch to Analysis mode.":"Analysis mode: streamlined workflow for lab use. Click to switch to Instructor mode for teaching walkthroughs."}
      style={{
        position:"relative",width:44,height:24,borderRadius:12,
        border:"1px solid "+(on?"#0f8aa2":"#d8dfeb"),
        background:on?"linear-gradient(135deg,#139cb6,#0f8aa2)":"#f0f3f8",
        cursor:"pointer",padding:0,transition:"all 0.2s ease"
      }}>
      <span style={{
        position:"absolute",top:2,left:on?22:2,width:18,height:18,
        borderRadius:"50%",background:"#fff",
        boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
        transition:"left 0.2s ease"
      }}/>
    </button>
    <span style={{fontSize:11,color:on?"#0b2a6f":"#8e9bb5",fontWeight:on?700:500,letterSpacing:0.3}}>Instructor</span>
  </div>;
}

function defaultCfg() {
  return {sn:"GFP",sc:"1",sdf:"1/10",sds:"1/2",xdf:"1/10",xds:"1/2",np:"1",tp:"no",at:"direct",fm:"linear",names:"",sr:"3",xr:"3",unit:"mg/mL",target:"GFP",tmpl:"bca",spikeUsed:"no",requireUnspiked:"yes",layout:"classical",forceOriginInCurve:"no"};
}

function Fraction(props){
  return <div style={{display:"inline-flex",flexDirection:"column",alignItems:"center",minWidth:props.w||140,lineHeight:1.15}}>
    <div style={{padding:"0 6px 3px",textAlign:"center"}}>{props.top}</div>
    <div style={{width:"100%",borderTop:"2px solid #30437a",margin:"0 0 3px"}} />
    <div style={{padding:"0 6px",textAlign:"center"}}>{props.bottom}</div>
  </div>;
}

function SpikeGuide(props){
  var instructor = props && props.instructor;
  // Design: amber liquid = endogenous analyte (warm serum tone), teal bubbles = spike analyte
  // Consistent with spike-recovery handout. Deterministic bubble positions (no randomness each render).
  var tube = function(opts){
    // opts: {label, hasLiquid, bubbles, isSpikeStock}
    var tw=56, th=110, offX=0, offY=2;
    var liquidTop = opts.isSpikeStock ? 28 : (opts.hasLiquid ? 38 : th);
    var liquidPath = opts.isSpikeStock 
      ? "M 2 "+liquidTop+" L 2 "+(th-14)+" Q 2 "+th+" "+(tw/2)+" "+th+" Q "+(tw-2)+" "+th+" "+(tw-2)+" "+(th-14)+" L "+(tw-2)+" "+liquidTop+" Z"
      : (opts.hasLiquid ? "M 2 "+liquidTop+" L 2 "+(th-14)+" Q 2 "+th+" "+(tw/2)+" "+th+" Q "+(tw-2)+" "+th+" "+(tw-2)+" "+(th-14)+" L "+(tw-2)+" "+liquidTop+" Z" : null);
    // Bubble positions predetermined (seeded layout)
    var bubblePositions = opts.bubbles === "stock" ? [
      {x:18,y:40,r:2.2},{x:32,y:52,r:1.8},{x:22,y:60,r:2.0},{x:38,y:68,r:2.3},{x:16,y:78,r:1.7},
      {x:30,y:88,r:2.1},{x:42,y:82,r:1.6},{x:12,y:68,r:1.9},{x:26,y:72,r:1.5},{x:36,y:58,r:1.7},
      {x:20,y:92,r:1.8},{x:40,y:96,r:1.5}
    ] : opts.bubbles === "spiked" ? [
      {x:16,y:58,r:2.0},{x:32,y:66,r:1.8},{x:22,y:76,r:1.7},{x:38,y:82,r:1.9},
      {x:12,y:84,r:1.5},{x:28,y:94,r:1.7},{x:42,y:90,r:1.6},{x:20,y:98,r:1.4}
    ] : [];
    return <div style={{textAlign:"center"}}>
      <svg width={tw+12} height={th+20} viewBox={"-6 0 "+(tw+12)+" "+(th+20)}>
        <defs>
          <linearGradient id={"endo-"+opts.label.replace(/ /g,"-").toLowerCase()} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e8c77d" stopOpacity="0.9"/>
            <stop offset="100%" stopColor="#b48a3a" stopOpacity="0.95"/>
          </linearGradient>
        </defs>
        {/* Tube body */}
        <path d={"M 0 4 L 0 "+(th-14)+" Q 0 "+th+" "+(tw/2)+" "+th+" Q "+tw+" "+th+" "+tw+" "+(th-14)+" L "+tw+" 4 Z"} fill="#fff" stroke="#0b2a6f" strokeWidth="1.2"/>
        {/* Rim */}
        <rect x="-3" y="-3" width={tw+6} height="7" rx="1.5" fill="#f4efe0" stroke="#0b2a6f" strokeWidth="1.2"/>
        {/* Liquid */}
        {liquidPath && <path d={liquidPath} fill={opts.isSpikeStock ? "#d8ecf3" : "url(#endo-"+opts.label.replace(/ /g,"-").toLowerCase()+")"} opacity={opts.isSpikeStock?"0.55":"1"}/>}
        {/* Meniscus (only for amber) */}
        {opts.hasLiquid && !opts.isSpikeStock && <path d={"M 2 "+liquidTop+" Q "+(tw/2)+" "+(liquidTop-2)+" "+(tw-2)+" "+liquidTop} fill="none" stroke="#b48a3a" strokeWidth="0.6" opacity="0.6"/>}
        {/* Bubbles */}
        {bubblePositions.map(function(b,i){return <g key={i}>
          <circle cx={b.x} cy={b.y} r={b.r} fill="#1d86a6" opacity="0.92"/>
          <circle cx={b.x-b.r*0.35} cy={b.y-b.r*0.35} r={b.r*0.3} fill="#fff" opacity="0.75"/>
        </g>;})}
        {/* Glass highlight */}
        <path d={"M 4 6 L 4 "+(th-16)+" Q 4 "+(th-3)+" "+(tw/2-3)+" "+(th-3)} fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.65"/>
      </svg>
      <div style={{fontSize:11,fontWeight:700,color:"#0b2a6f",marginTop:2,lineHeight:1.2}}>{opts.label}</div>
      <div style={{fontSize:9,color:"#6b7689",fontStyle:"italic",marginTop:1}}>{opts.sub}</div>
    </div>;
  };
  return <div style={{background:"linear-gradient(180deg,#fbfdff,#f5f9ff)",border:"1px solid #dfe7f2",borderRadius:16,padding:"16px 18px"}}>
    <div style={{fontSize:14,fontWeight:800,color:"#0b2a6f",marginBottom:12}}>How spike recovery works</div>
    <div style={{display:"flex",justifyContent:"center",alignItems:"flex-start",gap:16,marginBottom:14,flexWrap:"wrap",position:"relative"}}>
      {tube({label:"Unspiked sample",sub:"endogenous only",hasLiquid:true,bubbles:"none"})}
      <div style={{fontSize:22,color:"#0b2a6f",fontWeight:300,paddingTop:50}}>+</div>
      {tube({label:"Spike stock",sub:"pure target protein",hasLiquid:false,bubbles:"stock",isSpikeStock:true})}
      <div style={{fontSize:22,color:"#0b2a6f",fontWeight:300,paddingTop:50}}>=</div>
      {tube({label:"Spiked sample",sub:"endogenous + spike",hasLiquid:true,bubbles:"spiked"})}
      {instructor && <svg style={{position:"absolute",inset:0,pointerEvents:"none",width:"100%",height:"100%"}} preserveAspectRatio="none">
        <circle r="3" fill="#1d86a6" opacity="0.85" style={{animation:"spike-drop 3.6s ease-in-out infinite"}}>
          <animateMotion dur="3.6s" repeatCount="indefinite" path="M 0 0 L 0 0" />
        </circle>
      </svg>}
    </div>
    {instructor && <style>{"@keyframes spike-drop{0%,15%{opacity:0;transform:translate(46%,28%)}20%{opacity:1;transform:translate(46%,28%)}55%{opacity:1;transform:translate(62%,62%)}70%{opacity:0.4;transform:translate(62%,66%) scale(1.8,0.6)}75%,100%{opacity:0;transform:translate(62%,66%) scale(1.8,0.6)}}"}</style>}
    <div style={{display:"flex",gap:20,justifyContent:"center",alignItems:"center",flexWrap:"wrap",marginBottom:10,fontSize:10,color:"#5a6984"}}>
      <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:10,background:"linear-gradient(180deg,#e8c77d,#b48a3a)",border:"0.5px solid #b48a3a",borderRadius:1}}/><span>endogenous analyte</span></div>
      <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:8,height:8,background:"#1d86a6",borderRadius:"50%"}}/><span>spike (what we added)</span></div>
    </div>
    <div style={{fontSize:11,color:"#5a6984",lineHeight:1.6,paddingTop:8,borderTop:"1px solid #e5ecf5"}}>
      We measure the unspiked and spiked samples on the plate. If the assay is accurate, the increase matches the expected spike concentration.
    </div>
  </div>;
}

var concToMgMl = function(v, unit) {
  if (v==null || isNaN(v)) return null;
  if (unit==="mg/mL" || unit==="ug/uL") return v;
  if (unit==="ug/mL") return v/1000;
  if (unit==="ng/mL") return v/1000000;
  if (unit==="pg/mL") return v/1000000000;
  return null;
};
var mgMlToUnit = function(v, unit) {
  if (v==null || isNaN(v)) return null;
  if (unit==="mg/mL" || unit==="ug/uL") return v;
  if (unit==="ug/mL") return v*1000;
  if (unit==="ng/mL") return v*1000000;
  if (unit==="pg/mL") return v*1000000000;
  return null;
};
// Convert between any two mass-concentration units. Returns null if conversion impossible.
var convertConc = function(v, fromUnit, toUnit) {
  if (v==null || isNaN(v)) return null;
  if (fromUnit === toUnit) return v;
  var asMgMl = concToMgMl(v, fromUnit);
  if (asMgMl == null) return null;
  return mgMlToUnit(asMgMl, toUnit);
};
// Cycle through available display units (in descending order of magnitude)
var DISPLAY_UNITS = ["mg/mL", "ug/mL", "ng/mL", "pg/mL"];
var cycleDisplayUnit = function(current) {
  var idx = DISPLAY_UNITS.indexOf(current);
  if (idx === -1) return DISPLAY_UNITS[0];
  return DISPLAY_UNITS[(idx + 1) % DISPLAY_UNITS.length];
};
var volToUL = function(v, unit) {
  if (v==null || isNaN(v)) return null;
  if (unit==="uL") return v;
  if (unit==="mL") return v*1000;
  return null;
};

// UnitPill: tiny clickable unit text. Click cycles through DISPLAY_UNITS.
// Designed to be visually inconspicuous: dotted underline like an abbr/tooltip.
// Props: unit (current display unit), onChange (called with next unit)
function UnitPill(props) {
  var unit = props.unit;
  var onChange = props.onChange;
  var size = props.size || 11;
  var color = props.color || "#6e6e73";
  var weight = props.weight != null ? props.weight : 400;
  var hoverColor = props.hoverColor || "#0b2a6f";
  var _h = useState(false);
  var hover = _h[0], setHover = _h[1];
  return <span
    role="button"
    tabIndex={0}
    title={"Display unit: "+unit+" — click to change"}
    onClick={function(e){e.stopPropagation(); onChange(cycleDisplayUnit(unit));}}
    onKeyDown={function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault(); onChange(cycleDisplayUnit(unit));}}}
    onMouseEnter={function(){setHover(true);}}
    onMouseLeave={function(){setHover(false);}}
    style={{
      cursor:"pointer",
      borderBottom: hover ? "1px dashed "+hoverColor : "1px dotted "+color,
      color: hover ? hoverColor : color,
      fontSize: size,
      fontWeight: weight,
      paddingBottom:1,
      transition:"color 0.12s, border-color 0.12s",
      userSelect:"none",
      whiteSpace:"nowrap",
    }}
  >{unit}</span>;
}

// FormatPill: tiny clickable label that toggles between two display formats.
// Visually identical to UnitPill (dotted underline). Click toggles current → other.
// Props: value, onChange (receives new value), labelOf (fn that maps value → display string),
//        toggleOf (fn that maps current value → next value).
function FormatPill(props) {
  var value = props.value;
  var onChange = props.onChange;
  var labelOf = props.labelOf || function(v){return String(v);};
  var toggleOf = props.toggleOf || function(v){return v;};
  var size = props.size || 11;
  var color = props.color || "#6e6e73";
  var weight = props.weight != null ? props.weight : 400;
  var hoverColor = props.hoverColor || "#0b2a6f";
  var _h = useState(false);
  var hover = _h[0], setHover = _h[1];
  var nextLabel = labelOf(toggleOf(value));
  return <span
    role="button"
    tabIndex={0}
    title={"Currently showing: "+labelOf(value)+" — click to switch to "+nextLabel}
    onClick={function(e){e.stopPropagation(); onChange(toggleOf(value));}}
    onKeyDown={function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault(); onChange(toggleOf(value));}}}
    onMouseEnter={function(){setHover(true);}}
    onMouseLeave={function(){setHover(false);}}
    style={{
      cursor:"pointer",
      borderBottom: hover ? "1px dashed "+hoverColor : "1px dotted "+color,
      color: hover ? hoverColor : color,
      fontSize: size,
      fontWeight: weight,
      paddingBottom:1,
      transition:"color 0.12s, border-color 0.12s",
      userSelect:"none",
      whiteSpace:"nowrap",
    }}
  >{labelOf(value)}</span>;
}

function UnitConverterCard(){
  var _s=useState({input:"1", fromUnit:"mg/mL", toUnit:"ug/mL"});
  var st=_s[0], setSt=_s[1];
  var u=function(k,v){setSt(function(p){var n={};for(var x in p)n[x]=p[x];n[k]=v;return n;});};

  // Conversion factors expressed as multipliers to mg/mL canonical.
  // value_in_unit * unitToMgMl[unit] = value_in_mg/mL
  var unitToMgMl = {
    "mg/mL": 1,
    "mg/L": 0.001,
    "ug/uL": 1,    // = mg/mL by definition
    "ug/mL": 0.001,
    "ug/L": 1e-6,
    "ng/uL": 0.001, // = ug/mL by definition
    "ng/mL": 1e-6,
    "pg/uL": 1e-6,
    "pg/mL": 1e-9
  };
  var unitOptions = Object.keys(unitToMgMl);

  var inputVal = parseFloat(st.input);
  var validInput = !isNaN(inputVal) && st.input.trim() !== "";
  var mgMlVal = validInput ? inputVal * unitToMgMl[st.fromUnit] : null;
  var resultVal = mgMlVal != null ? mgMlVal / unitToMgMl[st.toUnit] : null;

  // Show the multiplier in human-readable form
  var factor = unitToMgMl[st.fromUnit] / unitToMgMl[st.toUnit];
  var factorDisplay = sig3(factor);
  var sameUnit = st.fromUnit === st.toUnit;
  // Detect equivalent units (mg/mL = ug/uL etc.)
  var isEquivalent = !sameUnit && unitToMgMl[st.fromUnit] === unitToMgMl[st.toUnit];

  var swap = function(){
    setSt(function(p){return Object.assign({}, p, {fromUnit:p.toUnit, toUnit:p.fromUnit, input: resultVal!=null?String(sig3(resultVal)):p.input});});
  };

  var inputBox={padding:"10px 12px",borderRadius:8,border:"1px solid #d8dfeb",fontSize:15,fontFamily:"monospace",outline:"none",width:"100%",boxSizing:"border-box"};
  var resultBox=Object.assign({},inputBox,{background:"#f7fdfd",border:"1.5px solid #0f8aa2",color:"#0f5c6a",fontWeight:700});
  var selectBox={padding:"10px 12px",borderRadius:8,border:"1px solid #d8dfeb",fontSize:15,outline:"none",width:"100%",boxSizing:"border-box",background:"#fff"};
  var lblStyle={display:"block",fontSize:11,fontWeight:700,color:"#30437a",marginBottom:5,textTransform:"uppercase",letterSpacing:0.4};

  return <div style={{background:"#fff",borderRadius:16,border:"1px solid "+BORDER,boxShadow:"0 8px 22px rgba(11,42,111,0.04)",overflow:"hidden",marginBottom:"1rem"}}>
    <div style={{background:"linear-gradient(135deg,#0F8AA2,#0B2A6F)",color:"#fff",padding:"14px 18px"}}>
      <div style={{fontSize:15,fontWeight:800,letterSpacing:0.3}}>Unit Converter</div>
      <div style={{fontSize:11,opacity:0.85,marginTop:2}}>Convert between mass-per-volume protein concentration units.</div>
    </div>
    <div style={{padding:"1.25rem"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:14,alignItems:"end"}} className="uc-grid">
        {/* FROM */}
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:8}}>
            <div>
              <label style={lblStyle}>Value</label>
              <input type="text" value={st.input} onChange={function(e){u("input",e.target.value);}} placeholder="e.g. 1.5" style={inputBox} />
            </div>
            <div>
              <label style={lblStyle}>From</label>
              <select value={st.fromUnit} onChange={function(e){u("fromUnit",e.target.value);}} style={selectBox}>
                {unitOptions.map(function(o){return <option key={o} value={o}>{o}</option>;})}
              </select>
            </div>
          </div>
        </div>

        {/* SWAP ARROW */}
        <button onClick={swap} title="Swap from/to" style={{
          background:"#fff",
          border:"1px solid #d8dfeb",
          color:"#6e6e73",
          padding:"8px 10px",
          borderRadius:8,
          cursor:"pointer",
          fontSize:18,
          fontWeight:700,
          height:"42px",
          alignSelf:"end",
          marginBottom:0,
          lineHeight:1
        }}>⇄</button>

        {/* TO */}
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1.4fr 1fr",gap:8}}>
            <div>
              <label style={lblStyle}>Result</label>
              <input type="text" readOnly value={validInput && resultVal!=null ? sig3(resultVal) : ""} placeholder="—" style={resultBox} />
            </div>
            <div>
              <label style={lblStyle}>To</label>
              <select value={st.toUnit} onChange={function(e){u("toUnit",e.target.value);}} style={selectBox}>
                {unitOptions.map(function(o){return <option key={o} value={o}>{o}</option>;})}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Conversion explainer */}
      {validInput && !sameUnit && <div style={{marginTop:14,padding:"10px 12px",background:"#f7fdfd",borderRadius:8,border:"1px solid #c8e8ee",fontSize:12,color:"#0f5c6a",fontFamily:"monospace"}}>
        {isEquivalent
          ? <span><strong>{st.fromUnit}</strong> and <strong>{st.toUnit}</strong> are mathematically identical units (1:1).</span>
          : <span>1 {st.fromUnit} = {factorDisplay} {st.toUnit}</span>}
      </div>}
      {sameUnit && <div style={{marginTop:14,padding:"10px 12px",background:"#fff7e0",borderRadius:8,border:"1px solid #e8c77d",fontSize:12,color:"#8a6420"}}>
        From and To are the same unit. Pick a different "To" unit to convert.
      </div>}
    </div>
    <style>{".uc-grid{grid-template-columns:1fr auto 1fr}@media (max-width: 720px){.uc-grid{grid-template-columns:1fr !important}.uc-grid > button{transform:rotate(90deg);justify-self:center}}"}</style>
  </div>;
}

function SpikeCalculatorCard(props){
  var _s=useState({stockConc:"500",stockUnit:"ug/uL",sampleVol:"1000",sampleVolUnit:"uL",spikeVol:"10",spikeVolUnit:"uL",endoConc:"0.5",assayUnit:"mg/mL",curveMin:"0.05",curveMax:"1.0"});
  var st=_s[0], setSt=_s[1];
  var _anim=useState(-1);
  var animStep=_anim[0], setAnimStep=_anim[1];
  var u=function(k,v){setSt(function(p){var n={};for(var x in p)n[x]=p[x];n[k]=v;return n;});};

  // Computation
  var stockMgMl=concToMgMl(parseFloat(st.stockConc), st.stockUnit);
  var sampUL=volToUL(parseFloat(st.sampleVol), st.sampleVolUnit)||0;
  var spikeUL=volToUL(parseFloat(st.spikeVol), st.spikeVolUnit)||0;
  var totalUL=sampUL+spikeUL;
  var expMgMl=stockMgMl!=null && totalUL>0 ? stockMgMl*(spikeUL/totalUL) : null;
  var expDisplay=expMgMl!=null?mgMlToUnit(expMgMl, st.assayUnit):null;
  var spikeMassMg=stockMgMl!=null?stockMgMl*(spikeUL/1000):null;
  var endoV=parseFloat(st.endoConc)||0;
  var cMin=parseFloat(st.curveMin)||0, cMax=parseFloat(st.curveMax)||0;
  var spikePct=totalUL>0?(spikeUL/totalUL):null;
  var spikeEndoRatio=(endoV>0 && expDisplay!=null)?(expDisplay/endoV):null;

  // Traffic light render
  var L=function(level,label,detail){
    var col=level==="green"?"#2e7d5b":level==="amber"?"#c66a1e":level==="red"?"#b4332e":"#aeaeb2";
    var bg=level==="green"?"#e8f2eb":level==="amber"?"#faeedd":level==="red"?"#f7e8e5":"#f4f4f6";
    var symb=level==="green"?"✓":level==="amber"?"⚠":level==="red"?"✗":"○";
    return <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:bg,border:"1px solid "+col,borderLeft:"4px solid "+col,borderRadius:10,marginBottom:8}}>
      <span style={{fontSize:18,color:col,fontWeight:700,lineHeight:1}}>{symb}</span>
      <div style={{flex:1}}>
        <div style={{fontSize:12,color:col,fontWeight:700}}>{label}</div>
        <div style={{fontSize:11,color:"#5a6984",marginTop:2}}>{detail}</div>
      </div>
    </div>;
  };
  var volLight=(spikePct==null||isNaN(spikePct))?{lvl:"off",det:"Enter sample and spike volumes above"}
    :spikePct<=0.10?{lvl:"green",det:"The spike takes up only "+(spikePct*100).toFixed(1)+"% of the final mix. Good — you barely diluted the sample."}
    :spikePct<=0.15?{lvl:"amber",det:"The spike is "+(spikePct*100).toFixed(1)+"% of the final mix. A bit high — the sample is getting noticeably diluted. The ICH M10 guideline says keep it at 10% or less."}
    :{lvl:"red",det:"The spike takes up "+(spikePct*100).toFixed(1)+"% of the final mix. That’s too much — you’re diluting your sample so much that the results will be hard to interpret. Use less spike stock, or more sample."};
  var rangeLight=(expDisplay==null||cMin<=0||cMax<=0)?{lvl:"off",det:"Fill in stock concentration, both volumes, and your curve range"}
    :(expDisplay>=cMin && expDisplay<=cMax)?{lvl:"green",det:"Your expected spike ("+sig3(expDisplay)+" "+st.assayUnit+") lands inside your standard curve’s measurable range ("+sig3(cMin)+"–"+sig3(cMax)+"). The reader will be able to quantify it."}
    :(expDisplay>cMax)?{lvl:"red",det:"Your expected spike ("+sig3(expDisplay)+" "+st.assayUnit+") is higher than your curve’s top point ("+sig3(cMax)+"). You’ll need to dilute further before the plate reads — or use a smaller spike."}
    :{lvl:"red",det:"Your expected spike ("+sig3(expDisplay)+" "+st.assayUnit+") is below your curve’s lowest point ("+sig3(cMin)+"). The reader won’t see it reliably — use a bigger spike, or concentrate the sample first."};
  var ratioLight=(spikeEndoRatio==null)?{lvl:"off",det:"Enter how much of the target is already in your sample (endogenous)"}
    :spikeEndoRatio>=1.0?{lvl:"green",det:"You are adding "+spikeEndoRatio.toFixed(2)+"x as much spike as the sample already contains. This is a good setup — if recovery is off, you will see it clearly."}
    :spikeEndoRatio>=0.25?{lvl:"amber",det:"You are adding "+spikeEndoRatio.toFixed(2)+"x the amount already in the sample. It will work, but a bigger spike would make recovery errors easier to spot."}
    :{lvl:"red",det:"The spike is only "+spikeEndoRatio.toFixed(2)+"x what is already in the sample — so small that the sample’s own signal will drown it out. Even if the assay misreads the spike badly, you will not be able to tell."};

  // Field builders matching Spike stock panel aesthetic
  var fieldLabel=function(text){return <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:6,color:"#18233f"}}>{text}</label>;};
  var fldUnit=function(text,key,unitKey,opts){return <div>{fieldLabel(text)}<div style={{display:"flex",gap:8,alignItems:"center"}}><input value={st[key]} onChange={function(e){u(key,e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}} /><select value={st[unitKey]} onChange={function(e){u(unitKey,e.target.value);}} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}>{opts.map(function(o){return <option key={o} value={o}>{o}</option>;})}</select></div></div>;};
  var fld=function(text,key){return <div>{fieldLabel(text)}<input value={st[key]} onChange={function(e){u(key,e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13,boxSizing:"border-box"}} /></div>;};

  // Animated math player
  var animTotal=4; // steps 0..3
  var playMath=function(){
    setAnimStep(0);
    var step=0;
    var tick=function(){
      step+=1;
      if(step>animTotal){setAnimStep(-1);return;}
      setAnimStep(step);
      setTimeout(tick,1600);
    };
    setTimeout(tick,1600);
  };
  var stepActive=function(n){return animStep===n;};
  var stepStyle=function(n){
    var active=stepActive(n);
    return {
      padding:"12px 14px",borderRadius:10,marginBottom:10,
      background:active?"#fff4e0":"#ffffff",
      border:"1px solid "+(active?"#e8c481":"#e5ecf5"),
      transition:"all 0.3s ease",
      transform:active?"translateX(4px)":"translateX(0)",
      boxShadow:active?"0 4px 12px rgba(200,106,30,0.18)":"none"
    };
  };

  // The math panel (used in both stacked-below and side-by-side modes)
  var mathPanel=<div style={{background:"linear-gradient(180deg,#fbfbff,#f6f9ff)",borderRadius:14,padding:"16px 18px",border:"1px solid #dfe7f2"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:10,flexWrap:"wrap"}}>
      <div style={{fontSize:13,fontWeight:800,color:"#30437a"}}>Walkthrough</div>
      <button onClick={playMath} disabled={animStep>=0} style={{background:animStep>=0?"#e8eaf0":"linear-gradient(135deg,#6337b9,#3478F6)",color:animStep>=0?"#8e9bb5":"#fff",border:"none",padding:"6px 14px",borderRadius:8,fontSize:11,fontWeight:700,cursor:animStep>=0?"default":"pointer",letterSpacing:0.5}}>{animStep>=0?"Playing step "+animStep+" of "+animTotal:"▶ Play the math"}</button>
    </div>
    <div style={stepStyle(1)}>
      <div style={{fontSize:10,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Step 1 — Mass of spike added</div>
      <div style={{fontSize:11,color:"#5a6984",marginBottom:8,fontStyle:"italic"}}>Multiply concentration by volume to get mass.</div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:13,color:"#30437a"}}>
        <span>Mass added</span><span>=</span>
        <span style={{fontFamily:"monospace"}}>{st.stockConc} {st.stockUnit} × {st.spikeVol} {st.spikeVolUnit}</span>
        <span>=</span>
        <strong style={{color:"#0b2a6f"}}>{spikeMassMg!=null?sig3(spikeMassMg)+" mg":"---"}</strong>
      </div>
    </div>
    <div style={stepStyle(2)}>
      <div style={{fontSize:10,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Step 2 — Final sample volume</div>
      <div style={{fontSize:11,color:"#5a6984",marginBottom:8,fontStyle:"italic"}}>The spike adds to the sample volume.</div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:13,color:"#30437a"}}>
        <span>Final volume</span><span>=</span>
        <span style={{fontFamily:"monospace"}}>{st.sampleVol} {st.sampleVolUnit} + {st.spikeVol} {st.spikeVolUnit}</span>
        <span>=</span>
        <strong style={{color:"#0b2a6f"}}>{totalUL>0?totalUL.toFixed(1)+" µL":"---"}</strong>
      </div>
    </div>
    <div style={stepStyle(3)}>
      <div style={{fontSize:10,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Step 3 — Expected spike concentration</div>
      <div style={{fontSize:11,color:"#5a6984",marginBottom:8,fontStyle:"italic"}}>Divide mass by final volume. This is the spike's contribution in the diluted mixture.</div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:13,color:"#30437a"}}>
        <span>Expected</span><span>=</span>
        <Fraction top={<span>({st.stockConc} {st.stockUnit}) × ({st.spikeVol} {st.spikeVolUnit})</span>} bottom={<span>({st.sampleVol} {st.sampleVolUnit}) + ({st.spikeVol} {st.spikeVolUnit})</span>} w={280} />
        <span>=</span>
        <strong style={{color:"#0b2a6f",fontSize:15}}>{expDisplay!=null?sig3(expDisplay)+" "+st.assayUnit:"---"}</strong>
      </div>
    </div>
    <div style={stepStyle(4)}>
      <div style={{fontSize:10,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Step 4 — Check recovery (after the run)</div>
      <div style={{fontSize:11,color:"#5a6984",marginBottom:8,fontStyle:"italic"}}>Once you have measured values, the recovery formula tells you how accurate the assay is.</div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:13,color:"#30437a"}}>
        <span>% Recovery</span><span>=</span>
        <Fraction top={<span>measured spiked – measured unspiked</span>} bottom={<span>{expDisplay!=null?sig3(expDisplay)+" "+st.assayUnit:"expected"}</span>} w={280} />
        <span>× 100</span>
      </div>
      <div style={{fontSize:11,color:"#5a6984",marginTop:6,fontStyle:"italic"}}>Target: 80–120%. Outside that window suggests matrix interference, stock error, or assay drift.</div>
    </div>
  </div>;

  // Inputs panel (left or top depending on width)
  var inputsPanel=<div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1rem"}}>
      <div style={{background:"#fffaf4",border:"1px solid #f3e3c8",borderRadius:14,padding:"12px 14px"}}>
        <div style={{fontSize:12,fontWeight:800,color:"#8a4000",marginBottom:8}}>Sample &amp; curve context</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:"0.8rem"}}>
          {fldUnit("Sample volume before spike was added","sampleVol","sampleVolUnit",["uL","mL"])}
          {fldUnit("Estimated unspiked sample concentration","endoConc","assayUnit",["ng/mL","ug/mL","mg/mL"])}
          <div>
            <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:6,color:"#18233f"}}>Standard curve range (same units as endogenous)</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.6rem"}}>
              {fld("Curve min","curveMin")}
              {fld("Curve max","curveMax")}
            </div>
          </div>
        </div>
      </div>
      <div style={{background:"#f7f1ff",border:"1px solid #e2d7fb",borderRadius:14,padding:"12px 14px"}}>
        <div style={{fontSize:12,fontWeight:800,color:"#6337b9",marginBottom:8}}>Spike stock</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr",gap:"0.8rem"}}>
          {fldUnit("Stock concentration of the spike","stockConc","stockUnit",["ng/mL","ug/mL","mg/mL","ug/uL"])}
          {fldUnit("Volume of stock spike added to the sample","spikeVol","spikeVolUnit",["uL","mL"])}
        </div>
      </div>
    </div>
    {(function(){
      if(totalUL<=0)return null;
      var row=function(label,value,sub){return <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"6px 0",borderBottom:"1px dashed #d8e1f0"}}><span style={{fontSize:11,color:"#30437a",fontWeight:600}}>{label}</span><span style={{fontSize:13,fontWeight:700,color:"#0b2a6f",fontFamily:"monospace"}}>{value}{sub?<span style={{fontWeight:400,color:"#6e6e73",fontSize:10,marginLeft:6}}>{sub}</span>:null}</span></div>;};
      return <div style={{padding:"10px 14px",background:"#f2f7ff",borderRadius:10,border:"1px dashed #c6d3e8",marginBottom:16}}>
        <div style={{fontSize:10,color:"#30437a",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>Live preview (computed)</div>
        {row("Final sample volume",totalUL.toFixed(1)+" µL","("+(totalUL/1000).toFixed(3)+" mL)")}
        {spikeMassMg!=null?row("Mass of spike added",sig3(spikeMassMg)+" mg","("+sig3(spikeMassMg*1000)+" µg)"):null}
        {expDisplay!=null?row("Expected spike concentration",sig3(expDisplay)+" "+st.assayUnit):null}
      </div>;
    })()}
    <div style={{fontSize:11,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Checks</div>
    {L(volLight.lvl,"Spike volume ≤ 10% of total",volLight.det)}
    {L(rangeLight.lvl,"Expected spike in curve range",rangeLight.det)}
    {L(ratioLight.lvl,"Spike large enough vs endogenous",ratioLight.det)}
    {(function(){
      var allGreen = volLight.lvl==="green" && rangeLight.lvl==="green" && ratioLight.lvl==="green";
      if(allGreen) return null;
      var canSuggest = stockMgMl!=null && cMin>0 && cMax>0;
      if(!canSuggest) return null;
      var targetExp_userUnit = Math.sqrt(cMin * cMax);
      if(endoV > 0 && targetExp_userUnit < endoV){
        targetExp_userUnit = Math.max(targetExp_userUnit, endoV * 1.2);
        targetExp_userUnit = Math.min(targetExp_userUnit, cMax * 0.5);
      }
      var targetExp_mgMl = concToMgMl(targetExp_userUnit, st.assayUnit);
      if(targetExp_mgMl==null || targetExp_mgMl<=0 || stockMgMl<=0) return null;
      var targetFraction = targetExp_mgMl / stockMgMl;
      var cannotMeet = false;
      var stockTooConcentrated = false;
      var actualFraction = targetFraction;
      if(targetFraction > 0.10){
        actualFraction = 0.10;
        cannotMeet = true;
      } else if(targetFraction < 0.005){
        // Stock is so concentrated that a natural spike would be < 0.5% of final — too small to pipette accurately
        stockTooConcentrated = true;
        actualFraction = targetFraction; // keep the mathematically correct fraction
      }
      var suggestedSampleVol_uL = 1000;
      var suggestedSpikeVol_uL = suggestedSampleVol_uL * actualFraction / (1 - actualFraction);
      var roundedSpikeUL;
      if(suggestedSpikeVol_uL >= 100) roundedSpikeUL = Math.round(suggestedSpikeVol_uL/10)*10;
      else if(suggestedSpikeVol_uL >= 10) roundedSpikeUL = Math.round(suggestedSpikeVol_uL);
      else if(suggestedSpikeVol_uL >= 1) roundedSpikeUL = Math.round(suggestedSpikeVol_uL*2)/2;
      else roundedSpikeUL = Math.round(suggestedSpikeVol_uL*10)/10;
      var actualTotalUL = suggestedSampleVol_uL + roundedSpikeUL;
      var actualExp_mgMl = stockMgMl * (roundedSpikeUL/actualTotalUL);
      var actualExp_display = mgMlToUnit(actualExp_mgMl, st.assayUnit);
      var apply = function(){
        setSt(function(p){var n={};for(var x in p)n[x]=p[x];n.sampleVol=String(suggestedSampleVol_uL);n.sampleVolUnit="uL";n.spikeVol=String(roundedSpikeUL);n.spikeVolUnit="uL";return n;});
      };
      // Compute recommended stock dilution if stock is too concentrated
      var targetWorkingStock_mgMl = targetExp_mgMl / 0.05;
      var stockDilutionRatio = stockMgMl / targetWorkingStock_mgMl;
      var roundedDilution = null;
      if(stockTooConcentrated && stockDilutionRatio > 1){
        var candidates = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
        roundedDilution = candidates.find(function(d){return d >= stockDilutionRatio;}) || candidates[candidates.length-1];
      }
      return <div style={{marginTop:10,padding:"12px 14px",background:"linear-gradient(180deg,#f0f9ff,#e1f0fd)",border:"1px solid #a8c8e8",borderRadius:10}}>
        <div style={{fontSize:11,color:"#0b2a6f",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>Try these values</div>
        {stockTooConcentrated ? <div>
          <div style={{fontSize:12,color:"#30437a",lineHeight:1.6,marginBottom:8}}>
            Your spike stock ({st.stockConc} {st.stockUnit}) is <strong>too concentrated</strong> for this curve range. A meaningful spike would be smaller than you can pipette reliably.
          </div>
          <div style={{fontSize:12,color:"#30437a",lineHeight:1.6,marginBottom:8}}>
            <strong>Recommended approach:</strong> first dilute your stock 1:{roundedDilution} to make a working stock, then use:
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:8}}>
            <div style={{padding:"8px 10px",background:"#fff",borderRadius:8,border:"1px solid #cfd8e3"}}>
              <div style={{fontSize:9,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>Sample volume</div>
              <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:"#0b2a6f"}}>1000 µL</div>
            </div>
            <div style={{padding:"8px 10px",background:"#fff",borderRadius:8,border:"1px solid #cfd8e3"}}>
              <div style={{fontSize:9,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>Spike volume (of working stock)</div>
              <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:"#0b2a6f"}}>~50 µL</div>
            </div>
          </div>
          <div style={{fontSize:11,color:"#5a6984",fontStyle:"italic"}}>Once you have the diluted working stock on the bench, update the stock concentration in this planner to match and re-check.</div>
        </div> : <div>
          <div style={{fontSize:12,color:"#30437a",lineHeight:1.6,marginBottom:8}}>
            For your stock ({st.stockConc} {st.stockUnit}) and curve range, these volumes should put all checks in the green:
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:8}}>
            <div style={{padding:"8px 10px",background:"#fff",borderRadius:8,border:"1px solid #cfd8e3"}}>
              <div style={{fontSize:9,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>Sample volume</div>
              <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:"#0b2a6f"}}>{suggestedSampleVol_uL} µL</div>
            </div>
            <div style={{padding:"8px 10px",background:"#fff",borderRadius:8,border:"1px solid #cfd8e3"}}>
              <div style={{fontSize:9,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>Spike volume</div>
              <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:"#0b2a6f"}}>{roundedSpikeUL} µL</div>
            </div>
            <div style={{padding:"8px 10px",background:"#f7f1ff",borderRadius:8,border:"1px solid #e2d7fb"}}>
              <div style={{fontSize:9,color:"#6337b9",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>Expected spike conc</div>
              <div style={{fontFamily:"monospace",fontSize:14,fontWeight:800,color:"#6337b9"}}>{sig3(actualExp_display)} {st.assayUnit}</div>
            </div>
          </div>
          {cannotMeet && <div style={{fontSize:11,color:"#8a4000",marginBottom:8,fontStyle:"italic"}}>Note: your spike stock is on the weaker side for this curve range. We recommended the maximum allowable spike volume (10% of the final mix). If recovery is hard to detect, consider a more concentrated stock.</div>}
          <button onClick={apply} style={{background:"linear-gradient(135deg,#6337b9,#3478F6)",color:"#fff",border:"none",padding:"7px 14px",borderRadius:8,fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:0.3}}>Apply suggested values</button>
        </div>}
      </div>;
    })()}
  </div>;

  return <div style={{background:"#fff",borderRadius:16,border:"1px solid "+BORDER,boxShadow:"0 8px 22px rgba(11,42,111,0.04)",overflow:"hidden",marginBottom:"1rem"}}>
    <div style={{background:"linear-gradient(135deg,#6337b9,#3478F6)",color:"#fff",padding:"14px 18px"}}>
      <div style={{fontSize:15,fontWeight:800,letterSpacing:0.3}}>Spike Recovery Planner</div>
      <div style={{fontSize:11,opacity:0.85,marginTop:2}}>Preview expected spike and warnings before you set up the experiment.</div>
    </div>
    <div style={{padding:"1.25rem"}}>
      {props.instructor 
        ? <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:"1.25rem"}} className="sc-grid">{inputsPanel}{mathPanel}</div>
        : inputsPanel
      }
    </div>
    {/* responsive: collapse to single column under 900px */}
    <style>{".sc-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}@media (max-width: 900px){.sc-grid{grid-template-columns:1fr !important}}"}</style>
  </div>;
}

// === PDF PARSING HELPERS ===
// Loads pdf.js once from CDN, then extracts text from a File object and runs
// kit-datasheet pattern matching to find standard curve range candidates.

var _pdfJsLoadPromise = null;
function ensurePdfJs(){
  if(_pdfJsLoadPromise) return _pdfJsLoadPromise;
  _pdfJsLoadPromise = new Promise(function(resolve, reject){
    if(typeof window === "undefined"){ reject(new Error("PDF parsing requires a browser")); return; }
    if(window.pdfjsLib){ resolve(window.pdfjsLib); return; }
    var s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = function(){
      if(window.pdfjsLib){
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      } else {
        reject(new Error("pdf.js loaded but window.pdfjsLib not available"));
      }
    };
    s.onerror = function(){ reject(new Error("Failed to load pdf.js from CDN. Check your internet connection.")); };
    document.head.appendChild(s);
  });
  return _pdfJsLoadPromise;
}

function extractKitFieldsFromText(rawText){
  // Look for standard-curve range patterns and key kit metadata.
  // Return array of candidates with label, lo, hi, unit, confidence, raw matched string.
  var candidates = [];
  var text = rawText.replace(/\s+/g, " "); // normalize whitespace

  // Pattern 1: "X – Y unit/mL" or "X-Y unit/mL" or "X to Y unit/mL"
  // Allow en-dash, em-dash, hyphen, "to"
  var rangePattern = /(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)\s*(pg|ng|μg|ug|µg|mg)\s*\/\s*m?[Ll]/g;
  var m;
  while((m = rangePattern.exec(text)) !== null){
    var lo = parseFloat(m[1]), hi = parseFloat(m[2]);
    if(lo >= hi || lo <= 0) continue;
    if(hi/lo > 100000) continue; // implausible range
    var unit = (m[3].replace("μ","u").replace("µ","u")) + "/mL";
    // Try to find context — what was the 80 chars before this match about?
    var matchStart = m.index;
    var context = text.substring(Math.max(0, matchStart-80), matchStart).toLowerCase();
    var label = "Range mentioned";
    var confidence = 0.4;
    if(/standard curve|linear range|dynamic range|working range|assay range|measuring range/.test(context)){
      label = "Standard curve range";
      confidence = 0.9;
    } else if(/sensitivity|detection limit|lod|lloq|uloq/.test(context)){
      continue; // single-value patterns elsewhere
    } else if(/dilution|matrix/.test(context)){
      continue;
    }
    candidates.push({label:label, lo:lo, hi:hi, unit:unit, confidence:confidence, raw:m[0], context:context.trim().slice(-50)});
  }

  // Pattern 2: 8-point or 7-point standards with two-fold or three-fold dilutions
  // Find a top standard and infer the bottom: "top standard 1000 pg/mL with 2-fold dilutions" etc.
  var topPattern = /(?:top|highest|first)?\s*standard[^.]{0,30}?(\d+(?:\.\d+)?)\s*(pg|ng|ug|µg|μg|mg)\s*\/\s*m?[Ll]/gi;
  while((m = topPattern.exec(text)) !== null){
    // not adding here unless we also see step factor — skip for now to avoid noise
  }

  // Pattern 3: LLOQ / sensitivity values (single number)
  var lloqPattern = /(?:LLOQ|sensitivity|minimum detectable|MDD|LOD|limit of detection)[:\s]*(?:is|of|=|:)?\s*(\d+(?:\.\d+)?)\s*(pg|ng|ug|µg|μg|mg)\s*\/\s*m?[Ll]/gi;
  while((m = lloqPattern.exec(text)) !== null){
    var val = parseFloat(m[1]);
    var unit2 = m[2].replace("μ","u").replace("µ","u") + "/mL";
    candidates.push({label:"LLOQ / sensitivity", lo:val, hi:null, unit:unit2, confidence:0.7, raw:m[0]});
  }

  // De-duplicate
  var seen = {};
  var deduped = [];
  candidates.forEach(function(c){
    var key = c.label + "|" + c.lo + "|" + c.hi + "|" + c.unit;
    if(!seen[key]){ seen[key]=1; deduped.push(c); }
  });
  // Sort by confidence
  deduped.sort(function(a,b){return b.confidence - a.confidence;});
  return deduped;
}

async function parsePdfFile(file){
  var pdfjsLib = await ensurePdfJs();
  var arrayBuffer = await file.arrayBuffer();
  var pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  var fullText = "";
  for(var pn=1; pn<=Math.min(pdf.numPages, 30); pn++){
    var page = await pdf.getPage(pn);
    var content = await page.getTextContent();
    var pageText = content.items.map(function(it){return it.str;}).join(" ");
    fullText += " " + pageText;
  }
  var candidates = extractKitFieldsFromText(fullText);
  return {fileName: file.name, candidates: candidates, rawText: fullText.slice(0, 5000)};
}

function ElisaDesignerCard(props){
  // === STATE ===
  // Top-level mode selector
  var _md = useState("plan");
  var mode = _md[0], setMode = _md[1];

  // Mode 1: Plan
  var _planSt = useState({
    curveLo: "",
    curveHi: "",
    curveUnit: "pg/mL",
    estimateMode: "unknown", // "value" | "range" | "unknown"
    estimateVal: "",
    estimateLo: "",
    estimateHi: "",
    estimateUnit: "pg/mL",
    kit: "custom",
    workingVol: "200",
    pdfExtracted: null, // {fileName, candidates: [{label, value, unit}], rawText: "..."}
    pdfParsing: false,
    pdfError: "",
  });
  var planSt = _planSt[0], setPlanSt = _planSt[1];
  var pu = function(k,v){setPlanSt(function(p){var n={};for(var x in p)n[x]=p[x];n[k]=v;return n;});};

  // Mode 2: Pilot interpretation
  var _pilotSt = useState({
    curveLo: "",
    curveHi: "",
    curveUnit: "pg/mL",
    rows: [
      {dilution: "5", signal: "", note: ""},
      {dilution: "50", signal: "", note: ""},
      {dilution: "500", signal: "", note: ""},
      {dilution: "5000", signal: "", note: ""},
      {dilution: "50000", signal: "", note: ""},
    ],
  });
  var pilotSt = _pilotSt[0], setPilotSt = _pilotSt[1];
  var ppu = function(k,v){setPilotSt(function(p){var n={};for(var x in p)n[x]=p[x];n[k]=v;return n;});};
  var pilotRowU = function(idx, k, v){
    setPilotSt(function(p){
      var rows = p.rows.slice();
      rows[idx] = Object.assign({}, rows[idx], (function(){var o={};o[k]=v;return o;})());
      return Object.assign({}, p, {rows: rows});
    });
  };
  var addPilotRow = function(){
    setPilotSt(function(p){return Object.assign({}, p, {rows: p.rows.concat([{dilution:"", signal:"", note:""}])});});
  };
  var removePilotRow = function(idx){
    setPilotSt(function(p){
      if(p.rows.length<=1) return p;
      var rows = p.rows.slice(); rows.splice(idx,1); return Object.assign({},p,{rows:rows});
    });
  };

  // Mode 3: Execute
  var _execSt = useState({
    mrd: "",
    sampleVol: "100",
    diluentVol: "",
    finalVol: "200",
    safetyBracket: "yes",
  });
  var execSt = _execSt[0], setExecSt = _execSt[1];
  var eu = function(k,v){setExecSt(function(p){var n={};for(var x in p)n[x]=p[x];n[k]=v;return n;});};

  // === KIT PRESETS ===
  var KIT_PRESETS = {
    custom: {label:"Custom / not listed", desc:"", category:""},

    // ==== HOST CELL PROTEIN (HCP) — Bioprocess impurity assays ====
    "cygnus_cho_3g":   {label:"Cygnus CHO HCP, 3G (F550-1)",          curveLo:"1",     curveHi:"40",   unit:"ng/mL", desc:"3rd-gen broad-coverage CHO HCP. LLOQ ≈1 ng/mL, top standard 40 ng/mL. Use for first-time CHO HCP work.", category:"HCP (bioprocess impurity)"},
    "cygnus_cho_2g":   {label:"Cygnus CHO Lysate HCP, 2G (F1045)",    curveLo:"3.2",   curveHi:"200",  unit:"ng/mL", desc:"2nd-gen CHO Lysate HCP — replacement for original F015. Useful when 3G coverage is insufficient.", category:"HCP (bioprocess impurity)"},
    "cygnus_hek_3g":   {label:"Cygnus HEK 293 HCP, 3G (F650S)",       curveLo:"1.6",   curveHi:"100",  unit:"ng/mL", desc:"HEK 293 host cell protein impurity assay. Use for AAV/gene therapy or HEK-expressed biologics.", category:"HCP (bioprocess impurity)"},
    "cygnus_ecoli":    {label:"Cygnus E. coli HCP (F410)",            curveLo:"3.2",   curveHi:"200",  unit:"ng/mL", desc:"E. coli host cell protein impurity assay.", category:"HCP (bioprocess impurity)"},

    // ==== AFFINITY LIGAND RESIDUALS — for mAb/scFv purification ====
    "cygnus_proa_natural":   {label:"Cygnus Protein A Mix-N-Go, natural (F600)",     curveLo:"0.5",  curveHi:"100", unit:"ng/mL", desc:"Residual Protein A in mAb purification — natural & conserved recombinant constructs. No boil/centrifuge step.", category:"Affinity ligand residuals (mAb/scFv)"},
    "cygnus_proa_mss":       {label:"Cygnus Protein A Mix-N-Go, unnatural / MSS (F610)",  curveLo:"0.5", curveHi:"100", unit:"ng/mL", desc:"Residual MabSelect SuRe™ and other unnatural Protein A constructs. No boil/centrifuge step.", category:"Affinity ligand residuals (mAb/scFv)"},
    "cygnus_prol":           {label:"Cygnus Protein L Mix-N-Go (F750)",                curveLo:"0.5", curveHi:"100", unit:"ng/mL", desc:"Residual Protein L (κ light-chain affinity, common in scFv / Fab purification).", category:"Affinity ligand residuals (mAb/scFv)"},

    // ==== GFP / fluorescent reporters ====
    "ab_gfp_fast":     {label:"Abcam GFP SimpleStep ELISA, 90-min (ab171581) — FAST",   curveLo:"18.8", curveHi:"1200", unit:"pg/mL", desc:"Single-wash 90-min mix-wash-read kit. Sensitivity 2.8 pg/mL, recommended starting concentration 1200 pg/mL. Tissue & cell lysate.", category:"GFP / fluorescent reporters"},
    "ab_gfp_fluor":    {label:"Abcam GFP Fluorescent SimpleStep (ab229403)",            curveLo:"15.6", curveHi:"1000", unit:"pg/mL", desc:"Fluorescent readout version. Sensitivity 2.1 pg/mL. Same antibody pair as ab171581.", category:"GFP / fluorescent reporters"},
    "cellbiolabs_gfp": {label:"Cell Biolabs GFP ELISA (AKR-121)",                       curveLo:"15.6", curveHi:"1000", unit:"pg/mL", desc:"Sandwich GFP quantitation kit. Standards in pg/mL range.", category:"GFP / fluorescent reporters"},

    // ==== Common cytokines / inflammatory markers ====
    "rd_il6":  {label:"R&D Systems Human IL-6 Quantikine (D6050)",  curveLo:"3.13", curveHi:"300", unit:"pg/mL", desc:"Standards: 3.13–300 pg/mL. Serum: 1:2 dilution recommended.", category:"Cytokines / soluble factors"},
    "rd_tnfa": {label:"R&D Systems Human TNF-α Quantikine (DTA00D)", curveLo:"15.6", curveHi:"1000", unit:"pg/mL", desc:"Standards: 15.6–1000 pg/mL. Most matrices used neat.", category:"Cytokines / soluble factors"},
    "ab_ifng": {label:"Abcam Human IFN-γ ELISA (ab46025)",          curveLo:"4.7",  curveHi:"300", unit:"pg/mL", desc:"Standards: 4.7–300 pg/mL. Sample diluent provided.", category:"Cytokines / soluble factors"},
    "rd_vegf": {label:"R&D Systems Human VEGF Quantikine (DVE00)",  curveLo:"31.2", curveHi:"2000", unit:"pg/mL", desc:"Standards: 31.2–2000 pg/mL.", category:"Cytokines / soluble factors"},
    "thermo_crp": {label:"Thermo Human CRP ELISA (KHA0031)",        curveLo:"0.156", curveHi:"10", unit:"ng/mL", desc:"Standards: 0.156–10 ng/mL. Serum typically 1:100.", category:"Cytokines / soluble factors"},
  };

  // === MATH HELPERS ===
  var parseNum = function(v){var n=parseFloat(v); return isNaN(n)?null:n;};

  // Convert a value to pg/mL for unified comparison
  var toPgMl = function(v, unit){
    if(v==null) return null;
    var f={"pg/mL":1, "pg/uL":1000, "ng/mL":1000, "ng/uL":1e6, "ug/mL":1e6, "ug/uL":1e9, "mg/mL":1e9, "mg/L":1e6};
    return v*(f[unit]||1);
  };

  // Convert from pg/mL to a target unit
  var fromPgMl = function(v, unit){
    if(v==null) return null;
    var f={"pg/mL":1, "pg/uL":1000, "ng/mL":1000, "ng/uL":1e6, "ug/mL":1e6, "ug/uL":1e9, "mg/mL":1e9, "mg/L":1e6};
    return v/(f[unit]||1);
  };

  // === PLAN MODE COMPUTATION ===
  var planResult = (function(){
    if(planSt.estimateMode==="unknown" && (!parseNum(planSt.curveLo) || !parseNum(planSt.curveHi))) return null;
    var loCurve = toPgMl(parseNum(planSt.curveLo), planSt.curveUnit);
    var hiCurve = toPgMl(parseNum(planSt.curveHi), planSt.curveUnit);
    if(!loCurve || !hiCurve || hiCurve<=loCurve) return null;

    var loSamp, hiSamp, uncertainty, knownEstimate;
    if(planSt.estimateMode==="value"){
      var v = toPgMl(parseNum(planSt.estimateVal), planSt.estimateUnit);
      if(!v) return null;
      loSamp = v*0.5; hiSamp = v*2; // ±2-fold safety on a single estimate
      uncertainty = "low";
      knownEstimate = v;
    } else if(planSt.estimateMode==="range"){
      var l = toPgMl(parseNum(planSt.estimateLo), planSt.estimateUnit);
      var h = toPgMl(parseNum(planSt.estimateHi), planSt.estimateUnit);
      if(!l || !h || h<=l) return null;
      loSamp = l*0.5; hiSamp = h*2;
      uncertainty = h/l > 100 ? "high" : "medium";
      knownEstimate = (l+h)/2;
    } else {
      // unknown: assume a typical biopharma sample that could be from sub-curve up to ~1000x curve top
      // (covers most analyte/matrix combos without going crazy)
      loSamp = loCurve;
      hiSamp = hiCurve * 1000;
      uncertainty = "high";
      knownEstimate = null;
    }
    // Strategy: pick a starting dilution + step + count of dilutions
    // Goal: bracket [loSamp, hiSamp] with the curve range [loCurve, hiCurve] reaching at least one well.
    // For each dilution D, the well concentration = sample_conc / D. We want at least one D where:
    //   loCurve <= sample_conc/D <= hiCurve, for sample_conc in [loSamp, hiSamp]
    // Equivalently: for some D, sample_conc in [D*loCurve, D*hiCurve]
    // Coverage of the dilution series = union over D of [D*loCurve, D*hiCurve]
    // We want this to cover [loSamp, hiSamp]
    // For step factor f, sequential D values give coverage gaps if f > hiCurve/loCurve

    var curveRatio = hiCurve / loCurve;
    var sampSpan = hiSamp / loSamp;
    // step size: choose f <= curveRatio so sequential dilutions don't leave gaps
    var step;
    if(uncertainty==="high"){
      step = Math.min(curveRatio, 10); // log-step but don't overshoot curve range
    } else if(uncertainty==="medium"){
      step = Math.min(curveRatio, 5);
    } else {
      step = Math.min(curveRatio, 3);
    }
    // Number of points needed to cover sampSpan
    var nPoints = Math.max(3, Math.ceil(Math.log(sampSpan)/Math.log(step)) + 1);
    // Cap at 8 (since you fit on a column of a 96-well plate)
    if(nPoints > 8) nPoints = 8;
    // Starting dilution: place most-dilute sample at top of curve.
    // For unknown samples, start moderate (1:5 typical for kits) — this gives coverage even for low-abundance analytes.
    var dStart;
    if(planSt.estimateMode==="unknown"){
      dStart = 5; // standard kit minimum dilution
    } else {
      dStart = Math.max(1, hiSamp / hiCurve);
    }
    // Round to a clean number
    var roundClean = function(x){
      if(x<2) return 1;
      if(x<3) return 2;
      if(x<7) return 5;
      if(x<15) return 10;
      if(x<30) return 20;
      if(x<70) return 50;
      if(x<150) return 100;
      if(x<350) return 250;
      if(x<700) return 500;
      if(x<1500) return 1000;
      if(x<3500) return 2500;
      if(x<7500) return 5000;
      var pow = Math.pow(10, Math.floor(Math.log10(x)));
      return Math.round(x/pow)*pow;
    };
    dStart = roundClean(dStart);
    step = Math.round(step*10)/10;
    // Build the dilution series
    var series = [];
    for(var i=0; i<nPoints; i++){
      var D = dStart * Math.pow(step, i);
      D = Math.round(D*100)/100;
      // Compute well concentration range for this dilution given sample uncertainty
      var minWell = loSamp / D;
      var maxWell = hiSamp / D;
      // Is at least part of [minWell, maxWell] within [loCurve, hiCurve]?
      var inRange = (minWell <= hiCurve) && (maxWell >= loCurve);
      var displayMinWell = Math.max(minWell, loCurve);
      var displayMaxWell = Math.min(maxWell, hiCurve);
      series.push({
        dilution: D,
        minWellPgMl: minWell,
        maxWellPgMl: maxWell,
        inRange: inRange,
        coversSampleAtTop: D*hiCurve, // sample conc such that this dilution puts well at top of curve
        coversSampleAtBottom: D*loCurve, // sample conc such that this dilution puts well at bottom of curve
      });
    }
    // On-plate serial dilution: column-down (A1 → H1).
    // Well 1 holds the FIRST dilution (1:dStart), made by adding Vsample µL of neat sample to diluent.
    // Wells 2…N have Vf-Vt of diluent pre-loaded, receive Vt from well above, then transfer Vt down.
    // Each step multiplies the dilution by `step` (uniform serial dilution).
    // For arbitrary dStart, the first well loads (Vf+Vt)/dStart of neat sample + the rest as diluent.
    // If that volume is too small to pipette, a pre-dilution is required.
    var Vf = parseNum(planSt.workingVol) || 200;
    var ROW_LETTERS = ["A","B","C","D","E","F","G","H"];
    var Vt = Vf / step; // constant transfer volume — gives step-fold dilution at each well-to-well step
    Vt = Math.round(Vt*100)/100;
    var Vd = Math.round((Vf - Vt)*100)/100; // diluent pre-load for wells 2…N
    var firstWellTotal = Vf + Vt; // first well needs extra so transfer out leaves Vf
    var Vsample = firstWellTotal / dStart;
    Vsample = Math.round(Vsample*100)/100;
    var firstWellDiluent = Math.round((firstWellTotal - Vsample)*100)/100;
    // If Vsample is impractically small, suggest a pre-dilution
    var preDilutionNeeded = Vsample < 2 && dStart > 1;
    var preDilutionFactor = 0;
    var preDilutedSampleVol = 0;
    var preDilutedDiluentVol = 0;
    if(preDilutionNeeded){
      // Pick a pre-dilution that brings Vsample to at least ~10µL (a comfortable pipette volume)
      // We want: firstWellTotal / preDilutionFactor / dStart' = "comfortable Vsample"
      // where dStart' is the effective starting dilution after pre-dilution.
      // Simpler: pick a pre-dilution factor P such that firstWellTotal/P × P/dStart = sample volume
      // Wait, with pre-dilution at factor P: Well 1 receives "pre-diluted" sample (already at 1:P concentration).
      // To achieve final 1:dStart in Well 1, we need to dilute the pre-diluted material by dStart/P more.
      // Vsample_predil / firstWellTotal × (1/P) = 1/dStart → Vsample_predil = firstWellTotal × P / dStart
      // We want Vsample_predil ≥ 10. So P ≥ 10 × dStart / firstWellTotal.
      preDilutionFactor = Math.ceil(10 * dStart / firstWellTotal);
      // Round to a clean number (10, 20, 50, 100, ...)
      var cleanP = [10, 20, 50, 100, 200, 500, 1000];
      for(var ci=0; ci<cleanP.length; ci++){if(cleanP[ci] >= preDilutionFactor){preDilutionFactor = cleanP[ci]; break;}}
      // Pre-dilution made in a small tube: typically 1 mL = 1000 µL working volume.
      var preVol = 1000;
      preDilutedSampleVol = Math.round((preVol / preDilutionFactor)*100)/100;
      preDilutedDiluentVol = preVol - preDilutedSampleVol;
      // Recompute Vsample (now from pre-diluted source)
      Vsample = firstWellTotal * preDilutionFactor / dStart;
      Vsample = Math.round(Vsample*100)/100;
      firstWellDiluent = Math.round((firstWellTotal - Vsample)*100)/100;
    }
    var bench = [];
    for(var bi=0; bi<series.length; bi++){
      var thisD = series[bi].dilution;
      var wellLabel = (ROW_LETTERS[bi] || ("Row"+(bi+1))) + "1";
      var prevWellLabel = bi===0 ? null : ((ROW_LETTERS[bi-1] || ("Row"+bi)) + "1");
      var nextWellLabel = bi<series.length-1 ? ((ROW_LETTERS[bi+1] || ("Row"+(bi+2))) + "1") : null;
      if(bi===0){
        // First well: receives sample (or pre-diluted sample) + diluent
        bench.push({
          wellLabel: wellLabel,
          dilution: thisD,
          isFirst: true,
          sampleVol: Vsample,
          diluentVol: firstWellDiluent,
          sampleSource: preDilutionNeeded ? ("pre-diluted sample (1:"+preDilutionFactor+")") : "neat sample",
          totalAtStart: firstWellTotal,
          transferOut: nextWellLabel ? Vt : 0,
          nextWell: nextWellLabel,
          feasible: Vsample >= 2,
        });
      } else {
        // Receiving well: pre-load Vd diluent, receive Vt from prev well
        bench.push({
          wellLabel: wellLabel,
          dilution: thisD,
          isFirst: false,
          preload: Vd,
          transferIn: Vt,
          transferInFrom: prevWellLabel,
          transferOut: nextWellLabel ? Vt : 0,
          nextWell: nextWellLabel,
          feasible: Vt >= 2,
        });
      }
    }
    var benchWarn = "";
    if(Vt < 2) benchWarn = "Well-to-well transfer is "+sig3(Vt)+" µL — this is hard to pipette accurately. Increase working volume above (try 250 or 300 µL), or expect higher CVs.";
    else if(firstWellTotal > 320) benchWarn = "Well 1 needs "+sig3(firstWellTotal)+" µL initially, which exceeds typical 96-well capacity (~300 µL). Decrease your final volume per well, or use a deeper-well plate for the dilution column.";
    return {
      loCurvePgMl: loCurve,
      hiCurvePgMl: hiCurve,
      loSampPgMl: loSamp,
      hiSampPgMl: hiSamp,
      uncertainty: uncertainty,
      knownEstimatePgMl: knownEstimate,
      step: step,
      nPoints: nPoints,
      dStart: dStart,
      series: series,
      benchProtocol: bench,
      workingVol: Vf,
      transferVol: Vt,
      preDilutionNeeded: preDilutionNeeded,
      preDilutionFactor: preDilutionFactor,
      preDilutedSampleVol: preDilutedSampleVol,
      preDilutedDiluentVol: preDilutedDiluentVol,
      benchWarn: benchWarn,
    };
  })();

  // === PILOT MODE COMPUTATION ===
  var pilotResult = (function(){
    var loCurve = toPgMl(parseNum(pilotSt.curveLo), pilotSt.curveUnit);
    var hiCurve = toPgMl(parseNum(pilotSt.curveHi), pilotSt.curveUnit);
    if(!loCurve || !hiCurve) return null;
    // For each row: classify
    var classifiedRows = pilotSt.rows.map(function(r){
      var D = parseNum(r.dilution);
      var sig = parseNum(r.signal);
      if(D==null || sig==null) return Object.assign({}, r, {status:"empty"});
      // Compare signal magnitude to curve range loosely. Without a curve fit, use heuristic:
      // signal < 5% of full-scale → below LLOQ. signal > 90% of full-scale → above ULOQ.
      // We don't actually have full-scale signal, so we ask user to mark "below/in/above" instead via signal.
      // For this pilot interpretation, the user enters approximate well concentration if calc'd, or signal+context.
      // Simpler approach: ask them to input their CALCULATED well concentration directly.
      // signal column = back-calculated well conc.
      var wellConc = sig;
      var inRange = wellConc >= loCurve && wellConc <= hiCurve;
      var aboveUloq = wellConc > hiCurve;
      var belowLloq = wellConc < loCurve;
      var sampleConc = wellConc * D;
      return Object.assign({}, r, {
        status: inRange ? "in" : (aboveUloq ? "above" : "below"),
        wellConc: wellConc,
        sampleConc: sampleConc,
      });
    });
    // Find dilutional linearity: look at consecutive in-range rows and check sample-conc ratio
    var linearityChecks = [];
    var inRangeRows = classifiedRows.filter(function(r){return r.status==="in";});
    for(var i=0; i<inRangeRows.length-1; i++){
      var a = inRangeRows[i], b = inRangeRows[i+1];
      if(!a.sampleConc || !b.sampleConc) continue;
      var ratio = b.sampleConc / a.sampleConc;
      var pctRecovery = ratio*100;
      linearityChecks.push({
        from: parseNum(a.dilution),
        to: parseNum(b.dilution),
        ratio: ratio,
        pctRecovery: pctRecovery,
        ok: pctRecovery>=80 && pctRecovery<=120,
      });
    }
    // MRD recommendation: most concentrated (lowest D) dilution that's in-range AND has linearity ok with at least one neighbor
    var mrd = null, mrdReason = "";
    var inRangeAndLinear = inRangeRows.filter(function(r,idx){
      // is there a dilution-linearity check involving this row that passed?
      var D = parseNum(r.dilution);
      var passes = linearityChecks.some(function(lc){return (lc.from===D || lc.to===D) && lc.ok;});
      return passes;
    });
    if(inRangeAndLinear.length){
      // pick lowest D
      mrd = inRangeAndLinear.reduce(function(best, r){
        var D = parseNum(r.dilution);
        if(!best || D < parseNum(best.dilution)) return r;
        return best;
      }, null);
      mrdReason = "This is the most concentrated (lowest dilution) reading that lands in your standard curve range AND shows acceptable dilutional linearity (80–120%) with a neighboring dilution.";
    } else if(inRangeRows.length){
      mrd = inRangeRows[0];
      mrdReason = "No two consecutive in-range readings showed acceptable dilutional linearity. The recommended MRD is the most concentrated in-range reading, but consider re-running the pilot with closer-spaced dilutions to verify.";
    }
    return {
      loCurvePgMl: loCurve,
      hiCurvePgMl: hiCurve,
      classifiedRows: classifiedRows,
      linearityChecks: linearityChecks,
      mrd: mrd,
      mrdReason: mrdReason,
    };
  })();

  // === EXECUTE MODE COMPUTATION ===
  var execResult = (function(){
    var mrd = parseNum(execSt.mrd);
    if(!mrd || mrd<1) return null;
    var fv = parseNum(execSt.finalVol);
    var sv = parseNum(execSt.sampleVol);
    if(!fv || !sv) return null;
    // For dilution D, sample vol such that D = total/sample, so sample = total/D
    var bracket = execSt.safetyBracket==="yes" ? [mrd/2, mrd, mrd*2] : [mrd];
    var protocol = bracket.map(function(D){
      var sampleVolNeeded = fv/D;
      var diluentVol = fv - sampleVolNeeded;
      var feasible = sampleVolNeeded >= 1; // 1 uL minimum
      var note = "";
      if(sampleVolNeeded < 1) note = "Sample volume too small (<1 µL). Use a larger final volume or pre-dilute the sample.";
      else if(sampleVolNeeded < 2) note = "Sample volume tight (<2 µL). Consider increasing final volume.";
      return {dilution: D, sampleVol: sampleVolNeeded, diluentVol: diluentVol, feasible: feasible, note: note};
    });
    return {protocol: protocol};
  })();

  // === STYLE ===
  var card = {background:"#fff", borderRadius:16, border:"1px solid "+BORDER, boxShadow:"0 8px 22px rgba(11,42,111,0.04)", overflow:"hidden", marginBottom:"1rem"};
  var hdr = {background:"linear-gradient(135deg,#BF7A1A,#0B2A6F)", color:"#fff", padding:"14px 18px"};
  var hdrTitle = {fontSize:15, fontWeight:800, letterSpacing:0.3};
  var hdrSub = {fontSize:11, opacity:0.85, marginTop:2};
  var body = {padding:"1.25rem"};
  var inputBox = {padding:"9px 12px", borderRadius:8, border:"1px solid #d8dfeb", fontSize:14, fontFamily:"inherit", outline:"none", width:"100%", boxSizing:"border-box"};
  var monoInputBox = Object.assign({}, inputBox, {fontFamily:"monospace"});
  var selectBox = Object.assign({}, inputBox, {background:"#fff"});
  var labelStyle = {display:"block", fontSize:11, fontWeight:700, color:"#30437a", marginBottom:5, textTransform:"uppercase", letterSpacing:0.4};
  var sectionH = {fontSize:13, fontWeight:800, color:"#0b2a6f", margin:"18px 0 10px", paddingBottom:6, borderBottom:"1px solid #eef2f7"};

  // === RENDER ===
  return <div style={card}>
    <div style={hdr}>
      <div style={hdrTitle}>ELISA Designer</div>
      <div style={hdrSub}>Plan dilution schemes, interpret pilot runs, and lay out the real plate.</div>
    </div>

    {/* Mode tabs */}
    <div style={{borderBottom:"1px solid "+BORDER, background:"#fafbfd", display:"flex", gap:0}}>
      {[
        {id:"plan",  num:"1", label:"Plan a pilot",       hint:"design the dilution series"},
        {id:"pilot", num:"2", label:"Read pilot results", hint:"pick the working dilution"},
        {id:"exec",  num:"3", label:"Run the experiment", hint:"final pipetting protocol"},
      ].map(function(t,i){
        var active = mode===t.id;
        return <button key={t.id} onClick={function(){setMode(t.id);}} style={{
          flex:1,
          padding:"12px 14px",
          background:active?"#fff":"transparent",
          border:"none",
          borderRight:i<2?"1px solid "+BORDER:"none",
          borderBottom: active ? "3px solid #BF7A1A" : "3px solid transparent",
          cursor:"pointer",
          textAlign:"left",
          fontFamily:"inherit",
          color:active?"#0b2a6f":"#6e6e73"
        }}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:22, height:22, borderRadius:11, background:active?"#BF7A1A":"#dadce4", color:"#fff", fontSize:11, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center"}}>{t.num}</span>
            <span style={{fontSize:13, fontWeight:700}}>{t.label}</span>
          </div>
          <div style={{fontSize:10, color:"#aeaeb2", marginTop:2, marginLeft:30}}>{t.hint}</div>
        </button>;
      })}
    </div>

    <div style={body}>
      {/* === MODE 1: PLAN === */}
      {mode==="plan" && <div>
        <p style={{fontSize:13, color:"#5a6984", lineHeight:1.6, margin:"0 0 16px"}}>
          Tell us about your kit and your sample. We'll design a pilot dilution series that brackets your sample's likely concentration and lands at least one well in your standard curve.
        </p>

        {/* Kit picker */}
        <div style={{display:"grid", gridTemplateColumns:"1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle}>Kit (optional)</label>
            <select value={planSt.kit} onChange={function(e){
              var v=e.target.value; pu("kit",v);
              var p = KIT_PRESETS[v];
              if(p && v!=="custom"){
                pu("curveLo", p.curveLo); pu("curveHi", p.curveHi); pu("curveUnit", p.unit);
              }
            }} style={selectBox}>
              {(function(){
                // Group kits by category (custom first, then by category in order of appearance)
                var groups = {};
                var groupOrder = [];
                Object.keys(KIT_PRESETS).forEach(function(k){
                  var cat = KIT_PRESETS[k].category || "";
                  if(!groups[cat]){ groups[cat]=[]; groupOrder.push(cat); }
                  groups[cat].push(k);
                });
                return groupOrder.map(function(cat){
                  if(!cat) return groups[cat].map(function(k){return <option key={k} value={k}>{KIT_PRESETS[k].label}</option>;});
                  return <optgroup key={cat} label={cat}>
                    {groups[cat].map(function(k){return <option key={k} value={k}>{KIT_PRESETS[k].label}</option>;})}
                  </optgroup>;
                });
              })()}
            </select>
            {planSt.kit!=="custom" && <div style={{fontSize:11, color:"#6e6e73", marginTop:4, fontStyle:"italic"}}>{KIT_PRESETS[planSt.kit].desc}</div>}
          </div>
        </div>

        {/* PDF kit-document upload */}
        <div style={{display:"grid", gridTemplateColumns:"1fr", gap:8, marginBottom:14}}>
          <div style={{padding:"12px 14px", border:"1px dashed #c5d3e8", borderRadius:10, background:"#fafbfd"}}>
            <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap"}}>
              <div style={{flex:"1 1 280px"}}>
                <div style={{fontSize:12, fontWeight:700, color:"#30437a", marginBottom:2}}>Or upload your kit's SOP / datasheet (PDF)</div>
                <div style={{fontSize:10, color:"#6e6e73", lineHeight:1.5}}>
                  We'll scan the text for "standard curve range", "LLOQ", and concentration ranges to pre-fill the fields below. Best-effort extraction — always verify against your kit insert.
                </div>
              </div>
              <input type="file" accept="application/pdf,.pdf" id="elisa-pdf-upload" style={{display:"none"}} onChange={function(e){
                var file = e.target.files && e.target.files[0];
                if(!file) return;
                pu("pdfParsing", true);
                pu("pdfError", "");
                pu("pdfExtracted", null);
                parsePdfFile(file).then(function(result){
                  pu("pdfParsing", false);
                  pu("pdfExtracted", result);
                }).catch(function(err){
                  pu("pdfParsing", false);
                  pu("pdfError", err.message || String(err));
                });
                // Reset input so same file can be reuploaded
                e.target.value = "";
              }} />
              <label htmlFor="elisa-pdf-upload" style={{background:"#fff", border:"1px solid #d8dfeb", padding:"8px 14px", borderRadius:8, color:"#30437a", fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap"}}>
                {planSt.pdfParsing ? "Parsing…" : "Choose PDF"}
              </label>
            </div>
            {planSt.pdfError && <div style={{marginTop:8, padding:"8px 10px", background:"#fde2dd", color:"#a02c1c", fontSize:11, borderRadius:6}}>⚠ {planSt.pdfError}</div>}
            {planSt.pdfExtracted && <div style={{marginTop:10}}>
              <div style={{fontSize:11, fontWeight:700, color:"#0f5c6a", marginBottom:6}}>Extracted from <span style={{fontFamily:"monospace"}}>{planSt.pdfExtracted.fileName}</span>:</div>
              {planSt.pdfExtracted.candidates.length===0 && <div style={{fontSize:11, color:"#6e6e73", fontStyle:"italic"}}>
                No standard curve range patterns found. Enter values manually below — kit datasheets vary widely in formatting and we can't catch them all.
              </div>}
              {planSt.pdfExtracted.candidates.length>0 && <div style={{display:"grid", gap:6}}>
                {planSt.pdfExtracted.candidates.slice(0,5).map(function(c,i){
                  return <div key={i} style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:"#fff", border:"1px solid #e5e5ea", borderRadius:6, fontSize:11, gap:10}}>
                    <div style={{flex:"1 1 auto"}}>
                      <span style={{fontWeight:700, color:"#30437a"}}>{c.label}: </span>
                      <span style={{fontFamily:"monospace", color:"#1a6b32"}}>{c.lo}{c.hi!=null ? " – "+c.hi : ""} {c.unit}</span>
                      {c.context && <div style={{fontSize:10, color:"#aeaeb2", marginTop:2, fontStyle:"italic"}}>"…{c.context}…"</div>}
                    </div>
                    {c.hi!=null && <button onClick={function(){
                      pu("curveLo", String(c.lo));
                      pu("curveHi", String(c.hi));
                      pu("curveUnit", c.unit);
                    }} style={{background:"#0F8AA2", border:"none", color:"#fff", padding:"5px 10px", borderRadius:6, fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap"}}>Use this range</button>}
                  </div>;
                })}
              </div>}
            </div>}
          </div>
        </div>

        {/* Curve range */}
        <h5 style={sectionH}>Standard curve range (from your kit datasheet)</h5>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle}>Lowest standard</label>
            <input value={planSt.curveLo} onChange={function(e){pu("curveLo",e.target.value);}} placeholder="e.g. 7.8" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>Highest standard</label>
            <input value={planSt.curveHi} onChange={function(e){pu("curveHi",e.target.value);}} placeholder="e.g. 500" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={planSt.curveUnit} onChange={function(e){pu("curveUnit",e.target.value);}} style={selectBox}>
              {["pg/mL","pg/uL","ng/mL","ng/uL","ug/mL","ug/uL","mg/mL"].map(function(u){return <option key={u} value={u}>{u}</option>;})}
            </select>
          </div>
        </div>

        {/* Estimate */}
        <h5 style={sectionH}>What do you know about your sample's concentration?</h5>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, marginBottom:14}}>
          {[
            {id:"value", label:"I have a number", desc:"From a literature value or prior measurement"},
            {id:"range", label:"I have a range", desc:"e.g. \"between 1 and 100 ng/mL\""},
            {id:"unknown", label:"I have no idea", desc:"This is my first time with this sample"},
          ].map(function(opt){
            var active = planSt.estimateMode===opt.id;
            return <button key={opt.id} onClick={function(){pu("estimateMode", opt.id);}} style={{
              background: active ? "#fef9f1" : "#fff",
              border: "1.5px solid " + (active ? "#BF7A1A" : "#d8dfeb"),
              borderRadius:10, padding:"10px 12px", textAlign:"left", cursor:"pointer", fontFamily:"inherit"
            }}>
              <div style={{fontSize:12, fontWeight:800, color:active?"#8a4d05":"#30437a"}}>{opt.label}</div>
              <div style={{fontSize:10, color:"#6e6e73", marginTop:2, lineHeight:1.4}}>{opt.desc}</div>
            </button>;
          })}
        </div>
        {planSt.estimateMode==="value" && <div style={{display:"grid", gridTemplateColumns:"2fr 1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle}>Best-guess concentration</label>
            <input value={planSt.estimateVal} onChange={function(e){pu("estimateVal",e.target.value);}} placeholder="e.g. 100" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={planSt.estimateUnit} onChange={function(e){pu("estimateUnit",e.target.value);}} style={selectBox}>
              {["pg/mL","pg/uL","ng/mL","ng/uL","ug/mL","ug/uL","mg/mL"].map(function(u){return <option key={u} value={u}>{u}</option>;})}
            </select>
          </div>
        </div>}
        {planSt.estimateMode==="range" && <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle}>Low end</label>
            <input value={planSt.estimateLo} onChange={function(e){pu("estimateLo",e.target.value);}} placeholder="e.g. 10" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>High end</label>
            <input value={planSt.estimateHi} onChange={function(e){pu("estimateHi",e.target.value);}} placeholder="e.g. 1000" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={planSt.estimateUnit} onChange={function(e){pu("estimateUnit",e.target.value);}} style={selectBox}>
              {["pg/mL","pg/uL","ng/mL","ng/uL","ug/mL","ug/uL","mg/mL"].map(function(u){return <option key={u} value={u}>{u}</option>;})}
            </select>
          </div>
        </div>}

        {/* Result */}
        {planResult && <div style={{marginTop:18, paddingTop:18, borderTop:"2px solid "+BORDER}}>
          <div style={{fontSize:12, fontWeight:700, color:"#0f5c6a", textTransform:"uppercase", letterSpacing:0.5, marginBottom:10}}>Recommended pilot dilution series</div>

          {/* Number-line diagram */}
          <PlanDiagram result={planResult} planSt={planSt} fromPgMl={fromPgMl} />

          {/* Working volume input */}
          <div style={{marginTop:18, padding:"12px 14px", background:"#fff", border:"1px solid "+BORDER, borderRadius:10, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap"}}>
            <div style={{flex:"0 0 auto"}}>
              <label style={Object.assign({}, labelStyle, {marginBottom:4})}>Final volume per well</label>
              <div style={{display:"flex", alignItems:"center", gap:6}}>
                <input value={planSt.workingVol} onChange={function(e){pu("workingVol", e.target.value);}} style={Object.assign({}, monoInputBox, {width:80, padding:"6px 10px"})} />
                <span style={{fontSize:12, color:"#6e6e73"}}>µL</span>
              </div>
            </div>
            <div style={{flex:"1 1 200px", fontSize:11, color:"#6e6e73", lineHeight:1.5}}>
              How much liquid each well ends up with. 200 µL is typical for a 96-well plate (max well capacity ~360 µL). Larger volumes give you more accurate well-to-well transfers.
            </div>
          </div>

          {/* === BENCH PROTOCOL === on-plate serial dilution, column-down */}
          <div style={{marginTop:18}}>
            <BenchWorkflowDiagram result={planResult} dilFormat={dilFormat} setDilFormat={setDilFormat} />
          </div>

          {/* Apply-to-Data-Entry button: pushes the planned series into the General Info dilution fields */}
          {props.onApplyDilutions && (function(){
            // Compute what xdf/xds values to write into General Information.
            // The Plan series first row is at 1:dStart total (which already includes any pre-dilution),
            // and each subsequent row multiplies by `step`. So the "first row" for cfg is 1/dStart and
            // "subsequent rows" is 1/step.
            var xdfStr = "1/" + planResult.dStart;
            var xdsStr = "1/" + planResult.step;
            var firstLabel = fmtDilution(1/planResult.dStart, dilFormat, 100000);
            var stepLabel = fmtDilution(1/planResult.step, dilFormat, 100000);
            return <div style={{marginTop:14, padding:"14px 16px", background:"linear-gradient(135deg,#eaf6f8,#dff0f4)", border:"1.5px solid #0F8AA2", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"space-between", gap:14, flexWrap:"wrap"}}>
              <div style={{flex:"1 1 240px", fontSize:12, color:"#0f5c6a", lineHeight:1.6}}>
                <div style={{fontSize:12, fontWeight:800, color:"#0f5c6a", marginBottom:4, textTransform:"uppercase", letterSpacing:0.5}}>Use these dilutions for back-calculation?</div>
                Once you run the plate, the analyzer needs to know your sample dilutions to back-calculate concentrations. Click below to fill in the General Information fields:{" "}
                <span style={{display:"inline-block", marginTop:4, padding:"2px 8px", background:"#fff", border:"1px solid "+BORDER, borderRadius:4, fontFamily:"monospace", fontSize:11}}>Sample first row = <strong style={{color:"#0b2a6f"}}>{xdfStr}</strong> ({firstLabel}), subsequent rows = <strong style={{color:"#0b2a6f"}}>{xdsStr}</strong> ({stepLabel})</span>
              </div>
              <button onClick={function(){props.onApplyDilutions(xdfStr, xdsStr);}} style={{background:"linear-gradient(135deg,#0F8AA2,#0b2a6f)", color:"#fff", border:"none", padding:"10px 18px", borderRadius:10, fontSize:13, fontWeight:800, cursor:"pointer", boxShadow:"0 6px 14px rgba(15,138,162,0.25)", whiteSpace:"nowrap"}}>Apply to Data Entry →</button>
            </div>;
          })()}

          {/* Same protocol as a numerical table for users who prefer numbers (collapsed by default) */}
          <details style={{marginTop:10}}>
            <summary style={{fontSize:11, color:"#3478F6", fontWeight:600, cursor:"pointer"}}>Show as numerical table</summary>
            <div style={{marginTop:8, background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, overflow:"auto"}}>
              <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
                <thead>
                  <tr style={{background:"#0b2a6f", color:"#fff"}}>
                    <th style={{padding:"8px 10px", textAlign:"left", fontWeight:700, fontSize:11}}>Well</th>
                    <th style={{padding:"8px 10px", textAlign:"left", fontWeight:700, fontSize:11}}>Dilution</th>
                    <th style={{padding:"8px 10px", textAlign:"left", fontWeight:700, fontSize:11, minWidth:240}}>Step</th>
                    <th style={{padding:"8px 10px", textAlign:"left", fontWeight:700, fontSize:11}}>Then</th>
                  </tr>
                </thead>
                <tbody>
                  {planResult.benchProtocol.map(function(b,i){
                    var bg = b.feasible ? (i%2 ? "#fafbfd" : "#fff") : "#fde2dd";
                    var stepDesc, thenDesc;
                    if(b.isFirst){
                      stepDesc = <span>
                        Add <strong style={{fontFamily:"monospace", color:"#bf7a1a"}}>{sig3(b.sampleVol)} µL</strong> of {b.sampleSource}{b.diluentVol > 0 ? <span> + <strong style={{fontFamily:"monospace", color:"#0b2a6f"}}>{sig3(b.diluentVol)} µL</strong> diluent</span> : null}
                      </span>;
                    } else {
                      stepDesc = <span>
                        Pre-load <strong style={{fontFamily:"monospace", color:"#0b2a6f"}}>{sig3(b.preload)} µL</strong> diluent. Then transfer <strong style={{fontFamily:"monospace", color:"#bf7a1a"}}>{sig3(b.transferIn)} µL</strong> from <strong>{b.transferInFrom}</strong>, mix.
                      </span>;
                    }
                    if(b.transferOut > 0){
                      thenDesc = <span>Transfer <strong style={{fontFamily:"monospace"}}>{sig3(b.transferOut)} µL</strong> → <strong>{b.nextWell}</strong></span>;
                    } else {
                      thenDesc = <span style={{color:"#1a6b32", fontWeight:700}}>Last well — done</span>;
                    }
                    return <tr key={i} style={{borderTop:i?"1px solid #eef2f7":"none", background:bg}}>
                      <td style={{padding:"8px 10px", fontFamily:"monospace", fontWeight:800, color:"#30437a", fontSize:13, whiteSpace:"nowrap"}}>{b.wellLabel}</td>
                      <td style={{padding:"8px 10px", fontFamily:"monospace", fontWeight:700, color:"#6337b9", whiteSpace:"nowrap"}}>{fmtDilution(1/b.dilution, dilFormat, 100000)}</td>
                      <td style={{padding:"8px 10px", color:"#1d1d1f", fontSize:11, lineHeight:1.5}}>{stepDesc}</td>
                      <td style={{padding:"8px 10px", color:"#5a6984", fontSize:11, whiteSpace:"nowrap"}}>{thenDesc}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </details>

          {/* Dilution windows table — what each dilution detects */}
          <div style={{marginTop:18, fontSize:11, fontWeight:700, color:"#0b2a6f", textTransform:"uppercase", letterSpacing:0.5, marginBottom:8}}>What each well detects</div>
          <div style={{background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, overflow:"hidden"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
              <thead>
                <tr style={{background:"#eef3f8"}}>
                  <th style={{padding:"6px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Well</th>
                  <th style={{padding:"6px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Dilution</th>
                  <th style={{padding:"6px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Sample concentration this well can detect</th>
                </tr>
              </thead>
              <tbody>
                {planResult.series.map(function(s,i){
                  var loS = fromPgMl(s.coversSampleAtBottom, planSt.curveUnit);
                  var hiS = fromPgMl(s.coversSampleAtTop, planSt.curveUnit);
                  var wlbl = (["A","B","C","D","E","F","G","H"][i] || "Row"+(i+1)) + "1";
                  return <tr key={i} style={{borderTop:i?"1px solid #eef2f7":"none", background:s.inRange?"#fff":"#f4f4f6"}}>
                    <td style={{padding:"6px 10px", fontFamily:"monospace", fontWeight:700, color:"#30437a"}}>{wlbl}</td>
                    <td style={{padding:"6px 10px", fontFamily:"monospace"}}>{fmtDilution(1/s.dilution, dilFormat, 100000)}</td>
                    <td style={{padding:"6px 10px", color:"#5a6984"}}>{sig3(loS)} – {sig3(hiS)} {planSt.curveUnit}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>

          <div style={{marginTop:14, padding:"12px 14px", background:"#fff7e0", borderRadius:8, border:"1px solid #e8c77d", fontSize:12, color:"#5d4500", lineHeight:1.6}}>
            <div style={{fontWeight:800, marginBottom:4}}>Why these dilutions?</div>
            <div>Step factor: <strong>{planResult.step}×</strong>. Number of points: <strong>{planResult.nPoints}</strong>. Starting at <strong>1:{planResult.dStart}</strong>. {planResult.uncertainty==="high" ? "Because your sample's concentration is unknown, we use log-step (10×) dilutions to cover many orders of magnitude." : planResult.uncertainty==="medium" ? "Because your sample's concentration is somewhat uncertain, we use moderate steps to cover the range with redundancy." : "Because your sample's concentration is well-characterized, we use small steps (3×) for tight bracketing."} The step factor is also chosen so consecutive dilutions don't leave a gap larger than your standard curve's dynamic range.</div>
          </div>

          {/* Blank picker — visible to all */}
          <BlankPicker />

          {props.instructor && <BlanksGuide />}
        </div>}
      </div>}

      {/* === MODE 2: PILOT === */}
      {mode==="pilot" && <div>
        <p style={{fontSize:13, color:"#5a6984", lineHeight:1.6, margin:"0 0 10px"}}>
          You ran the pilot and back-calculated well concentrations from the standard curve. Enter them here, and we'll find your <strong>Minimum Required Dilution (MRD)</strong>.
        </p>
        <div style={{padding:"10px 12px", background:"#eefcfd", border:"1px solid #b8e0e6", borderRadius:8, marginBottom:16, fontSize:11, color:"#0f5c6a", lineHeight:1.6}}>
          <strong>What's an MRD?</strong> The Minimum Required Dilution is the most concentrated (least diluted) dilution of your sample that still gives accurate readings — meaning it lands inside your standard curve range AND shows dilutional linearity (consecutive dilutions agree on the implied sample concentration to within 80–120%). The MRD is what you'll actually use to run your real samples on the next plate. Diluting more than the MRD wastes signal; diluting less risks the hook effect or matrix interference.
        </div>

        <h5 style={sectionH}>Standard curve range</h5>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle}>Lowest standard</label>
            <input value={pilotSt.curveLo} onChange={function(e){ppu("curveLo",e.target.value);}} placeholder="e.g. 7.8" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>Highest standard</label>
            <input value={pilotSt.curveHi} onChange={function(e){ppu("curveHi",e.target.value);}} placeholder="e.g. 500" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={pilotSt.curveUnit} onChange={function(e){ppu("curveUnit",e.target.value);}} style={selectBox}>
              {["pg/mL","pg/uL","ng/mL","ng/uL","ug/mL","ug/uL","mg/mL"].map(function(u){return <option key={u} value={u}>{u}</option>;})}
            </select>
          </div>
        </div>

        <h5 style={sectionH}>Pilot results</h5>
        <div style={{background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, overflow:"hidden"}}>
          <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
            <thead>
              <tr style={{background:"#eef3f8"}}>
                <th style={{padding:"8px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Dilution (1:X)</th>
                <th style={{padding:"8px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Calc'd well conc ({pilotSt.curveUnit})</th>
                <th style={{padding:"8px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Status</th>
                <th style={{padding:"8px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Implied sample conc</th>
                <th style={{padding:"8px 10px"}}></th>
              </tr>
            </thead>
            <tbody>
              {pilotSt.rows.map(function(r,i){
                var classified = pilotResult ? pilotResult.classifiedRows[i] : null;
                var statusBg = "#f4f4f6", statusFg = "#6e6e73", statusLabel = "—";
                if(classified){
                  if(classified.status==="in"){ statusBg="#dcf3df"; statusFg="#1a6b32"; statusLabel="In range ✓"; }
                  else if(classified.status==="above"){ statusBg="#fde2dd"; statusFg="#a02c1c"; statusLabel="Above ULOQ ↑"; }
                  else if(classified.status==="below"){ statusBg="#fff3d6"; statusFg="#7a5800"; statusLabel="Below LLOQ ↓"; }
                }
                return <tr key={i} style={{borderTop:i?"1px solid #eef2f7":"none"}}>
                  <td style={{padding:6}}><input value={r.dilution} onChange={function(e){pilotRowU(i,"dilution",e.target.value);}} placeholder="1:50" style={Object.assign({},monoInputBox,{padding:"6px 8px",fontSize:12})} /></td>
                  <td style={{padding:6}}><input value={r.signal} onChange={function(e){pilotRowU(i,"signal",e.target.value);}} placeholder="value" style={Object.assign({},monoInputBox,{padding:"6px 8px",fontSize:12})} /></td>
                  <td style={{padding:6}}><span style={{padding:"4px 8px",borderRadius:4,background:statusBg,color:statusFg,fontSize:10,fontWeight:700}}>{statusLabel}</span></td>
                  <td style={{padding:6, fontSize:11, fontFamily:"monospace", color:"#5a6984"}}>{classified && classified.sampleConc!=null ? sig3(classified.sampleConc) + " " + pilotSt.curveUnit : "—"}</td>
                  <td style={{padding:6, textAlign:"right"}}>{pilotSt.rows.length>1 && <button onClick={function(){removePilotRow(i);}} style={{background:"transparent",border:"none",color:"#d70015",cursor:"pointer",fontSize:14,fontWeight:700}} title="Remove">×</button>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <button onClick={addPilotRow} style={{marginTop:10, background:"#fff", border:"1px dashed #d8dfeb", padding:"8px 14px", borderRadius:8, color:"#30437a", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit"}}>+ Add another dilution</button>

        {/* Linearity + MRD */}
        {pilotResult && pilotResult.linearityChecks.length > 0 && <div style={{marginTop:18}}>
          <div style={{fontSize:12, fontWeight:700, color:"#0f5c6a", textTransform:"uppercase", letterSpacing:0.5, marginBottom:10}}>Dilutional linearity check</div>
          <div style={{background:"#fff", borderRadius:10, border:"1px solid "+BORDER, padding:"10px 14px"}}>
            {pilotResult.linearityChecks.map(function(lc,i){
              return <div key={i} style={{display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", fontSize:12, borderTop:i?"1px solid #eef2f7":"none"}}>
                <span style={{color:"#5a6984"}}>1:{lc.from} → 1:{lc.to}: implied sample conc changed by <strong style={{fontFamily:"monospace"}}>{sig3(lc.pctRecovery)}%</strong></span>
                <span style={{padding:"3px 10px", borderRadius:12, fontSize:10, fontWeight:700, background: lc.ok ? "#dcf3df" : "#fde2dd", color: lc.ok ? "#1a6b32" : "#a02c1c"}}>{lc.ok ? "OK (80–120%)" : "OUTSIDE 80–120%"}</span>
              </div>;
            })}
          </div>
        </div>}
        {pilotResult && pilotResult.mrd && <div style={{marginTop:14, padding:"14px 16px", background:"linear-gradient(135deg,#eefcfd,#fff)", border:"1.5px solid #0F8AA2", borderRadius:10}}>
          <div style={{fontSize:11, fontWeight:700, color:"#0f5c6a", textTransform:"uppercase", letterSpacing:0.5, marginBottom:6}}>Recommended Minimum Required Dilution</div>
          <div style={{fontSize:24, fontWeight:800, color:"#0f5c6a", fontFamily:"monospace"}}>1:{pilotResult.mrd.dilution}</div>
          <div style={{fontSize:11, color:"#5a6984", marginTop:8, lineHeight:1.5}}>{pilotResult.mrdReason}</div>
          <button onClick={function(){eu("mrd", pilotResult.mrd.dilution); setMode("exec");}} style={{marginTop:10, background:"#0F8AA2", color:"#fff", border:"none", padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit"}}>Use this MRD in Step 3 →</button>
        </div>}

        {props.instructor && <HookEffectGuide />}
      </div>}

      {/* === MODE 3: EXECUTE === */}
      {mode==="exec" && <div>
        <p style={{fontSize:13, color:"#5a6984", lineHeight:1.6, margin:"0 0 16px"}}>
          Now run the real plate. Enter the MRD <span title="Minimum Required Dilution — the working dilution from Step 2" style={{borderBottom:"1px dotted #6e6e73", cursor:"help"}}>(working dilution)</span> from the pilot, and we'll generate your final pipetting protocol — including a safety bracket so one bad pipette doesn't tank your data.
        </p>

        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle} title="Minimum Required Dilution from your pilot run">MRD (1:X)</label>
            <input value={execSt.mrd} onChange={function(e){eu("mrd",e.target.value);}} placeholder="e.g. 100" style={monoInputBox} title="The working dilution you picked from your pilot results in Step 2" />
          </div>
          <div>
            <label style={labelStyle}>Final volume per dilution (µL)</label>
            <input value={execSt.finalVol} onChange={function(e){eu("finalVol",e.target.value);}} placeholder="200" style={monoInputBox} />
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Run a safety bracket?</label>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
            {[
              {id:"yes", label:"Yes — run MRD/2, MRD, MRD×2", desc:"Recommended. Catches matrix shifts."},
              {id:"no",  label:"No — just run the MRD", desc:"Saves wells but riskier."},
            ].map(function(opt){
              var active = execSt.safetyBracket===opt.id;
              return <button key={opt.id} onClick={function(){eu("safetyBracket",opt.id);}} style={{
                background: active ? "#fef9f1" : "#fff",
                border: "1.5px solid " + (active ? "#BF7A1A" : "#d8dfeb"),
                borderRadius:8, padding:"8px 12px", textAlign:"left", cursor:"pointer", fontFamily:"inherit"
              }}>
                <div style={{fontSize:12, fontWeight:700, color:active?"#8a4d05":"#30437a"}}>{opt.label}</div>
                <div style={{fontSize:10, color:"#6e6e73", marginTop:2}}>{opt.desc}</div>
              </button>;
            })}
          </div>
        </div>

        {execResult && <div style={{marginTop:18, paddingTop:18, borderTop:"2px solid "+BORDER}}>
          <div style={{fontSize:12, fontWeight:700, color:"#0f5c6a", textTransform:"uppercase", letterSpacing:0.5, marginBottom:10}}>Pipetting protocol</div>
          <div style={{background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, overflow:"hidden"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:12, fontFamily:"monospace"}}>
              <thead>
                <tr style={{background:"#0b2a6f", color:"#fff"}}>
                  <th style={{padding:"8px 10px", textAlign:"left", fontWeight:700}}>Dilution</th>
                  <th style={{padding:"8px 10px", textAlign:"right", fontWeight:700}}>Sample (µL)</th>
                  <th style={{padding:"8px 10px", textAlign:"right", fontWeight:700}}>Diluent (µL)</th>
                  <th style={{padding:"8px 10px", textAlign:"right", fontWeight:700}}>Final (µL)</th>
                  <th style={{padding:"8px 10px", textAlign:"left", fontWeight:700}}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {execResult.protocol.map(function(p,i){
                  return <tr key={i} style={{borderTop:i?"1px solid #eef2f7":"none", background:p.feasible?"#fff":"#fde2dd"}}>
                    <td style={{padding:"8px 10px", fontWeight:700}}>1:{p.dilution}</td>
                    <td style={{padding:"8px 10px", textAlign:"right"}}>{sig3(p.sampleVol)}</td>
                    <td style={{padding:"8px 10px", textAlign:"right"}}>{sig3(p.diluentVol)}</td>
                    <td style={{padding:"8px 10px", textAlign:"right"}}>{parseNum(execSt.finalVol)}</td>
                    <td style={{padding:"8px 10px", color: p.feasible ? "#5a6984" : "#a02c1c", fontFamily:"inherit", fontSize:11}}>{p.note || "OK"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>}
      </div>}

    </div>
  </div>;
}

// === DIAGRAMS ===

function PlanDiagram(props){
  var r = props.result, planSt = props.planSt, fromPgMl = props.fromPgMl;
  // Horizontal log-scale number line covering both the curve and the (estimated) sample range.
  // Goal: at a glance, the user sees TWO bars — where the standard curve covers, and where their sample is expected.
  // The dilution series is what bridges them: dilute the sample DOWN to fall inside the curve.
  var logMin = Math.log10(Math.min(r.loSampPgMl, r.loCurvePgMl) * 0.5);
  var logMax = Math.log10(Math.max(r.hiSampPgMl, r.hiCurvePgMl) * 2);
  var W = 600, H = 110, padX = 40;
  var xOf = function(pgml){
    var l = Math.log10(pgml);
    return padX + (l-logMin)/(logMax-logMin) * (W - 2*padX);
  };
  var fmt = function(pgml){
    var v = fromPgMl(pgml, planSt.curveUnit);
    return sig3(v) + " " + planSt.curveUnit;
  };
  // Center y for the bars. Curve = teal band (where you can MEASURE). Sample = amber bar (where it lives).
  var yCurve = H/2 + 10;
  var ySample = H/2 - 22;
  return <div style={{background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, padding:"14px 14px 8px"}}>
    <div style={{fontSize:11, fontWeight:700, color:"#30437a", marginBottom:4}}>Where the curve sits, where your sample sits</div>
    <div style={{fontSize:10, color:"#6e6e73", marginBottom:10, fontStyle:"italic", lineHeight:1.5}}>
      The dilution series bridges the gap: it shifts your sample LEFT (dividing) until it falls inside the standard curve range.
    </div>
    <svg viewBox={"0 0 "+W+" "+H} width="100%" style={{display:"block"}} xmlns="http://www.w3.org/2000/svg">
      {/* Number-line tick marks at decade boundaries */}
      {(function(){
        var ticks = [];
        for(var p = Math.ceil(logMin); p <= Math.floor(logMax); p++){
          var x = xOf(Math.pow(10, p));
          ticks.push(<g key={"t"+p}>
            <line x1={x} y1={H-22} x2={x} y2={H-18} stroke="#aeaeb2" strokeWidth={0.8} />
            <text x={x} y={H-8} fontSize={8} fill="#8e9bb5" textAnchor="middle">{fmt(Math.pow(10,p))}</text>
          </g>);
        }
        return ticks;
      })()}
      <line x1={padX} y1={H-22} x2={W-padX} y2={H-22} stroke="#d8dfeb" strokeWidth={1} />
      <text x={padX-4} y={H-26} fontSize={8} fill="#8e9bb5" textAnchor="end" fontStyle="italic">conc. (log)</text>

      {/* CURVE band (teal) — the measurable window */}
      <rect x={xOf(r.loCurvePgMl)} y={yCurve-12} width={xOf(r.hiCurvePgMl)-xOf(r.loCurvePgMl)} height={24} fill="#0F8AA2" opacity={0.22} rx={3} stroke="#0F8AA2" strokeWidth={0.8} />
      <text x={(xOf(r.loCurvePgMl)+xOf(r.hiCurvePgMl))/2} y={yCurve+4} fontSize={10} fontWeight={700} fill="#0f5c6a" textAnchor="middle">STANDARD CURVE</text>
      <text x={xOf(r.loCurvePgMl)} y={yCurve+22} fontSize={8} fill="#0f5c6a" textAnchor="middle">{fmt(r.loCurvePgMl)}</text>
      <text x={xOf(r.hiCurvePgMl)} y={yCurve+22} fontSize={8} fill="#0f5c6a" textAnchor="middle">{fmt(r.hiCurvePgMl)}</text>

      {/* SAMPLE bar (amber) — where the user's sample actually is */}
      {r.knownEstimatePgMl ? <g>
        <rect x={xOf(r.loSampPgMl)} y={ySample-9} width={xOf(r.hiSampPgMl)-xOf(r.loSampPgMl)} height={18} fill="#BF7A1A" opacity={0.28} rx={3} stroke="#BF7A1A" strokeWidth={0.8} />
        <text x={(xOf(r.loSampPgMl)+xOf(r.hiSampPgMl))/2} y={ySample+3} fontSize={10} fontWeight={700} fill="#7a4a05" textAnchor="middle">YOUR SAMPLE (estimated)</text>
      </g> : <g>
        {/* Unknown sample: gradient bar across the whole range */}
        <rect x={padX} y={ySample-9} width={W-2*padX} height={18} fill="url(#sampGrad)" opacity={0.35} rx={3} stroke="#BF7A1A" strokeWidth={0.5} strokeDasharray="3,3" />
        <text x={W/2} y={ySample+3} fontSize={10} fontWeight={700} fill="#7a4a05" textAnchor="middle">YOUR SAMPLE (could be anywhere — unknown)</text>
        <defs>
          <linearGradient id="sampGrad" x1="0" x2="1">
            <stop offset="0" stopColor="#BF7A1A" stopOpacity="0.1" />
            <stop offset="0.5" stopColor="#BF7A1A" stopOpacity="0.5" />
            <stop offset="1" stopColor="#BF7A1A" stopOpacity="0.1" />
          </linearGradient>
        </defs>
      </g>}

      {/* Connecting arrow from sample bar DOWN to curve, with "÷ dilution" label */}
      {r.knownEstimatePgMl && (function(){
        var sampMid = (xOf(r.loSampPgMl)+xOf(r.hiSampPgMl))/2;
        var curveMid = (xOf(r.loCurvePgMl)+xOf(r.hiCurvePgMl))/2;
        return <g>
          <defs>
            <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,4 L0,8 z" fill="#6337b9" />
            </marker>
          </defs>
          <path d={"M "+sampMid+" "+(ySample+9)+" Q "+(sampMid-30)+" "+((ySample+yCurve)/2)+" "+curveMid+" "+(yCurve-12)} fill="none" stroke="#6337b9" strokeWidth={1.5} markerEnd="url(#arrowHead)" />
          <text x={(sampMid+curveMid)/2} y={(ySample+yCurve)/2 + 2} fontSize={9} fontWeight={700} fill="#6337b9" textAnchor="middle">÷ dilution series →</text>
        </g>;
      })()}
    </svg>
    <div style={{display:"flex", gap:14, fontSize:10, color:"#6e6e73", marginTop:6, justifyContent:"center"}}>
      <span style={{display:"inline-flex", alignItems:"center", gap:4}}><span style={{width:14, height:8, background:"#0F8AA2", opacity:0.4, display:"inline-block"}}></span> Standard curve (where you measure)</span>
      <span style={{display:"inline-flex", alignItems:"center", gap:4}}><span style={{width:14, height:8, background:"#BF7A1A", opacity:0.4, display:"inline-block"}}></span> Your sample (where it lives)</span>
    </div>
  </div>;
}

// BenchWorkflowDiagram — visual representation of the on-plate serial dilution workflow.
// Shows (1) optional pre-dilution tube at top, (2) vertical column of plate wells with
// diluent arrows from the side and transfer arrows down between wells.
// Goal: a student should be able to look at this and immediately know what to do at the bench.
// Temporal cue: "STEP A — pre-load diluent (multichannel-friendly)" then "STEP B — sample + serial transfer".
function BenchWorkflowDiagram(props){
  var r = props.result;
  var bench = r.benchProtocol; // array of well objects
  var Vf = r.workingVol;
  var Vt = r.transferVol;
  var nWells = bench.length;
  // Display format for dilutions: "ratio" ("1:N") or "factor" ("N×"). Toggle is shown subtly above the diagram.
  var dilFormat = props.dilFormat || "ratio";
  var setDilFormat = props.setDilFormat || function(){};
  // Tighter sciThreshold for well labels — well circles are small, so anything ≥1000 switches to sci notation.
  var WELL_SCI = 1000;
  // The pre-dilution badge inside the dashed section gets a slightly looser threshold (more room).
  var BADGE_SCI = 10000;

  // Layout constants
  var rowH = 56;                    // height per well row
  var preDilH = r.preDilutionNeeded ? 130 : 0;
  var topGap = 36;                  // padding at top (need room for "Step N" header)
  var bottomGap = 30;               // padding at bottom
  var wellR = 18;                   // well circle radius
  var W = 640;
  var H = topGap + preDilH + (r.preDilutionNeeded ? 28 : 0) + nWells*rowH + bottomGap;

  // X coordinates: diluent reservoir on left, plate column in center-right
  var xDiluent = 90;       // diluent labels/arrows originate here
  var xWell = 380;         // center of each well
  var xSrc = 90;           // source arrows for A1 originate here
  var xDiscard = W - 50;   // discard target for last transfer

  // Y coordinate of each well's center — leaves room for the "Step N" header above
  var stepHeaderY = (r.preDilutionNeeded ? topGap+preDilH+18 : topGap-4);
  var yOfWell = function(i){
    var preTopShift = r.preDilutionNeeded ? (preDilH + 28) : 0;
    return topGap + preTopShift + i*rowH + rowH/2;
  };

  // Volume labels are formatted compactly
  var fmtVol = function(v){return sig3(v)+" µL";};

  return <div style={{background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, padding:"14px 14px 10px"}}>
    <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:4, flexWrap:"wrap"}}>
      <div style={{fontSize:11, fontWeight:700, color:"#0b2a6f", textTransform:"uppercase", letterSpacing:0.5}}>How to do it at the bench</div>
      <div style={{fontSize:10, color:"#aeaeb2", display:"flex", alignItems:"baseline", gap:4}}>
        <span>show dilutions as:</span>
        <FormatPill
          value={dilFormat}
          onChange={setDilFormat}
          labelOf={function(f){return f === "ratio" ? "ratio (1:N)" : "factor (N×)";}}
          toggleOf={function(f){return f === "ratio" ? "factor" : "ratio";}}
          size={10}
          color="#aeaeb2"
          hoverColor="#0b2a6f"
        />
      </div>
    </div>
    <div style={{fontSize:11, color:"#6e6e73", marginBottom:10, lineHeight:1.6}}>
      {r.preDilutionNeeded ? <span>First make the pre-dilution in a tube. Then on the plate, do these two phases:</span> : <span>Two phases on the plate:</span>}
      <div style={{marginTop:4, paddingLeft:10}}>
        <div><span style={{color:"#0b2a6f",fontWeight:700}}>Phase A</span> — pre-load all diluent (multichannel-friendly, all wells at once)</div>
        <div><span style={{color:"#6337b9",fontWeight:700}}>Phase B</span> — add sample to A1, then serial-transfer down (follow the numbered <span style={{display:"inline-block",width:14,height:14,borderRadius:7,background:"#6337b9",color:"#fff",fontSize:9,fontWeight:800,textAlign:"center",lineHeight:"14px",verticalAlign:"middle"}}>1</span> badges)</div>
      </div>
      <div style={{marginTop:6, fontStyle:"italic"}}>Use a fresh tip at every step. Pipette up/down 5× to mix before each transfer.</div>
    </div>
    <svg viewBox={"0 0 "+W+" "+H} width="100%" style={{display:"block", maxHeight: H+"px"}} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrIn" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L9,4.5 L0,9 z" fill="#0b2a6f" />
        </marker>
        <marker id="arrSamp" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L9,4.5 L0,9 z" fill="#bf7a1a" />
        </marker>
        <marker id="arrXfer" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L9,4.5 L0,9 z" fill="#6337b9" />
        </marker>
        <marker id="arrDiscard" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L9,4.5 L0,9 z" fill="#8e9bb5" />
        </marker>
      </defs>

      {/* === PRE-DILUTION SECTION === */}
      {r.preDilutionNeeded && (function(){
        var tubeX = 200, tubeY = topGap + 16;
        var tubeW = 60, tubeH = 80;
        var preDilLabel = fmtDilution(1 / r.preDilutionFactor, dilFormat, BADGE_SCI);
        return <g>
          <rect x={20} y={topGap} width={W-40} height={preDilH} fill="#fff8ea" stroke="#e8c77d" strokeWidth={1} strokeDasharray="4,3" rx={6} />
          <text x={32} y={topGap+16} fontSize={10} fontWeight={800} fill="#7a5800" style={{textTransform:"uppercase"}}>Step 1 — Pre-dilution in a tube ({preDilLabel})</text>

          {/* Tube graphic — rounded-bottom rectangle */}
          <path d={"M "+tubeX+" "+tubeY+" L "+tubeX+" "+(tubeY+tubeH-12)+" Q "+tubeX+" "+(tubeY+tubeH)+" "+(tubeX+12)+" "+(tubeY+tubeH)+" L "+(tubeX+tubeW-12)+" "+(tubeY+tubeH)+" Q "+(tubeX+tubeW)+" "+(tubeY+tubeH)+" "+(tubeX+tubeW)+" "+(tubeY+tubeH-12)+" L "+(tubeX+tubeW)+" "+tubeY+" Z"} fill="#fff" stroke="#7a5800" strokeWidth={1.2} />
          {/* Liquid fill (lower 70%) */}
          <path d={"M "+(tubeX+2)+" "+(tubeY+tubeH*0.3)+" L "+(tubeX+2)+" "+(tubeY+tubeH-13)+" Q "+(tubeX+2)+" "+(tubeY+tubeH-2)+" "+(tubeX+13)+" "+(tubeY+tubeH-2)+" L "+(tubeX+tubeW-13)+" "+(tubeY+tubeH-2)+" Q "+(tubeX+tubeW-2)+" "+(tubeY+tubeH-2)+" "+(tubeX+tubeW-2)+" "+(tubeY+tubeH-13)+" L "+(tubeX+tubeW-2)+" "+(tubeY+tubeH*0.3)+" Z"} fill="#bf7a1a" fillOpacity={0.18} />
          <text x={tubeX+tubeW/2} y={tubeY+tubeH+14} fontSize={9} fontWeight={700} fill="#7a5800" textAnchor="middle">1 mL tube</text>

          {/* Arrow: sample IN to tube */}
          <line x1={70} y1={tubeY+22} x2={tubeX-3} y2={tubeY+22} stroke="#bf7a1a" strokeWidth={1.5} markerEnd="url(#arrSamp)" />
          <text x={70} y={tubeY+18} fontSize={9} fontWeight={700} fill="#bf7a1a">{fmtVol(r.preDilutedSampleVol)} neat sample</text>

          {/* Arrow: diluent IN to tube */}
          <line x1={70} y1={tubeY+50} x2={tubeX-3} y2={tubeY+50} stroke="#0b2a6f" strokeWidth={1.5} markerEnd="url(#arrIn)" />
          <text x={70} y={tubeY+46} fontSize={9} fontWeight={700} fill="#0b2a6f">{fmtVol(r.preDilutedDiluentVol)} diluent</text>

          {/* "Mix" label inside tube */}
          <text x={tubeX+tubeW/2} y={tubeY+tubeH/2+4} fontSize={10} fontWeight={700} fill="#7a5800" textAnchor="middle" fontStyle="italic">mix</text>

          {/* Arrow from tube to plate column (down + right) — landing on A1 */}
          {(function(){
            var fromX = tubeX+tubeW+8, fromY = tubeY+tubeH/2;
            var toX = xWell - wellR - 4, toY = yOfWell(0);
            return <g>
              <path d={"M "+fromX+" "+fromY+" Q "+(fromX+50)+" "+fromY+" "+(fromX+80)+" "+toY+" L "+toX+" "+toY} fill="none" stroke="#bf7a1a" strokeWidth={1.5} markerEnd="url(#arrSamp)" strokeDasharray="0" />
              <text x={(fromX+toX)/2} y={(fromY+toY)/2 - 6} fontSize={9} fontWeight={700} fill="#bf7a1a" textAnchor="middle">use this →</text>
            </g>;
          })()}
        </g>;
      })()}

      {/* === PLATE COLUMN SECTION === */}
      {/* Step header */}
      <text x={32} y={stepHeaderY} fontSize={10} fontWeight={800} fill="#0b2a6f" style={{textTransform:"uppercase"}}>{r.preDilutionNeeded ? "Step 2 — " : "Step 1 — "}On-plate serial dilution (column 1)</text>

      {/* Wells */}
      {bench.map(function(b,i){
        var cy = yOfWell(i);
        var nextY = i < nWells-1 ? yOfWell(i+1) : null;
        // Format the well dilution label with sci notation if too big to fit
        var df = 1 / b.dilution; // b.dilution is the integer dilution factor, df is the fraction
        var wellLabel = fmtDilution(df, dilFormat, WELL_SCI);
        return <g key={i}>
          {/* Well circle */}
          <circle cx={xWell} cy={cy} r={wellR} fill="#fff" stroke="#0b2a6f" strokeWidth={1.4} />
          <text x={xWell} y={cy-2} fontSize={9} fontWeight={800} fill="#30437a" textAnchor="middle">{b.wellLabel}</text>
          <text x={xWell} y={cy+9} fontSize={8} fontWeight={700} fill="#6337b9" textAnchor="middle">{wellLabel}</text>

          {/* Diluent IN arrow (from left) — for wells 2..N (B1..H1) */}
          {!b.isFirst && <g>
            <line x1={xDiluent} y1={cy} x2={xWell-wellR-4} y2={cy} stroke="#0b2a6f" strokeWidth={1.4} markerEnd="url(#arrIn)" />
            <text x={xDiluent-4} y={cy-3} fontSize={8} fontWeight={700} fill="#0b2a6f" textAnchor="end">{fmtVol(b.preload)} diluent</text>
          </g>}

          {/* For first well (A1): show source arrow from left */}
          {b.isFirst && <g>
            <line x1={xSrc} y1={cy-9} x2={xWell-wellR-4} y2={cy-9} stroke="#bf7a1a" strokeWidth={1.4} markerEnd="url(#arrSamp)" />
            {/* Source label is rendered as two compact lines if a pre-dilution is in use, single line otherwise */}
            {(function(){
              var srcText = b.sampleSource;
              // For "pre-diluted sample (1:N)" use "{vol} pre-dil" / "(1:N)" to fit in tight space
              var preDilMatch = srcText.match(/^pre-diluted sample\s*\(([^)]+)\)/);
              if(preDilMatch){
                // Reformat the parenthetical "1:N" using the user's chosen format and sci threshold
                var origRatio = preDilMatch[1].match(/1:(\d+)/);
                var preLabel = origRatio ? "("+fmtDilution(1/parseInt(origRatio[1]), dilFormat, BADGE_SCI)+")" : "("+preDilMatch[1]+")";
                return <g>
                  <text x={xSrc-4} y={cy-16} fontSize={8} fontWeight={700} fill="#bf7a1a" textAnchor="end">{fmtVol(b.sampleVol)} pre-dil</text>
                  <text x={xSrc-4} y={cy-7} fontSize={8} fontWeight={700} fill="#bf7a1a" textAnchor="end">{preLabel}</text>
                </g>;
              }
              return <text x={xSrc-4} y={cy-12} fontSize={8} fontWeight={700} fill="#bf7a1a" textAnchor="end">{fmtVol(b.sampleVol)} {srcText}</text>;
            })()}
            {b.diluentVol > 0 && <g>
              <line x1={xSrc} y1={cy+9} x2={xWell-wellR-4} y2={cy+9} stroke="#0b2a6f" strokeWidth={1.4} markerEnd="url(#arrIn)" />
              <text x={xSrc-4} y={cy+15} fontSize={8} fontWeight={700} fill="#0b2a6f" textAnchor="end">{fmtVol(b.diluentVol)} diluent</text>
            </g>}
          </g>}

          {/* Transfer arrow DOWN to next well — labeled with step number to clarify sequence */}
          {nextY != null && <g>
            <line x1={xWell} y1={cy+wellR+1} x2={xWell} y2={nextY-wellR-4} stroke="#6337b9" strokeWidth={1.6} markerEnd="url(#arrXfer)" />
            {/* Small numbered badge on the arrow midpoint to show transfer order */}
            <circle cx={xWell-12} cy={(cy+wellR+1+nextY-wellR-4)/2} r={7} fill="#6337b9" />
            <text x={xWell-12} y={(cy+wellR+1+nextY-wellR-4)/2+3} fontSize={9} fontWeight={800} fill="#fff" textAnchor="middle">{i+1}</text>
            <text x={xWell+wellR+8} y={(cy+nextY)/2 + 3} fontSize={9} fontWeight={700} fill="#6337b9">{fmtVol(b.transferOut)} (mix → next)</text>
          </g>}
          {/* Last well: short discard arrow OFF to right */}
          {nextY == null && <g>
            <line x1={xWell+wellR+1} y1={cy} x2={xDiscard-3} y2={cy} stroke="#8e9bb5" strokeWidth={1.4} strokeDasharray="3,2" markerEnd="url(#arrDiscard)" />
            <text x={xDiscard} y={cy-4} fontSize={8} fontWeight={600} fill="#8e9bb5" textAnchor="end" fontStyle="italic">discard {fmtVol(Vt)}</text>
            <text x={xDiscard} y={cy+10} fontSize={8} fontWeight={600} fill="#1a6b32" textAnchor="end">all wells now {Vf} µL — done</text>
          </g>}
        </g>;
      })}
    </svg>

    {/* Footer summary */}
    <div style={{fontSize:10, color:"#6e6e73", marginTop:8, fontStyle:"italic", lineHeight:1.5, padding:"6px 10px", background:"#f4f4f6", borderRadius:6}}>
      All wells end up with <strong>{Vf} µL</strong> after the final transfer is discarded. Well-to-well transfer = <strong>{sig3(Vt)} µL</strong>. Run replicate columns the same way (or use a multichannel for diluent loading).
    </div>
    {r.benchWarn && <div style={{marginTop:8, padding:"8px 10px", background:"#fde2dd", color:"#a02c1c", fontSize:11, borderRadius:6, lineHeight:1.5}}>⚠ {r.benchWarn}</div>}
  </div>;
}

function HookEffectGuide(){
  return <div style={{marginTop:18, padding:"14px 16px", background:"#f7f1ff", border:"1px solid #e2d7fb", borderRadius:10}}>
    <div style={{fontSize:11, fontWeight:800, color:"#5a3a7a", textTransform:"uppercase", letterSpacing:0.5, marginBottom:8}}>📚 Instructor mode — about the hook effect</div>
    <div style={{display:"grid", gridTemplateColumns:"180px 1fr", gap:14, alignItems:"center"}}>
      <svg viewBox="0 0 180 110" width="180" xmlns="http://www.w3.org/2000/svg">
        {/* Axes */}
        <line x1={20} y1={95} x2={170} y2={95} stroke="#aeaeb2" strokeWidth={1} />
        <line x1={20} y1={10} x2={20} y2={95} stroke="#aeaeb2" strokeWidth={1} />
        <text x={95} y={108} fontSize={8} fill="#6e6e73" textAnchor="middle">Analyte concentration</text>
        <text x={12} y={50} fontSize={8} fill="#6e6e73" textAnchor="middle" transform="rotate(-90 12 50)">Signal</text>
        {/* The classic hook curve: rises, plateaus, then falls */}
        <path d="M 20 90 Q 50 80 70 50 Q 90 25 110 22 Q 130 20 145 35 Q 160 50 170 75" fill="none" stroke="#6337b9" strokeWidth={2} />
        {/* Region labels */}
        <text x={50} y={75} fontSize={7} fill="#1a6b32" fontWeight={700}>Linear</text>
        <text x={100} y={18} fontSize={7} fill="#7a5800" fontWeight={700}>Plateau</text>
        <text x={150} y={68} fontSize={7} fill="#a02c1c" fontWeight={700}>HOOK</text>
      </svg>
      <div style={{fontSize:11, color:"#3d2a5a", lineHeight:1.6}}>
        At very high analyte concentrations, both capture and detection antibodies get saturated. No sandwich forms, signal drops, and the assay reports a falsely <strong>low</strong> concentration. <strong>If your most concentrated dilution gave a higher implied sample concentration than your second-most concentrated one, that's a hook effect — your sample needs MORE dilution, not less.</strong>
      </div>
    </div>
  </div>;
}

function BlankPicker(props){
  // Interactive decision tree: ask 2 questions, recommend a blank type
  var _step = useState(0);
  var step = _step[0], setStep = _step[1];
  var _ans = useState({});
  var ans = _ans[0], setAns = _ans[1];

  var pick = function(k, v){
    var n = Object.assign({}, ans); n[k] = v;
    setAns(n);
    setStep(step+1);
  };
  var reset = function(){setStep(0); setAns({});};

  // Decision logic: based on ans.purpose and ans.matrix
  var recommend = (function(){
    if(!ans.purpose || !ans.matrix) return null;
    if(ans.purpose === "subtract"){
      // Goal: subtract background. Match diluent type.
      if(ans.matrix === "buffer"){
        return {
          type: "Zero standard (S0) — assay diluent only",
          why: "Your sample is in the kit's assay diluent (or close to it), so the background you want to subtract is what the diluent itself contributes. The zero standard is exactly that: standard diluent run through the full protocol with no analyte.",
          how: ["Take the same diluent you're using for your standards.", "Pipette it into 2–4 wells.", "Run those wells through the entire ELISA protocol (binding, wash, detection, substrate, stop).", "Subtract the average S0 reading from every standard and sample."],
          color:"#0F8AA2"
        };
      }
      if(ans.matrix === "biological"){
        return {
          type: "Matrix-matched negative control",
          why: "When samples are in serum, plasma, lysate, or culture supernatant, the matrix itself contributes background that pure diluent doesn't capture. You need a sample of the same matrix that's known to be analyte-free.",
          how: ["Find or pool a sample of the same matrix that doesn't contain your analyte (e.g. naive mouse serum if measuring induced cytokines).", "Run it like a sample, in 2–3 wells, alongside the zero standard.", "If the matrix-matched value is much higher than the zero standard, you have matrix interference — consider switching diluents or using sample-matched standards."],
          color:"#BF7A1A"
        };
      }
    }
    if(ans.purpose === "qc"){
      // Goal: check the plate/reagents
      return {
        type: "Plate blank (chromogen blank)",
        why: "Empty wells run through the protocol catch contamination, plate manufacturing defects, or reagent issues that aren't sample-specific.",
        how: ["Leave 2–3 wells empty (no sample, no standard, no diluent).", "Add only the substrate and stop solution at those steps.", "OD should be ≈ 0. If it's not, your plate or substrate has an issue."],
        color:"#6337b9"
      };
    }
    if(ans.purpose === "interference"){
      return {
        type: "Spike-and-recovery control",
        why: "To test whether something in your sample matrix is messing with the assay, you spike a known amount of analyte into your matrix vs. into kit diluent and compare recovery. This isn't really a 'blank' but it's the right control for matrix interference.",
        how: ["Spike the same known amount of analyte (e.g. 100 pg/mL) into kit diluent and into your sample matrix.", "Run both through the assay.", "Recovery should be 80–120% in both. If matrix gives much lower recovery, the matrix interferes."],
        color:"#BF7A1A"
      };
    }
    return null;
  })();

  return <div style={{marginTop:18, padding:"14px 16px", background:"#f7f8fb", border:"1.5px solid #c5d3e8", borderRadius:10}}>
    <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
      <div style={{fontSize:11, fontWeight:800, color:"#0b2a6f", textTransform:"uppercase", letterSpacing:0.5}}>Help me pick the right blank</div>
      {step>0 && <button onClick={reset} style={{background:"transparent", border:"none", color:"#6e6e73", fontSize:11, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline"}}>Start over</button>}
    </div>
    <div style={{fontSize:11, color:"#5a6984", lineHeight:1.6, marginBottom:10}}>
      "Blank" can mean four different things in ELISA, and people often pick the wrong one. Answer two questions and we'll point you at the right one with a how-to.
    </div>

    {step===0 && <div>
      <div style={{fontSize:13, fontWeight:700, color:"#0b2a6f", marginBottom:8}}>Q1: Why are you running a blank?</div>
      <div style={{display:"grid", gridTemplateColumns:"1fr", gap:6}}>
        <button onClick={function(){pick("purpose", "subtract");}} style={btnQuestion}>To subtract background OD from my sample/standard readings (most common)</button>
        <button onClick={function(){pick("purpose", "qc");}} style={btnQuestion}>To verify the plate/reagents themselves are clean (QC check)</button>
        <button onClick={function(){pick("purpose", "interference");}} style={btnQuestion}>To check if something in my sample matrix is interfering with the assay</button>
      </div>
    </div>}

    {step===1 && ans.purpose==="subtract" && <div>
      <div style={{fontSize:13, fontWeight:700, color:"#0b2a6f", marginBottom:8}}>Q2: What kind of matrix are your samples in?</div>
      <div style={{display:"grid", gridTemplateColumns:"1fr", gap:6}}>
        <button onClick={function(){pick("matrix", "buffer");}} style={btnQuestion}>Pure buffer or assay diluent (purified protein, recombinant standard, simple buffer)</button>
        <button onClick={function(){pick("matrix", "biological");}} style={btnQuestion}>A biological matrix (serum, plasma, cell lysate, supernatant, urine, tissue extract)</button>
      </div>
    </div>}
    {step===1 && (ans.purpose==="qc" || ans.purpose==="interference") && (function(){
      // Auto-pick "buffer" matrix for QC and interference paths since matrix doesn't change recommendation
      if(!ans.matrix){ setTimeout(function(){pick("matrix", "buffer");}, 0); }
      return null;
    })()}

    {step>=2 && recommend && <div style={{padding:"12px 14px", background:"#fff", border:"1.5px solid "+recommend.color, borderRadius:10, marginTop:8}}>
      <div style={{fontSize:11, fontWeight:700, color:recommend.color, textTransform:"uppercase", letterSpacing:0.5, marginBottom:4}}>Recommended blank</div>
      <div style={{fontSize:15, fontWeight:800, color:"#0b2a6f", marginBottom:8}}>{recommend.type}</div>
      <div style={{fontSize:12, color:"#3d2a5a", lineHeight:1.6, marginBottom:10}}><strong>Why:</strong> {recommend.why}</div>
      <div style={{fontSize:12, color:"#3d2a5a", lineHeight:1.6}}><strong>How to do it:</strong></div>
      <ol style={{margin:"4px 0 0 18px", padding:0, fontSize:12, color:"#3d2a5a", lineHeight:1.6}}>
        {recommend.how.map(function(h,i){return <li key={i} style={{marginBottom:3}}>{h}</li>;})}
      </ol>
    </div>}
  </div>;
}

var btnQuestion = {
  background:"#fff",
  border:"1px solid #d8dfeb",
  borderRadius:8,
  padding:"10px 12px",
  textAlign:"left",
  cursor:"pointer",
  fontFamily:"inherit",
  fontSize:12,
  color:"#30437a",
  lineHeight:1.5,
  transition:"all 0.15s",
};

function BlanksGuide(){
  var blankTypes = [
    {name:"Plate blank", what:"Empty wells (no liquid).", when:"Routine quality check on the plate itself.", how:"Leave 2–3 wells untouched."},
    {name:"Diluent / buffer blank", what:"Wells with assay diluent only.", when:"Most ELISAs. Use this to subtract baseline absorbance.", how:"Pipette assay diluent into 2–3 wells, run as normal samples."},
    {name:"Zero standard (S0)", what:"Standard diluent treated as a 0-concentration calibrator.", when:"Required by most kits. Often what people mean by 'blank'.", how:"Run the same standard diluent through the full protocol."},
    {name:"Matrix-matched negative", what:"Sample matrix known to be analyte-free.", when:"When matrix interference is suspected (serum, lysate).", how:"Pool a matrix that doesn't contain your analyte; run it like a sample."},
  ];
  return <div style={{marginTop:18, padding:"14px 16px", background:"#fff7e0", border:"1px solid #e8c77d", borderRadius:10}}>
    <div style={{fontSize:11, fontWeight:800, color:"#8a6420", textTransform:"uppercase", letterSpacing:0.5, marginBottom:8}}>📚 Instructor mode — picking the right blank</div>
    <div style={{fontSize:11, color:"#5d4500", lineHeight:1.6, marginBottom:10}}>"Blank" can mean four different things in ELISA. Use the one that matches what you're trying to control for:</div>
    <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
      {blankTypes.map(function(b,i){
        return <div key={i} style={{background:"#fff", borderRadius:8, padding:"8px 10px", border:"1px solid #f0e0b0"}}>
          <div style={{fontSize:11, fontWeight:800, color:"#8a6420", marginBottom:3}}>{b.name}</div>
          <div style={{fontSize:10, color:"#5d4500", lineHeight:1.5}}><strong>What:</strong> {b.what}</div>
          <div style={{fontSize:10, color:"#5d4500", lineHeight:1.5}}><strong>When:</strong> {b.when}</div>
          <div style={{fontSize:10, color:"#5d4500", lineHeight:1.5}}><strong>How:</strong> {b.how}</div>
        </div>;
      })}
    </div>
    <div style={{fontSize:10, color:"#5d4500", lineHeight:1.5, marginTop:10, fontStyle:"italic"}}>
      For most ELISAs, "the blank" refers to the zero standard (S0) and/or assay buffer blank. Subtract this from sample and standard ODs before fitting your curve.
    </div>
  </div>;
}


export default function App() {
  var _s=useState(false),on=_s[0],setOn=_s[1];
  var _t=useState(0),tab=_t[0],setTab=_t[1];
  var _d=useState(false),dbg=_d[0],setDbg=_d[1];
  var _dc=useState(0),dc2=_dc[0],setDc2=_dc[1];
  var _sm=useState("literature"),sm=_sm[0],setSm=_sm[1];
  var _ov=useState({}),showOv=_ov[0],setShowOv=_ov[1];
  var _cmp=useState(false),cmp2=_cmp[0],setCmp=_cmp[1];
  var _mw=useState(null),mathRow=_mw[0],setMathRow=_mw[1];
  var _inst=useState(false),instructor=_inst[0],setInstructor=_inst[1];
  var _exp=useState({}),expanded=_exp[0],setExpanded=_exp[1];
  var _rexp=useState({}),resultsExpanded=_rexp[0],setResultsExpanded=_rexp[1];
  var _ap=useState({}),picks=_ap[0],setPicks=_ap[1];
  var _cfg=useState(defaultCfg()),cfg=_cfg[0],setCfg=_cfg[1];
  var _pl=useState([EP()]),pl=_pl[0],setPl=_pl[1];
  var _det=useState([]),det=_det[0],setDet=_det[1];
  var _res=useState(null),res=_res[0],setRes=_res[1];
  var _vp=useState(0),vp=_vp[0],setVp=_vp[1];
  var _pm=useState(false),planningMode=_pm[0],setPlanningMode=_pm[1];
  var _tt=useState(null),selectedTool=_tt[0],setSelectedTool=_tt[1];
  var _sp=useState([{plate:"1",endo:"0",spiked:"1",spikeProtein:"GFP",stockConc:"500",stockUnit:"ug/uL",spikeVol:"10",spikeVolUnit:"uL",sampleVol:"1000",sampleVolUnit:"uL",noEndo:false}]),spikeSets=_sp[0],setSpikeSets=_sp[1];

  var u=function(k,v){setCfg(function(p){var n={};for(var x in p)n[x]=p[x];n[k]=v;return n;});};
  var np=Math.max(1,Math.min(24,parseInt(cfg.np)||1));
  var sr=parseInt(cfg.sr)||3; var xr=parseInt(cfg.xr)||3;
  var nl=cfg.names.split(/[,\n]/).map(function(s){return s.trim();}).filter(Boolean);
  var unit=cfg.unit||"mg/mL";
  // Display unit overrides — let the user click a tiny pill to change how concs are shown
  // without changing the underlying data. State is initialized from cfg.unit but follows cfg.unit
  // when the user changes the input unit (so stale display values don't persist).
  var _duChart = useState(unit), displayUnitChart = _duChart[0], setDisplayUnitChart = _duChart[1];
  var _duResults = useState(unit), displayUnitResults = _duResults[0], setDisplayUnitResults = _duResults[1];
  // Sync display units when input unit changes (e.g. user switches from mg/mL to ng/mL in General Info)
  useEffect(function(){ setDisplayUnitChart(unit); setDisplayUnitResults(unit); }, [unit]);
  // Dilution display format: "ratio" (default, "1:N") or "factor" ("N×"). Affects landing-page series previews
  // and the bench-workflow well labels. Independent of unit display.
  var _dilFmt = useState("ratio"), dilFormat = _dilFmt[0], setDilFormat = _dilFmt[1];
  var targetP=cfg.tp==="yes"?"Total Protein":(cfg.target||cfg.sn);
  var assayKind=cfg.tp==="yes"?"total":(cfg.at==="elisa"?"elisa":"direct");

  useEffect(function(){
    setCfg(function(p){
      var n={};for(var x in p)n[x]=p[x];
      if(p.tp==="yes"){
        n.sn="BSA";
        n.sc="2";
        n.sdf="1/2";
        n.sds="1/2";
        n.xdf="1/2";
        n.xds="1/2";
        n.at="direct";
      } else if(p.at==="direct"){
        n.sn="GFP";
        n.sc="1";
        n.sdf="1/10";
        n.sds="1/2";
        n.xdf="1/10";
        n.xds="1/2";
        if(!p.target || p.target===p.sn || p.target==="BSA") n.target="GFP";
      } else if(p.at==="elisa"){
        n.sdf="1/2";
        n.sds="1/2";
        n.xdf="1/2";
        n.xds="1/2";
      }
      return n;
    });
  },[cfg.tp,cfg.at]);

  useEffect(function(){
    setPl(function(p){var n=p.slice();while(n.length<np)n.push(EP());return n.slice(0,np);});
    setDet(function(p){var n=p.slice();while(n.length<np)n.push(null);return n.slice(0,np);});
  },[np]);

  // getLayout produces a normalized structure regardless of plate orientation.
  // Each group exposes:
  //   type: 'std' or 'smp'
  //   name: display name
  //   dilutions: array of arrays — dilutions[i] is [(r,c), ...] cells at dilution i
  //   blankCells: array of (r,c) cells to use as blanks (averaged for baseline subtraction)
  // Plus orientation hints for the plate-grid renderer:
  //   axis: 'col' (classical: each column-group is one analyte) or 'row' (transposed: each row is one analyte)
  //   For classical: startCol, cols — same as before
  //   For transposed: rowIdx, repColRanges — row in plate, list of [start,end) col ranges per replicate
  var getLayout=function(){
    var rows=det[0]?det[0].rows:8;
    var cols=det[0]?det[0].cols:12;
    if(cfg.layout==="transposed"){
      // Transposed: each "slot" is a half-row holding one analyte's dilution series.
      // 8 rows × 2 halves = 16 slots. Standard occupies sr slots, samples occupy xr slots each.
      // Half-row cell positions on a 12-col plate:
      //   half 0 (left): cols 0..4 = 5 dilutions, col 5 = blank
      //   half 1 (right): cols 6..10 = 5 dilutions, col 11 = blank
      var halfWidth = Math.floor(cols / 2);
      var dilsPerRep = halfWidth - 1; // 5 for a 12-col plate
      var halfStart = function(halfIdx){return halfIdx===0 ? 0 : halfWidth;};
      var halfBlank = function(halfIdx){return halfIdx===0 ? halfWidth-1 : cols-1;};
      // Build a group from a list of "slots" — each slot is {row, halfIdx}
      var buildGroupFromSlots=function(type, name, slots){
        var ds = [];
        for(var di=0; di<dilsPerRep; di++){
          var reps = slots.map(function(sl){return [sl.row, halfStart(sl.halfIdx) + di];});
          ds.push(reps);
        }
        var bc = slots.map(function(sl){return [sl.row, halfBlank(sl.halfIdx)];});
        return {
          type:type, name:name, dilutions:ds, blankCells:bc, axis:"row",
          slots:slots,
          // For renderer convenience:
          rowsUsed: Array.from(new Set(slots.map(function(s){return s.row;}))),
          dilsPerRep: dilsPerRep
        };
      };
      // Enumerate slots in scanning order: row 0 half 0, row 0 half 1, row 1 half 0, ... row 7 half 1
      // Take the first sr slots for the standard, then xr-grouped slots for each sample.
      var slotList = [];
      // Slots accumulate vertically within each half: A-left, B-left, ..., H-left, A-right, B-right, ..., H-right
      for(var h=0; h<2; h++) for(var r=0; r<rows; r++) slotList.push({row:r, halfIdx:h});
      var srN = parseInt(cfg.sr)||2; // 1 or 2 in transposed
      var xrN = parseInt(cfg.xr)||2;
      // Ensure at least 1 slot for standard
      if(srN<1) srN=1; if(xrN<1) xrN=1;
      var stdSlots = slotList.slice(0, srN);
      var remaining = slotList.slice(srN);
      var groups = [buildGroupFromSlots("std","Standard",stdSlots)];
      var sampleIdx = 1;
      while(remaining.length >= xrN){
        var s = remaining.slice(0, xrN);
        groups.push(buildGroupFromSlots("smp","Sample "+sampleIdx, s));
        remaining = remaining.slice(xrN);
        sampleIdx++;
      }
      return {groups:groups, totalRows:rows, totalCols:cols, axis:"row", dilsPerRep:dilsPerRep, dilutionCount:dilsPerRep, halfWidth:halfWidth};
    }
    // Classical layout (default)
    var g=[{type:"std",name:"Standard",startCol:0,cols:sr,axis:"col"}];
    var c=sr,si=1;
    while(c+xr<=cols){
      g.push({type:"smp",name:"Sample "+si,startCol:c,cols:xr,axis:"col"});
      c+=xr;
      si++;
    }
    // Add the per-group dilutions array (using rows-1 dilutions; last row is the universal blank)
    g.forEach(function(grp){
      var ds=[];
      for(var di=0; di<rows-1; di++){
        var reps=[];
        for(var rc=grp.startCol; rc<grp.startCol+grp.cols; rc++) reps.push([di, rc]);
        ds.push(reps);
      }
      grp.dilutions=ds;
      // Blank cells: bottom row, all replicate columns
      var bc=[];
      for(var rc=grp.startCol; rc<grp.startCol+grp.cols; rc++) bc.push([rows-1, rc]);
      grp.blankCells=bc;
      grp.dilsPerRep=rows-1;
    });
    return {groups:g, totalRows:rows, totalCols:cols, axis:"col", dilsPerRep:rows-1, dilutionCount:rows-1};
  };
  var layout=getLayout();
  var smpGroups=layout.groups.filter(function(g){return g.type==="smp";});
  // Compute which sample groups actually have data on any plate — used to filter spike recovery dropdowns
  var populatedSampleIdxs=(function(){
    var out=[];
    smpGroups.forEach(function(g,si){
      var hasData=false;
      for(var pi=0;pi<np && !hasData;pi++){
        var plate=pl[pi];
        if(!plate) continue;
        // Walk all cells in this group's dilutions
        for(var di=0; di<g.dilutions.length && !hasData; di++){
          var reps=g.dilutions[di];
          for(var ri=0; ri<reps.length; ri++){
            var rc=reps[ri], r=rc[0], c=rc[1];
            if(plate[r] && plate[r][c]){
              var v=plate[r][c];
              if(v && !isNaN(parseFloat(v))){ hasData=true; break; }
            }
          }
        }
      }
      if(hasData) out.push(si);
    });
    return out;
  })();
  // colColor: returns the color theme for a given (row, col). For classical, uses col → group; for transposed, uses row → group.
  var cellColor=function(r,c){
    for(var gi=0;gi<layout.groups.length;gi++){
      var g=layout.groups[gi];
      if(g.axis==="col"){
        if(c>=g.startCol && c<g.startCol+g.cols){
          if(g.type==="std") return GC[0];
          var si=layout.groups.slice(0,gi).filter(function(gg){return gg.type==="smp";}).length;
          return GC[(si+1)%GC.length];
        }
      } else if(g.axis==="row" && g.slots){
        // Check if any slot covers this (r,c)
        var hw = layout.halfWidth || 6;
        for(var sidx2=0; sidx2<g.slots.length; sidx2++){
          var sl = g.slots[sidx2];
          if(sl.row !== r) continue;
          var halfStart = sl.halfIdx===0 ? 0 : hw;
          var halfBlankCol = sl.halfIdx===0 ? hw-1 : (layout.totalCols||12)-1;
          // Cell belongs to this slot if it's in [halfStart, halfStart+dilsPerRep) or is the half's blank
          if(c===halfBlankCol) return null; // blank
          if(c>=halfStart && c<halfStart+(g.dilsPerRep||5)){
            if(g.type==="std") return GC[0];
            var si3=layout.groups.slice(0,gi).filter(function(gg){return gg.type==="smp";}).length;
            return GC[(si3+1)%GC.length];
          }
        }
      }
    }
    return GC[GC.length-1];
  };
  // Backward-compat shim: old colColor only knew about cols (classical).
  var colColor=function(c){return cellColor(0,c) || GC[GC.length-1];};

  var hp=function(pi){return function(e){var text=e.clipboardData?e.clipboardData.getData("text"):"";if(!text.trim())return;e.preventDefault();var rows=text.trim().split("\n").map(function(r){return r.split(/\t/);});var plate=EP(),mc=0,mr=0;for(var r=0;r<Math.min(rows.length,8);r++)for(var c=0;c<Math.min(rows[r].length,12);c++){var v=rows[r][c]?rows[r][c].trim():"";if(v){plate[r][c]=v;if(c+1>mc)mc=c+1;if(r+1>mr)mr=r+1;}}setPl(function(p){var n=p.slice();n[pi]=plate;return n;});setDet(function(p){var n=p.slice();n[pi]={rows:mr,cols:mc};return n;});};};
  var hcc=function(pi,r,c,v){setPl(function(p){var n=p.slice();var plate=n[pi].map(function(row){return row.slice();});plate[r][c]=v;n[pi]=plate;return n;});};
  var nameIndex=function(pi,si){return pi*smpGroups.length+si;};
  var sampleNameFor=function(pi,si,fallback){var idx=nameIndex(pi,si);return nl[idx]||fallback;};
  var hsnc=function(pi,si,nm){var names=cfg.names.split(/\n/).map(function(s){return s.trim();});var idx=nameIndex(pi,si);while(names.length<=idx)names.push("Sample "+(names.length+1));names[idx]=nm;u("names",names.join("\n"));};
  var updateSpike=function(i,k,v){setSpikeSets(function(p){var n=p.map(function(s){var c={};for(var x in s)c[x]=s[x];return c;});n[i][k]=v;return n;});};
  var addSpike=function(){setSpikeSets(function(p){return p.concat([{plate:"1",endo:"0",spiked:String(Math.min(1,Math.max(0,smpGroups.length-1))),spikeProtein:cfg.sn||"GFP",stockConc:"500",stockUnit:"ug/uL",spikeVol:"10",spikeVolUnit:"uL",sampleVol:"1000",sampleVolUnit:"uL",noEndo:false}]);});};
  var removeSpike=function(i){setSpikeSets(function(p){return p.filter(function(_,idx){return idx!==i;});});};

  var analyze=useCallback(function(){
    var sc=parseFloat(cfg.sc),df1=pDil(cfg.sdf),ds=pDil(cfg.sds),xf1=pDil(cfg.xdf),xs=pDil(cfg.xds);
    if([sc,df1,ds,xf1,xs].some(isNaN))return;var all=[];
    for(var pi=0;pi<np;pi++){
      var plate=pl[pi];if(!plate)continue;var ly=getLayout();
      var stdG=ly.groups.find(function(g){return g.type==="std";});
      var smpG=ly.groups.filter(function(g){return g.type==="smp";});
      var sRows=ly.dilsPerRep; // number of dilution levels (excludes blank)
      var concs=[],c2=sc*df1;for(var i=0;i<sRows;i++){concs.push(c2);c2*=ds;}
      // Read replicate values for a group's dilutions: returns [[v,v,..], [v,v,..], ...] one array per dilution level
      var readDilutions=function(g){
        return g.dilutions.map(function(reps){
          return reps.map(function(rc){var n=parseFloat(plate[rc[0]]?plate[rc[0]][rc[1]]:"");return isNaN(n)?null:n;});
        });
      };
      // Read blank cells (one or more) and average them
      var readBlankAvg=function(g){
        var vals=g.blankCells.map(function(rc){var n=parseFloat(plate[rc[0]]?plate[rc[0]][rc[1]]:"");return isNaN(n)?null:n;}).filter(function(v){return v!==null;});
        return vals.length?avg(vals):null;
      };
      var stdDils=readDilutions(stdG);
      var bA=readBlankAvg(stdG);
      if(bA==null) bA=0;
      var sP=[],xR=[],yR=[],dbS=[];
      for(i=0;i<sRows;i++){
        var raw=stdDils[i].filter(function(v){return v!==null;});
        if(!raw.length)continue;
        var cor=raw.map(function(v){return v-bA;});
        var a=avg(cor),sd=sdc(cor),cv=cor.length>1?cvc(cor):0;
        sP.push({conc:concs[i],avg:a,sd:sd,cv:cv});
        xR.push(concs[i]);yR.push(a);
        dbS.push({row:i,conc:concs[i],raw:raw,blank:bA,cor:cor,avg:a,sd:sd,cv:cv});
      }
      // Optionally include the blank well as a (conc=0, fluorescence_corrected=0) calibration point.
      // Default off (matches ICH M10 / immunoassay convention: standards only).
      // On = matches the older "Excel forces origin" approach common in classroom worksheets.
      if(cfg.forceOriginInCurve==="yes"){
        xR.push(0); yR.push(0);
      }
      var lr=linReg(xR,yR);var fFn=function(x){return lr.slope*x+lr.intercept;};var iFn=function(y){return lr.slope?(y-lr.intercept)/lr.slope:null;};
      var mxA=Math.max.apply(null,yR),mnA=Math.min.apply(null,yR),midA=(mxA+mnA)/2;
      var samps=[];
      for(var si=0;si<smpG.length;si++){
        var sDils=readDilutions(smpG[si]);
        var hasSignal=sDils.some(function(reps){return reps.some(function(v){return v!==null;});});
        if(!hasSignal) continue;
        var sBval=readBlankAvg(smpG[si]);
        var sB=sBval!=null?sBval:bA;
        var nm=sampleNameFor(pi,si,smpG[si].name);var dils=[],dbD=[];
        for(var d=0;d<sRows;d++){
          var raw2=sDils[d].filter(function(v){return v!==null;});
          if(!raw2.length)continue;
          var cor2=raw2.map(function(v){return v-sB;});
          var a2=avg(cor2),cv2=cor2.length>1?cvc(cor2):0,ir2=a2<=mxA&&a2>=mnA;
          // Compute cW unconditionally if the math is valid (positive, finite). For OOR rows this is
          // mathematical extrapolation only — analyst-mode UI hides it; instructor mode shows it as a
          // teaching moment (you CAN do the math but you should NOT report it).
          var cW=null;{var inv=iFn(a2);cW=inv!=null&&isFinite(inv)&&inv>0?inv:null;}
          var df=xf1*Math.pow(xs,d),cS2=cW!=null?cW/df:null;
          dils.push({di:d,avgA:a2,cv:cv2,ir:ir2,cW:cW,cS:cS2});
          dbD.push({di:d,raw:raw2,blank:sB,cor:cor2,avgA:a2,cv:cv2,ir:ir2,cW:cW,df:df,cS:cS2});
        }
        samps.push({name:nm,dils:dils,aS:selAll(dils,midA),dbD:dbD});
      }
      all.push({sc:{slope:lr.slope,intercept:lr.intercept,r2:lr.r2,pts:sP},fFn:fFn,fL:"Linear",samps:samps,dbS:dbS,bA:bA,mxA:mxA,mnA:mnA});
    }
    if(all.length===0){window.alert("Analysis produced no results — the plates may be empty or missing standard curve data. Try loading the demo to verify setup.");return;}
    var anyCurve = all.some(function(p){return p.sc && p.sc.pts && p.sc.pts.length>=2;});
    if(!anyCurve){window.alert("Standard curve could not be built — the standard wells appear empty or unreadable. Check that absorbance values have been entered into the standard's wells.");return;}
    setRes(all);setVp(0);setTab(1);setMathRow(null);setPicks({});
    var ex={};all.forEach(function(p,pi){p.samps.forEach(function(_,si){ex[pi+"-"+si]=true;});});setExpanded(ex);
    var rex={};all.forEach(function(p,pi){p.samps.forEach(function(_,si){rex[pi+"-"+si]=true;});});setResultsExpanded(rex);
  },[cfg,pl,np,sr,xr,nl,det]);

  var gsc=function(pi,si){
    var apk=pi+"-"+si;
    if(picks[apk]!=null&&res){var s=res[pi].samps[si];var d=s.dils.find(function(d2){return d2.di===picks[apk];});if(d&&d.cS!=null)return {conc:d.cS,dil:d.di,cv:d.cv,note:"Analyst pick",meth:"Manual"};return null;}
    if(!res)return null;var aS=res[pi]&&res[pi].samps[si]?res[pi].samps[si].aS:null;return aS?aS[sm]:null;
  };

  var doExport=function(){if(!res)return;
    var c="# eSSF Curve "+APP_VERSION+" results export\n";
    c+="# Strategy: "+sm+"\n";
    c+="# Unit: "+unit+"\n\n";
    c+="## Reported concentrations\n";
    c+="Plate,Sample,Strategy,Dilution,CV%,"+targetP+" ("+unit+"),R\u00b2\n";
    res.forEach(function(p,pi){p.samps.forEach(function(s,si){var sl=gsc(pi,si);c+=(pi+1)+',"'+s.name+'",'+sm+','+(sl&&sl.dil!=null?sl.dil:"")+","+(sl&&sl.cv!=null?(sl.cv*100).toFixed(1):"")+","+(sl&&sl.conc!=null?sig3(sl.conc):"")+","+p.sc.r2.toFixed(5)+"\n";});});
    if(cfg.spikeUsed==="yes"){
      var sr2=spikeRows();
      if(sr2.length){
        c+="\n## Spike recovery (classical: (spiked-unspiked)/expected x 100)\n";
        var anyOverride=sr2.some(function(r){return r.noEndo;});
        if(anyOverride){c+="# WARNING: one or more rows used endogenous=0 override. Matrix must be independently validated.\n";}
        c+="Plate,SpikeProtein,Endogenous,SpikedSample,Endo_conc ("+unit+"),Spiked_conc ("+unit+"),Expected_spike ("+unit+"),Recovery%,SpikeVol_uL,SampleVol_uL,SpikePct,SpikeEndoRatio,Flags\n";
        sr2.forEach(function(r){
          var flags=[];
          if(r.noEndo)flags.push("BASELINE_OVERRIDE");
          if(r.warnSpikePct)flags.push("SPIKE_GT_10PCT");
          if(r.warnOutOfRange)flags.push("EXPECTED_OUTSIDE_CURVE");
          if(r.warnUnitMismatch)flags.push("UNIT_MISMATCH");
          if(r.warnRecoveryBound)flags.push("RECOVERY_OUT_OF_BOUNDS");
          if(r.warnLowSpikeRegime)flags.push("LOW_SPIKE_REGIME");
          c+=r.plate+',"'+r.spikeProtein+'","'+r.endogenousName+'","'+r.spikedName+'",'+(r.endogenousConc!=null?sig3(r.endogenousConc):"")+","+(r.spikedConc!=null?sig3(r.spikedConc):"")+","+(r.expectedSpike!=null?sig3(r.expectedSpike):"")+","+(r.recovery!=null?r.recovery.toFixed(1):"")+","+r.spikeVol+","+r.sampleVol+","+(r.spikePctOfTotal!=null?(r.spikePctOfTotal*100).toFixed(1)+"%":"")+","+(r.spikeEndoRatio!=null?r.spikeEndoRatio.toFixed(2):"")+',"'+flags.join("|")+'"\n';
        });
      }
    }
    var bb=new Blob([c],{type:"text/csv"});var u2=URL.createObjectURL(bb);var a=document.createElement("a");a.href=u2;a.download="essf_curve_results_"+APP_VERSION+".csv";a.click();URL.revokeObjectURL(u2);
  };

  var demo=function(){
    if(cfg.layout==="transposed"){
      // Transposed demo: row 0 = standard, rows 1-3 = SS, SS spike, TT (3 samples), 5 dilutions × 2 reps + 2 blanks
      // Concentrations: standard 0.1, 0.05, 0.025, 0.0125, 0.00625 mg/mL → signal 5×conc + 0.05
      // SS at 0.4 mg/mL (well 0.04, signal 0.25 at d0)
      // SS spike: SS + GFP spike (~0.495 mg/mL total at well, 0.0495 well at d0, signal 0.297)
      // TT at 0.15 mg/mL (well 0.015, signal 0.125 at d0)
      // sr=2, xr=2 with half-first slot enumeration:
      //   Std slots: A-left, B-left → fills rows 0,1 left half (cols 0-4 + blank col 5)
      //   Sample 1 (SS) slots: C-left, D-left → rows 2,3 left half
      //   Sample 2 (SS spike) slots: E-left, F-left → rows 4,5 left half
      //   Sample 3 (TT) slots: G-left, H-left → rows 6,7 left half
      //   Right half (cols 6-11) is empty for this demo
      // Standard concentrations: 1/10 first dil = 0.1 mg/mL well, then /2 each step → 0.1, 0.05, 0.025, 0.0125, 0.00625
      // Linear: signal = 5×conc + 0.05 (blank), so blank-corrected = 5×conc
      // Std signals: 0.55, 0.30, 0.175, 0.1125, 0.08125 + blank 0.05
      setCfg({sn:"GFP",sc:"1",sdf:"1/10",sds:"1/2",xdf:"1/10",xds:"1/2",np:"1",tp:"no",at:"direct",fm:"linear",names:"SS\nSS spike\nTT",sr:"2",xr:"2",unit:"mg/mL",target:"GFP",tmpl:"bca",spikeUsed:"no",layout:"transposed"});
      setSpikeSets([{plate:"1",endo:"0",spiked:"1",spikeProtein:"GFP",stockConc:"500",stockUnit:"ug/uL",spikeVol:"10",spikeVolUnit:"uL",sampleVol:"1000",sampleVolUnit:"uL",noEndo:false}]);
      var d=EP();
      // Standard: 2 reps in left half (rows A, B). With slight realistic variation between reps.
      var stdA = [0.552,0.298,0.176,0.114,0.082, 0.050, "","","","", "", ""];
      var stdB = [0.548,0.301,0.174,0.113,0.080, 0.049, "","","","", "", ""];
      // SS at 0.4 mg/mL → well 0.04 → signal 0.25 at d0; 0.15, 0.10, 0.075, 0.0625
      var ssC = [0.252,0.151,0.101,0.077,0.063, 0.052, "","","","", "", ""];
      var ssD = [0.249,0.148,0.099,0.075,0.061, 0.050, "","","","", "", ""];
      // SS spike: stock 500 ug/uL = 500 mg/mL. spike 10 uL into 1000 uL sample → expected 4.95 mg/mL.
      // Combined: 0.4*(1000/1010) + 500*(10/1010) = 0.396 + 4.95 = 5.346 mg/mL
      // After 1/10 dil: 0.5346 well → signal 2.72; /2: 0.2673 → 1.39; /4: 1336 → 0.72; /8: 0.0668 → 0.38; /16: 0.0334 → 0.22
      var spikeE = [2.722,1.388,0.718,0.384,0.217, 0.054, "","","","", "", ""];
      var spikeF = [2.715,1.385,0.715,0.380,0.215, 0.052, "","","","", "", ""];
      // TT at 0.15 mg/mL → well 0.015 → signal 0.125 at d0; 0.0875, 0.0688, 0.0594, 0.0547
      var ttG = [0.126,0.089,0.069,0.060,0.055, 0.050, "","","","", "", ""];
      var ttH = [0.124,0.087,0.068,0.058,0.054, 0.049, "","","","", "", ""];
      var rows = [stdA, stdB, ssC, ssD, spikeE, spikeF, ttG, ttH];
      for(var r=0;r<rows.length;r++) for(var c=0;c<rows[r].length;c++) {
        var v=rows[r][c]; if(v!=="") d[r][c]=String(v);
      }
      setPl([d]);
      setDet([{rows:8,cols:12}]);
      setOn(true);
      return;
    }
    // Classical demo (default)
    setCfg({sn:"GFP",sc:"1",sdf:"1/10",sds:"1/2",xdf:"1/10",xds:"1/2",np:"1",tp:"no",at:"direct",fm:"linear",names:"SS\nSS spike\nTT",sr:"3",xr:"3",unit:"mg/mL",target:"GFP",tmpl:"bca",spikeUsed:"no",layout:"classical"});setSpikeSets([{plate:"1",endo:"0",spiked:"1",spikeProtein:"GFP",stockConc:"500",stockUnit:"ug/uL",spikeVol:"10",spikeVolUnit:"uL",sampleVol:"1000",sampleVolUnit:"uL",noEndo:false}]);var d=EP();var raw=[[.796,.797,.798,.772,.764,.762,2.805,2.89,2.88,.703,.71,.712],[.425,.423,.422,.415,.41,.415,1.237,1.22,1.222,.322,.324,.332],[.261,.262,.263,.246,.248,.247,.753,.702,.705,.201,.202,.203],[.194,.192,.19,.178,.185,.184,.434,.481,.479,.167,.165,.165],[.125,.124,.125,.129,.128,.127,.245,.279,.278,.117,.116,.118],[.114,.115,.116,.113,.115,.114,.205,.205,.207,.105,.104,.103],[.106,.107,.105,.102,.102,.101,.165,.165,.167,.1,.1,.099],[.09,.09,.09,.088,.088,.088,.088,.089,.086,.09,.09,.09]];for(var r=0;r<raw.length;r++)for(var c=0;c<raw[r].length;c++)d[r][c]=raw[r][c].toString();setPl([d]);setDet([{rows:8,cols:12}]);setOn(true);
  };
  var reset=function(){setCfg(defaultCfg());setOn(false);setTab(0);setRes(null);setPl([EP()]);setDet([]);setDbg(false);setMathRow(null);setPicks({});setResultsExpanded({});setExpanded({});setCmp(false);setSpikeSets([{plate:"1",endo:"0",spiked:"1",spikeProtein:"GFP",stockConc:"500",stockUnit:"ug/uL",spikeVol:"10",spikeVolUnit:"uL",sampleVol:"1000",sampleVolUnit:"uL",noEndo:false}]);};
  var htc=function(){var n=dc2+1;setDc2(n);if(n>=3){setDbg(!dbg);setDc2(0);}setTimeout(function(){setDc2(0);},1000);};
  var dv=!isNaN(pDil(cfg.sdf))&&!isNaN(pDil(cfg.sds))&&!isNaN(pDil(cfg.xdf))&&!isNaN(pDil(cfg.xds));
  var totalCols=layout.totalCols||0;
  if(totalCols===0){
    layout.groups.forEach(function(g){
      if(g.axis==="col"){
        var e=g.startCol+g.cols;
        if(e>totalCols)totalCols=e;
      }
    });
  }
  if(totalCols===0) totalCols=12;
  var totalRows2=layout.totalRows||8;
  var toggleAll=function(open){var ex={};if(res){res.forEach(function(p,pi){p.samps.forEach(function(_,si){ex[pi+"-"+si]=open;});});}setExpanded(ex);};
  var toggleResultsAll=function(open){var ex={};if(res){res.forEach(function(p,pi){p.samps.forEach(function(_,si){ex[pi+"-"+si]=open;});});}setResultsExpanded(ex);};
  var spikeRows=function(){
    if(!res || cfg.spikeUsed!=="yes") return [];
    return spikeSets.map(function(set,idx){
      var pi=Math.max(0,Math.min(np-1,(parseInt(set.plate)||1)-1));
      var endoIdx=Math.max(0,Math.min(smpGroups.length-1,parseInt(set.endo)||0));
      var spikedIdx=Math.max(0,Math.min(smpGroups.length-1,parseInt(set.spiked)||0));
      var endo=set.noEndo?{conc:0,dil:null,cv:null,note:"No endogenous (user override)",meth:"Override"}:gsc(pi,endoIdx);
      var spiked=gsc(pi,spikedIdx);
      var stockMgMl=concToMgMl(parseFloat(set.stockConc),set.stockUnit);
      var spikeVolRaw=parseFloat(set.spikeVol)||0;
      var sampleVolRaw=parseFloat(set.sampleVol)||0;
      var spikeVolUnit=set.spikeVolUnit||"uL";
      var sampleVolUnit=set.sampleVolUnit||"uL";
      var spikeVolUL=volToUL(spikeVolRaw, spikeVolUnit)||0;
      var sampleVolUL=volToUL(sampleVolRaw, sampleVolUnit)||0;
      var totalVolUL=sampleVolUL+spikeVolUL;
      var expectedMgMl=stockMgMl!=null && totalVolUL>0 ? stockMgMl*(spikeVolUL/totalVolUL) : null;
      var expected=expectedMgMl!=null?mgMlToUnit(expectedMgMl,unit):null;
      var endoConcVal=endo?endo.conc:null;
      var spikedConcVal=spiked?spiked.conc:null;
      var recovery=(endo&&spiked&&endoConcVal!=null&&spikedConcVal!=null&&expected&&expected!==0)?(((spikedConcVal-endoConcVal)/expected)*100):null;
      var spikeMassMg=stockMgMl!=null?stockMgMl*(spikeVolUL/1000):null;
      // Warnings
      var warnSpikePct = (totalVolUL>0 && spikeVolUL/totalVolUL>0.10);
      var spikePctOfTotal = totalVolUL>0 ? spikeVolUL/totalVolUL : null;
      // Expected spike vs curve range: compare to sample concentrations in the curve
      var plateRes = res[pi];
      var warnOutOfRange = false;
      var curveMaxSample = null;
      var curveMinSample = null;
      if(plateRes && expected!=null){
        // Build the in-sample concentration range the curve can quantify, accounting for sample dilution
        var scPts = plateRes.sc.pts;
        if(scPts && scPts.length){
          var wellMax = Math.max.apply(null, scPts.map(function(p){return p.conc;}));
          var wellMin = Math.min.apply(null, scPts.map(function(p){return p.conc;}));
          var xf1 = pDil(cfg.xdf), xs = pDil(cfg.xds);
          // First-dilution sample range (least diluted; widest quantifiable)
          if(!isNaN(xf1)){
            curveMaxSample = wellMax / xf1;
            curveMinSample = wellMin / xf1;
          }
        }
        // Expected spike itself is a concentration in the neat sample; compare against what the assay could see at the spiked sample's selected dilution
        // If spiked was quantified, check whether measured - endo is plausibly within curve bounds
        if(curveMaxSample!=null && (expected > curveMaxSample*5 || expected < curveMinSample*0.05)){
          warnOutOfRange = true;
        }
      }
      // Unit mismatch flag: if stock unit converts to an order of magnitude mismatch vs readout unit
      var warnUnitMismatch = false;
      if(stockMgMl!=null && expected!=null){
        // If expected spike in readout units is absurdly small (<0.001 of min sample conc) or huge (>1000x max), flag
        if(curveMaxSample!=null && (expected > curveMaxSample*1000 || (expected < curveMaxSample*0.0001 && expected > 0))){
          warnUnitMismatch = true;
        }
      }
      var warnRecoveryBound = recovery!=null ? (recovery<80 || recovery>120) : false;
      // Low-spike regime: spike/endogenous ratio. If endo ~ 0, ratio undefined -> no warning
      var warnLowSpikeRegime = false;
      var spikeEndoRatio = null;
      if(expected!=null && endoConcVal!=null && endoConcVal>0){
        spikeEndoRatio = expected/endoConcVal;
        if(spikeEndoRatio < 0.25) warnLowSpikeRegime = true;
      }
      // Per-dilution recovery: walk every dilution level, compute recovery if both unspiked and spiked are quantifiable & qualified.
      // Note: expected spike concentration in the FINAL MIX is the same regardless of which dilution we look at — it's a property
      // of the mixing setup, not the readout. What changes per-dilution is the measured unspiked and spiked concentrations.
      var perDilution = [];
      if(res && res[pi]){
        var spikedSamp = res[pi].samps[spikedIdx];
        var endoSamp = set.noEndo ? null : res[pi].samps[endoIdx];
        if(spikedSamp && spikedSamp.dils){
          for(var di=0; di<spikedSamp.dils.length; di++){
            var spD = spikedSamp.dils[di];
            var enD = endoSamp ? endoSamp.dils[di] : null;
            // Both must exist; spiked must be qualified+IR; endo must be qualified+IR (unless noEndo override)
            var spOK = spD && spD.ir && spD.cS!=null && spD.cv<=0.20;
            var enOK = set.noEndo ? true : (enD && enD.ir && enD.cS!=null && enD.cv<=0.20);
            var enConc = set.noEndo ? 0 : (enD ? enD.cS : null);
            var spConc = spD ? spD.cS : null;
            var rec = null;
            var note = null;
            if(!spD){ note = "no measurement"; }
            else if(!spOK && !enOK){ note = "neither in-range/qualified"; }
            else if(!spOK){ note = "spiked out of range or CV>20%"; }
            else if(!enOK){ note = "unspiked out of range or CV>20%"; }
            else if(spConc!=null && enConc!=null && expected!=null && expected!==0){
              rec = ((spConc - enConc) / expected) * 100;
            }
            perDilution.push({
              di: di,
              dilLabel: spD ? spD.di : di,
              endoConc: enConc,
              spikedConc: spConc,
              recovery: rec,
              spikedQualified: spOK,
              endoQualified: enOK,
              note: note
            });
          }
        }
      }
      // Find the dilution that the active strategy would choose
      var chosenDilSpiked = null;
      var chosenDilEndo = null;
      if(res && res[pi]){
        var ssAS = res[pi].samps[spikedIdx];
        var esAS = set.noEndo ? null : res[pi].samps[endoIdx];
        if(ssAS && ssAS.aS && ssAS.aS[sm]) chosenDilSpiked = ssAS.aS[sm].dil;
        if(esAS && esAS.aS && esAS.aS[sm]) chosenDilEndo = esAS.aS[sm].dil;
      }
      return {
        key:idx,
        plate:pi+1,
        plateIdx:pi,
        spikedIdx:spikedIdx,
        endoIdx:endoIdx,
        spikeProtein:set.spikeProtein||cfg.sn,
        endogenousName:set.noEndo?"(overridden: assumed 0)":sampleNameFor(pi,endoIdx,"Sample "+(endoIdx+1)),
        spikedName:sampleNameFor(pi,spikedIdx,"Sample "+(spikedIdx+1)),
        endogenousConc:endoConcVal,
        spikedConc:spikedConcVal,
        expectedSpike:expected,
        recovery:recovery,
        spikeVol:spikeVolUL,
        sampleVol:sampleVolUL,
        totalVol:totalVolUL,
        spikeVolRaw:spikeVolRaw,
        spikeVolUnit:spikeVolUnit,
        sampleVolRaw:sampleVolRaw,
        sampleVolUnit:sampleVolUnit,
        stockConc:set.stockConc,
        stockUnit:set.stockUnit,
        spikeMassMg:spikeMassMg,
        noEndo:!!set.noEndo,
        warnSpikePct:warnSpikePct,
        spikePctOfTotal:spikePctOfTotal,
        warnOutOfRange:warnOutOfRange,
        warnUnitMismatch:warnUnitMismatch,
        warnRecoveryBound:warnRecoveryBound,
        warnLowSpikeRegime:warnLowSpikeRegime,
        spikeEndoRatio:spikeEndoRatio,
        perDilution:perDilution,
        chosenDilSpiked:chosenDilSpiked,
        chosenDilEndo:chosenDilEndo
      };
    });
  };
  // Per-sample accuracy lookup: find the spike-set row(s) where this sample was the spiked side
  var spikeRowsForSample=function(pi,si){
    if(cfg.spikeUsed!=="yes") return [];
    var rows=spikeRows();
    return rows.filter(function(r){return r.plateIdx===pi && r.spikedIdx===si;});
  };
  // Run-level QC summary: summarize recovery across all spike sets
  var runQC=function(){
    if(cfg.spikeUsed!=="yes") return null;
    var rows=spikeRows();
    if(!rows.length) return null;
    var withRec=rows.filter(function(r){return r.recovery!=null;});
    if(!withRec.length) return {nSets:rows.length, nWithRec:0, recoveries:[], passing:null, status:"no-data"};
    var recoveries=withRec.map(function(r){return r.recovery;});
    var allPass=withRec.every(function(r){return r.recovery>=80 && r.recovery<=120;});
    var allFail=withRec.every(function(r){return r.recovery<80 || r.recovery>120;});
    var minR=Math.min.apply(null,recoveries), maxR=Math.max.apply(null,recoveries);
    var meanR=recoveries.reduce(function(s,v){return s+v;},0)/recoveries.length;
    var nOverride=rows.filter(function(r){return r.noEndo;}).length;
    return {
      nSets:rows.length,
      nWithRec:withRec.length,
      recoveries:recoveries,
      minR:minR, maxR:maxR, meanR:meanR,
      allPass:allPass, allFail:allFail,
      anyOverride:nOverride>0,
      nOverride:nOverride,
      status:allPass?"pass":(allFail?"fail":"mixed")
    };
  };
  var confirmAnalyze=function(){
    // Pre-flight: check that at least one plate has any numeric data
    var hasAnyData = false;
    for(var p=0; p<np; p++){
      var plate = pl[p];
      if(!plate) continue;
      for(var r=0; r<plate.length; r++){
        for(var c=0; c<plate[r].length; c++){
          var v = plate[r][c];
          if(v && !isNaN(parseFloat(v))){ hasAnyData = true; break; }
        }
        if(hasAnyData) break;
      }
      if(hasAnyData) break;
    }
    if(!hasAnyData){
      window.alert("No plate data yet. Paste or enter absorbance values into the plate grid (Data Entry tab), or click \"Load demo\" to try it out with sample data.");
      return;
    }
    // Pre-flight: check dilution factors parse
    var scVal=parseFloat(cfg.sc), df1=pDil(cfg.sdf), ds=pDil(cfg.sds), xf1=pDil(cfg.xdf), xs=pDil(cfg.xds);
    var bad = [];
    if(isNaN(scVal) || scVal<=0) bad.push("stock concentration");
    if(isNaN(df1)) bad.push("standard first-row dilution");
    if(isNaN(ds)) bad.push("standard remaining-rows dilution");
    if(isNaN(xf1)) bad.push("sample first-row dilution");
    if(isNaN(xs)) bad.push("sample remaining-rows dilution");
    if(bad.length){
      window.alert("Cannot analyze: please fix these field(s) — "+bad.join(", ")+".\n\nDilution factors should be entered as '1/2' (for 1:2 dilution), '1/10', etc.");
      return;
    }
    // No confirmation dialog — user already clicked the Analyze button intentionally.
    // Run analysis and navigate to Analysis tab.
    analyze();
  };

  if(!on) return (
    <div style={{padding:"1.25rem 0 2.5rem",maxWidth:1060}}>
      <div style={{background:"linear-gradient(180deg,#f4f9fd,#eef5fb)",border:"1px solid "+BORDER,borderRadius:20,marginBottom:"1rem",boxShadow:SHADOW,overflow:"hidden"}}>
        <PageHeader instructor={instructor} setInstructor={setInstructor} />
        <div style={{padding:"6px 16px 14px",fontSize:12,color:"#6f7fa0",fontStyle:"italic"}}>Plate-based assay analysis and quantitation</div>
      </div>
      <div style={{background:"linear-gradient(180deg,#ffffff,#fbfdff)",borderRadius:24,border:"1px solid "+BORDER,padding:"1.5rem",boxShadow:"0 18px 44px rgba(11,42,111,0.08)",marginBottom:"1.25rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:"1rem",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:21,fontWeight:800,color:"#18233f",marginBottom:5}}>Assay setup</div>
            <div style={{fontSize:13,color:"#6f7fa0"}}>Choose plates and replicate layout before opening the workspace.</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1.25fr 1fr",gap:"1rem"}}>
          <div style={{background:"linear-gradient(180deg,#fbfeff,#f4fbff)",border:"1px solid #e5edf7",borderRadius:20,padding:"1.2rem 1.25rem",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.8)"}}>
            <label style={{display:"block",fontSize:13,fontWeight:800,marginBottom:12,color:"#18233f"}}>How many plates?</label>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
              {[1,2,3,4,5].map(function(n){var sel=String(n)===cfg.np;return <button key={n} onClick={function(){u("np",String(n));}} style={{width:58,height:58,borderRadius:16,border:"1.5px solid "+(sel?TEAL:"#d8dfeb"),background:sel?"#eefcfd":"#fff",color:sel?NAVY:"#1d1d1f",fontSize:21,fontWeight:700,cursor:"pointer",boxShadow:sel?"0 8px 20px rgba(19,156,182,0.10)":"none"}}>{n}</button>;})}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:12,color:"#6f7fa0"}}>Use a different plate count:</span>
              <input type="number" min="1" max="24" value={cfg.np} onChange={function(e){u("np",e.target.value);}} style={{width:84,padding:"10px 12px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}} />
            </div>
          </div>
          <div style={{background:"linear-gradient(180deg,#fbfeff,#f4fbff)",border:"1px solid #e5edf7",borderRadius:20,padding:"1.2rem 1.25rem",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.8)"}}>
            {cfg.layout==="transposed" ? <div>
              <label style={{display:"block",fontSize:13,fontWeight:800,marginBottom:7,color:"#18233f"}}>Replicate setup</label>
              <div style={{fontSize:11,color:"#6f7fa0",marginBottom:10,lineHeight:1.5}}>The plate is two side-by-side mini-plates (left half and right half). Each replicate takes one half-row. Replicates of the same analyte stack vertically within a half — duplicate = 2 rows, triplicate = 3 rows.</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.9rem"}}>
                <div>
                  <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Standard replicates</label>
                  <select value={cfg.sr} onChange={function(e){u("sr",e.target.value);}} style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}}>
                    <option value="1">Singlicate (1 half-row)</option>
                    <option value="2">Duplicate (2 half-rows)</option>
                    <option value="3">Triplicate (3 half-rows)</option>
                  </select>
                </div>
                <div>
                  <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Sample replicates</label>
                  <select value={cfg.xr} onChange={function(e){u("xr",e.target.value);}} style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}}>
                    <option value="1">Singlicate (1 half-row each)</option>
                    <option value="2">Duplicate (2 half-rows each)</option>
                    <option value="3">Triplicate (3 half-rows each)</option>
                  </select>
                </div>
              </div>
              <div style={{fontSize:11,color:"#5a6984",marginTop:8,padding:"7px 10px",background:"#f7f1ff",borderRadius:8,border:"1px solid #e2d7fb",lineHeight:1.5}}>
                {(function(){
                  var srN=parseInt(cfg.sr)||2, xrN=parseInt(cfg.xr)||2;
                  if(srN<1) srN=1; if(xrN<1) xrN=1;
                  // 8 rows × 2 halves = 16 half-row slots
                  var stdHalves = srN;
                  var sampleHalves = 16 - stdHalves;
                  var sampleCount = Math.floor(sampleHalves / xrN);
                  var leftover = sampleHalves - sampleCount*xrN;
                  var repWord = xrN===1?"singlicate":(xrN===2?"duplicate":"triplicate");
                  var stdWord = srN===1?"1 half-row":(srN===2?"2 half-rows":"3 half-rows");
                  return <span><strong>This setup:</strong> {sampleCount} samples possible ({repWord}, {xrN} half-row{xrN===1?"":"s"} each). Standard occupies {stdWord}.{leftover>0?" "+leftover+" half-row"+(leftover===1?"":"s")+" unused.":""}</span>;
                })()}
              </div>
            </div> : <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.9rem"}}>
              <div><label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Standard replicates</label><select value={cfg.sr} onChange={function(e){u("sr",e.target.value);}} style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}}><option value="1">Singlicate</option><option value="2">Duplicate</option><option value="3">Triplicate</option></select></div>
              <div><label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Sample replicates</label><select value={cfg.xr} onChange={function(e){u("xr",e.target.value);}} style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}}><option value="1">Singlicate</option><option value="2">Duplicate</option><option value="3">Triplicate</option></select></div>
            </div>}
          </div>
        </div>
        <div style={{marginTop:"1.25rem",background:"linear-gradient(180deg,#fbfeff,#f4fbff)",border:"1px solid #e5edf7",borderRadius:20,padding:"1.2rem 1.25rem",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.8)"}}>
          <label style={{display:"block",fontSize:13,fontWeight:800,marginBottom:4,color:"#18233f"}}>Plate layout</label>
          <div style={{fontSize:12,color:"#6f7fa0",marginBottom:14}}>Pick the orientation that matches how you load your plate. The math is the same; only the wells map differently.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            {(function(){
              var renderOpt=function(id, title, blurb, svg){
                var sel = cfg.layout===id;
                return <button key={id} onClick={function(){u("layout",id);}} style={{textAlign:"left",cursor:"pointer",border:"2px solid "+(sel?TEAL:"#d8dfeb"),background:sel?"#eefcfd":"#fff",borderRadius:14,padding:"12px 14px",boxShadow:sel?"0 8px 20px rgba(19,156,182,0.10)":"none",transition:"all 0.15s"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <span style={{fontSize:14,fontWeight:800,color:sel?NAVY:"#18233f"}}>{title}</span>
                    {sel && <span style={{fontSize:10,color:TEAL,fontWeight:700,padding:"2px 7px",background:"#fff",borderRadius:10,border:"1px solid "+TEAL}}>SELECTED</span>}
                  </div>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:8}}>{svg}</div>
                  <div style={{fontSize:11,color:"#6f7fa0",lineHeight:1.5}}>{blurb}</div>
                </button>;
              };
              // Classical SVG: actual 96-well plate look, with sample-name labels and dilution fade
              var wellsSvg = function(opts){
                // opts: {mode: "classical"|"transposed", cellFill(r,c) -> {fill, opacity, label?}, topLabels: [{startCol,span,text,color}], sideLabels?: ...}
                // Transposed needs extra horizontal room for side labels; classical only needs space below for top-aligned labels.
                var sideLabelW = opts.mode==="transposed" ? 60 : 0;
                var W = 320 + sideLabelW, H = 200;
                var plateX = 20, plateY = 16, plateW = (320 - 40), plateH = H - 54;
                var cols = 12, rows = 8;
                var gridX = plateX + 22, gridY = plateY + 18;
                var wellW = (plateW - 26) / cols;
                var wellH = (plateH - 22) / rows;
                var wellR = Math.min(wellW, wellH) * 0.38;
                return <svg viewBox={"0 0 "+W+" "+H} width={W} height={H} xmlns="http://www.w3.org/2000/svg">
                  {/* Plate outer shell */}
                  <rect x={plateX} y={plateY} width={plateW} height={plateH} rx={8} fill="#eef2f7" stroke="#9aa4b8" strokeWidth="1"/>
                  {/* Column numbers */}
                  {Array.from({length:cols}).map(function(_,c){
                    return <text key={"cn"+c} x={gridX + wellW*c + wellW/2} y={gridY-6} fontSize="6.5" fill="#6e6e73" textAnchor="middle" fontFamily="system-ui">{c+1}</text>;
                  })}
                  {/* Row letters */}
                  {Array.from({length:rows}).map(function(_,r){
                    return <text key={"rl"+r} x={plateX+10} y={gridY + wellH*r + wellH/2 + 2} fontSize="6.5" fill="#6e6e73" textAnchor="middle" fontFamily="system-ui">{String.fromCharCode(65+r)}</text>;
                  })}
                  {/* Wells */}
                  {Array.from({length:rows}).flatMap(function(_,r){
                    return Array.from({length:cols}).map(function(_,c){
                      var info = opts.cellFill(r,c);
                      var cx = gridX + wellW*c + wellW/2;
                      var cy = gridY + wellH*r + wellH/2;
                      return <circle key={r+"-"+c} cx={cx} cy={cy} r={wellR} fill={info.fill} fillOpacity={info.opacity} stroke="#8a94ab" strokeOpacity="0.35" strokeWidth="0.5"/>;
                    });
                  })}
                  {/* Top labels (classical only) */}
                  {(opts.topLabels||[]).map(function(tl,i){
                    var cx = gridX + wellW*tl.startCol + wellW*tl.span/2;
                    return <g key={"tl"+i}>
                      <rect x={gridX + wellW*tl.startCol + 1} y={gridY + rows*wellH + 4} width={wellW*tl.span - 2} height={12} fill={tl.bg||"#fff"} stroke={tl.color} strokeWidth="0.8" rx={3}/>
                      <text x={cx} y={gridY + rows*wellH + 13} fontSize="7.5" fill={tl.color} textAnchor="middle" fontFamily="system-ui" fontWeight="700">{tl.text}</text>
                    </g>;
                  })}
                  {/* Side labels (transposed only). Each entry can be:
                       single: {row, text, color, bg}
                       split:  {row, split: {left:{text,color,bg}, right:{text,color,bg}}}
                  */}
                  {(opts.sideLabels||[]).map(function(sl,i){
                    var cy = gridY + wellH*sl.row + wellH/2;
                    var labelX = plateX + plateW + 4;
                    var labelW = 54;
                    if(sl.split){
                      var halfH = 8;
                      var lTop = cy - halfH - 1;
                      var rTop = cy + 1;
                      var L = sl.split.left, R = sl.split.right;
                      return <g key={"sl"+i}>
                        {/* Left-half label */}
                        <rect x={labelX} y={lTop} width={labelW} height={halfH} fill={L.bg||"#fff"} stroke={L.color} strokeWidth="0.6" rx={2}/>
                        <text x={labelX + labelW/2} y={lTop + halfH - 1.5} fontSize="6" fill={L.color} textAnchor="middle" fontFamily="system-ui" fontWeight="700">{L.text}</text>
                        {/* Right-half label */}
                        <rect x={labelX} y={rTop} width={labelW} height={halfH} fill={R.bg||"#fff"} stroke={R.color} strokeWidth="0.6" rx={2}/>
                        <text x={labelX + labelW/2} y={rTop + halfH - 1.5} fontSize="6" fill={R.color} textAnchor="middle" fontFamily="system-ui" fontWeight="700">{R.text}</text>
                      </g>;
                    }
                    return <g key={"sl"+i}>
                      <rect x={labelX} y={cy - 5} width={labelW} height={10} fill={sl.bg||"#fff"} stroke={sl.color} strokeWidth="0.8" rx={3}/>
                      <text x={labelX + labelW/2} y={cy + 3} fontSize="7" fill={sl.color} textAnchor="middle" fontFamily="system-ui" fontWeight="700">{sl.text}</text>
                    </g>;
                  })}
                  {/* Dilution direction arrow */}
                  {opts.mode==="classical" ? <g>
                    <line x1={plateX+plateW+2} y1={gridY+wellH*0.5} x2={plateX+plateW+2} y2={gridY+wellH*6.5} stroke="#6e6e73" strokeWidth="1" markerEnd="url(#arrow-down)"/>
                    <text x={plateX+plateW+7} y={gridY+wellH*3.5} fontSize="6.5" fill="#6e6e73" fontFamily="system-ui" writingMode="tb" textAnchor="middle">dilute</text>
                  </g> : <g>
                    <line x1={gridX+wellW*0.5} y1={plateY+plateH+8} x2={gridX+wellW*4.5} y2={plateY+plateH+8} stroke="#6e6e73" strokeWidth="1" markerEnd="url(#arrow-right)"/>
                    <text x={gridX+wellW*2.5} y={plateY+plateH+18} fontSize="6.5" fill="#6e6e73" fontFamily="system-ui" textAnchor="middle">dilute</text>
                    <line x1={gridX+wellW*6.5} y1={plateY+plateH+8} x2={gridX+wellW*10.5} y2={plateY+plateH+8} stroke="#6e6e73" strokeWidth="1" markerEnd="url(#arrow-right2)"/>
                    <text x={gridX+wellW*8.5} y={plateY+plateH+18} fontSize="6.5" fill="#6e6e73" fontFamily="system-ui" textAnchor="middle">dilute</text>
                  </g>}
                  <defs>
                    <marker id="arrow-down" viewBox="0 0 10 10" refX="5" refY="10" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 5 10 L 10 0" fill="#6e6e73"/></marker>
                    <marker id="arrow-right" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 10 5 L 0 10" fill="#6e6e73"/></marker>
                    <marker id="arrow-right2" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 10 5 L 0 10" fill="#6e6e73"/></marker>
                  </defs>
                </svg>;
              };
              // Sample color palette for the graphic — distinct hues, warm-leaning so samples read as a family.
              // Order chosen so adjacent samples are visually distinguishable.
              var sampleColors = [
                {fill:"#c99a3a", text:"#8a4000", bg:"#fff4e5"},  // amber/orange
                {fill:"#8a7ad8", text:"#3a2e7a", bg:"#ebe8fa"},  // lavender
                {fill:"#d670a0", text:"#8a1f5a", bg:"#fbe8f0"},  // pink
                {fill:"#7ab07a", text:"#1a5a2a", bg:"#e8f4e8"},  // sage
                {fill:"#d8b440", text:"#6a4f10", bg:"#faf0c8"},  // yellow
                {fill:"#5fa0d0", text:"#1a4a7a", bg:"#e0eef8"},  // sky blue
                {fill:"#d88060", text:"#7a2510", bg:"#fbe5dc"},  // coral
                {fill:"#a880d0", text:"#4a2080", bg:"#f0e8fa"},  // violet
                {fill:"#5fb0a0", text:"#0f5a4a", bg:"#dff0ec"},  // mint
                {fill:"#d09060", text:"#7a4510", bg:"#fbecdc"},  // peach
                {fill:"#b080c0", text:"#5a2a6a", bg:"#f0e3f5"},  // mauve
                {fill:"#80a0d0", text:"#1a3a7a", bg:"#e3edf8"},  // dusty blue
                {fill:"#c0a880", text:"#5a4a10", bg:"#f5f0dc"},  // beige
                {fill:"#d08080", text:"#7a1a1a", bg:"#fbe5e5"},  // warm pink
                {fill:"#80b0c0", text:"#1a5a7a", bg:"#dff0f5"},  // pale teal
              ];
              var stdColor = {fill:"#0f8aa2", text:"#0f5c6a", bg:"#dbf0f4"};

              // === CLASSICAL GRAPHIC (data-driven from sr, xr) ===
              var srN = parseInt(cfg.sr) || 3;
              var xrN = parseInt(cfg.xr) || 3;
              var classicalSvg = (function(){
                // Compute group structure: 1 std (cols 0..sr-1), then samples each `xr` cols wide until plate full
                var groups = [{type:"std", startCol:0, span:srN, name:"Std", colors:stdColor}];
                var c = srN, sIdx = 0;
                while(c + xrN <= 12){
                  groups.push({type:"smp", startCol:c, span:xrN, name:"Sample "+(sIdx+1), colors:sampleColors[sIdx % sampleColors.length]});
                  c += xrN; sIdx++;
                }
                var cellFill = function(r,c){
                  if(r===7) return {fill:"#c9ced8", opacity:0.5};
                  for(var gi=0;gi<groups.length;gi++){
                    var g=groups[gi];
                    if(c>=g.startCol && c<g.startCol+g.span){
                      var op = 0.92 - r*0.12;
                      return {fill:g.colors.fill, opacity:Math.max(0.15, op)};
                    }
                  }
                  return {fill:"#fff", opacity:0.3};
                };
                var topLabels = groups.map(function(g){
                  return {startCol:g.startCol, span:g.span, text:g.name, color:g.colors.text, bg:g.colors.bg};
                });
                return wellsSvg({mode:"classical", cellFill:cellFill, topLabels:topLabels});
              })();

              // === TRANSPOSED GRAPHIC (data-driven from sr, xr) ===
              var transposedSvg = (function(){
                var srT = (cfg.layout==="transposed") ? (parseInt(cfg.sr)||2) : 2;
                var xrT = (cfg.layout==="transposed") ? (parseInt(cfg.xr)||2) : 2;
                if(srT<1) srT=1; if(xrT<1) xrT=1;
                // Slot enumeration: half-first
                var slotList = [];
                for(var h=0; h<2; h++) for(var rr=0; rr<8; rr++) slotList.push({row:rr, halfIdx:h});
                // Build group ownership map: which slot belongs to which group
                var slotOwner = {}; // key: row+"-"+halfIdx → {type, sIdx (or null), colors}
                var stdSlots = slotList.slice(0, srT);
                stdSlots.forEach(function(s){slotOwner[s.row+"-"+s.halfIdx] = {type:"std", colors:stdColor, name:"Std"};});
                var remaining = slotList.slice(srT);
                var sIdx2 = 0;
                while(remaining.length >= xrT){
                  var theseSlots = remaining.slice(0, xrT);
                  var col = sampleColors[sIdx2 % sampleColors.length];
                  theseSlots.forEach(function(s){slotOwner[s.row+"-"+s.halfIdx] = {type:"smp", sIdx:sIdx2, colors:col, name:"Sample "+(sIdx2+1)};});
                  remaining = remaining.slice(xrT);
                  sIdx2++;
                }
                var cellFill = function(r,c){
                  var isBlank = c===5 || c===11;
                  if(isBlank) return {fill:"#c9ced8", opacity:0.5};
                  var halfIdx = c<6 ? 0 : 1;
                  var owner = slotOwner[r+"-"+halfIdx];
                  if(!owner) return {fill:"#e8e8eb", opacity:0.3};
                  var dilIdx = c<5 ? c : c-6;
                  var op = 0.92 - dilIdx*0.16;
                  return {fill:owner.colors.fill, opacity:Math.max(0.15, op)};
                };
                // Side labels: one per row. If left and right halves are the same group, single label;
                // if they differ, split label showing both clearly.
                var sideLabels = [];
                for(var r=0;r<8;r++){
                  var ownerL = slotOwner[r+"-0"];
                  var ownerR = slotOwner[r+"-1"];
                  if(ownerL && ownerR && ownerL.name===ownerR.name){
                    sideLabels.push({row:r, text:ownerL.name, color:ownerL.colors.text, bg:ownerL.colors.bg});
                  } else if(ownerL || ownerR){
                    var L = ownerL ? {text:ownerL.name, color:ownerL.colors.text, bg:ownerL.colors.bg}
                                   : {text:"—", color:"#aeaeb2", bg:"#f4f4f6"};
                    var R = ownerR ? {text:ownerR.name, color:ownerR.colors.text, bg:ownerR.colors.bg}
                                   : {text:"—", color:"#aeaeb2", bg:"#f4f4f6"};
                    sideLabels.push({row:r, split:{left:L, right:R}});
                  } else {
                    sideLabels.push({row:r, text:"unused", color:"#aeaeb2", bg:"#f4f4f6"});
                  }
                }
                return wellsSvg({mode:"transposed", cellFill:cellFill, sideLabels:sideLabels});
              })();
              return [
                renderOpt("classical","Classical (column-wise)","Each column is one sample (or the standard). Each row is a dilution step. Bottom row is the blank. The default for hand-loaded plates and most ELISA workflows.",classicalSvg),
                renderOpt("transposed","Transposed (Andrew+ / row-wise)","Each row is one sample. Each column is a dilution step. The middle and last columns are blanks. Up to 16 sample slots (8 rows × 2 halves) — pair both halves for replicates, or run singlicates and fit twice as many samples.",transposedSvg)
              ];
            })()}
          </div>
        </div>
        <div style={{display:"flex",gap:12,marginTop:"1.35rem",alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={function(){setOn(true);setTab(0);setPlanningMode(false);}} style={{background:"linear-gradient(135deg,"+TEAL_DARK+","+NAVY+")",color:"#fff",border:"none",padding:"11px 22px",borderRadius:12,fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:"0 10px 22px rgba(11,42,111,0.12)"}}>Continue to workspace</button>
          <button onClick={demo} style={{background:"transparent",border:"1px solid #d8dfeb",padding:"11px 18px",borderRadius:12,fontSize:12,color:"#6e6e73",cursor:"pointer",fontWeight:600}}>Load demo</button>
          <span style={{fontSize:11,color:"#6f7fa0"}}>The app will wait here until setup is confirmed.</span>
        </div>
        <div style={{marginTop:"1.1rem",paddingTop:"0.9rem",borderTop:"1px dashed #e0eaf4",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:"#8e9bb5"}}>Planning an experiment?</span>
          <button onClick={function(){setOn(true);setTab(4);setPlanningMode(true);}} style={{background:"transparent",border:"none",fontSize:11,color:"#30437a",cursor:"pointer",fontWeight:600,textDecoration:"underline",textDecorationStyle:"dotted",padding:0}}>Open Tools (no plate data required) →</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{padding:"1rem 0",maxWidth:1040}}>
      <div style={{background:"linear-gradient(180deg,#f4f9fd,#eef5fb)",border:"1px solid "+BORDER,borderRadius:20,marginBottom:"1rem",boxShadow:SHADOW,overflow:"hidden"}}>
        <PageHeader instructor={instructor} setInstructor={setInstructor} />
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"8px 16px 10px"}}>
          <div onClick={htc} style={{fontSize:11,color:"#6e6e73",cursor:"default",userSelect:"none"}}>{np} plate{np>1?"s":""} · {unit}{instructor?" · Instructor mode":""}</div>
          <button onClick={reset} style={{background:"#f7f9fc",border:"1px solid #d8dfeb",padding:"6px 14px",borderRadius:8,fontSize:11,color:"#6e6e73",cursor:"pointer",fontWeight:700}}>Reset</button>
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:"1.25rem",background:"#eef3f8",borderRadius:14,padding:5,border:"1px solid #e2e9f2"}}>{TABS.map(function(l,i){return <button key={i} onClick={function(){setTab(i);}} style={{flex:1,padding:"9px 14px",fontSize:12,fontWeight:i===tab?700:500,cursor:"pointer",background:i===tab?"#fff":"transparent",color:i===tab?NAVY:"#6e6e73",border:"none",borderRadius:10,boxShadow:i===tab?"0 4px 14px rgba(11,42,111,0.08)":"none"}}>{l}</button>;})}
      {dbg&&<button onClick={function(){setTab(5);}} style={{padding:"9px 14px",fontSize:12,fontWeight:tab===5?700:500,cursor:"pointer",background:tab===5?"#fef3e2":"transparent",color:tab===5?"#a05a00":"#aeaeb2",border:"none",borderRadius:10}}>Debug</button>}</div>

      {/* DATA ENTRY */}
      {tab===0&&(<div>
        <div style={{background:"#edf9fb",borderRadius:14,padding:"12px 16px",marginBottom:"1rem",border:"1px solid #d9eef2"}}><p style={{margin:0,fontSize:13,color:"#0f5c4d"}}>Paste data into the first cell. Analysts can leave the optional sample name list collapsed and work directly from the familiar plate grid.</p></div>
        {Array.from({length:np},function(_,pi){
          var isTransposed = layout.axis==="row";
          var dilsPerRep = layout.dilsPerRep || 5;
          var halfWidth = layout.halfWidth || Math.floor(totalCols/2);

          // === SHARED: cell-coloring and label-resolution helpers ===
          // For both layouts, we need to know: (a) the analyte/group at a given (r,c), and (b) the cell's bg color.
          var groupAt = function(r, c){
            // Classical: column-aligned groups
            if(!isTransposed){
              for(var gi=0; gi<layout.groups.length; gi++){
                var g = layout.groups[gi];
                if(c>=g.startCol && c<g.startCol+g.cols) return {group:g, groupIdx:gi};
              }
              return null;
            }
            // Transposed: slot-aligned. Determine half from c, then look up which group owns (r, halfIdx).
            var halfIdx = c < halfWidth ? 0 : 1;
            for(var gi2=0; gi2<layout.groups.length; gi2++){
              var g2 = layout.groups[gi2];
              if(!g2.slots) continue;
              for(var si=0; si<g2.slots.length; si++){
                if(g2.slots[si].row===r && g2.slots[si].halfIdx===halfIdx) return {group:g2, groupIdx:gi2};
              }
            }
            return null;
          };
          var colorForCell = function(r, c){
            var grpInfo = groupAt(r, c);
            if(!grpInfo) return null;
            if(grpInfo.group.type==="std") return GC[0];
            var sidx = layout.groups.slice(0, grpInfo.groupIdx).filter(function(gg){return gg.type==="smp";}).length;
            return GC[(sidx+1)%GC.length];
          };
          var isBlankCell = function(r, c){
            if(isTransposed){
              return c === halfWidth-1 || c === totalCols-1;
            }
            // Classical: bottom row is blank
            return r === totalRows2-1;
          };

          // Tooltip describing what's at a given cell — shows sample name, replicate, dilution
          // Useful when sample names truncate in the visible labels.
          var cellTooltip = function(r, c){
            if(isBlankCell(r, c)) return "Blank well";
            var grpInfo = groupAt(r, c);
            if(!grpInfo) return "";
            var g = grpInfo.group;
            var name;
            if(g.type==="std"){
              name = cfg.sn + " standard";
            } else {
              var sidx = layout.groups.slice(0, grpInfo.groupIdx).filter(function(gg){return gg.type==="smp";}).length;
              name = sampleNameFor(pi, sidx, g.name);
            }
            // Determine rep & dilution position based on layout
            if(!isTransposed){
              // Classical: replicate = column within group; dilution = row index
              var rep = c - g.startCol + 1;
              var dil = r + 1;
              return name + " — Rep " + rep + ", Dilution " + dil;
            }
            // Transposed: replicate = which slot within this group's slot list contains (r, halfIdx);
            // dilution = column index within the half
            var halfIdx = c < halfWidth ? 0 : 1;
            var rep2 = 1;
            for(var si=0; si<g.slots.length; si++){
              if(g.slots[si].row===r && g.slots[si].halfIdx===halfIdx){ rep2 = si + 1; break; }
            }
            var dil2 = (c < halfWidth ? c : c - halfWidth) + 1;
            return name + " — Rep " + rep2 + ", Dilution " + dil2;
          };

          // === COLUMN HEADERS ===
          // Classical: row 1 = sample-name labels (colSpan groups); row 2 = "Rep N" within each group
          // Transposed: ONE header row showing "Dil 1, Dil 2, ..., Blank, Dil 1, ..., Blank"
          //            (mimics the classical "Rep 1, Rep 2, Rep 3" structure but with dil labels)
          var classicalColHdr1 = layout.groups.map(function(g,gi){
            var gc = colorForCell(0, g.startCol) || GC[0];
            if(g.type==="std") return <th key={gi} colSpan={g.cols} style={{border:"1px solid #bbb",padding:"8px 6px",background:gc.hd,color:gc.tx,textAlign:"center",fontSize:11,fontWeight:700,whiteSpace:"normal",wordBreak:"break-word"}}>{cfg.sn} standard</th>;
            var sidx = layout.groups.slice(0,gi).filter(function(gg){return gg.type==="smp";}).length;
            return <th key={gi} colSpan={g.cols} style={{border:"1px solid #bbb",padding:0,background:gc.hd,whiteSpace:"normal"}}><input value={sampleNameFor(pi,sidx,g.name)} onChange={function(e){hsnc(pi,sidx,e.target.value);}} style={{width:"100%",boxSizing:"border-box",border:"none",padding:"8px 6px",fontSize:11,fontFamily:"monospace",textAlign:"center",background:"transparent",color:gc.tx,fontWeight:700,outline:"none"}} /></th>;
          });
          var classicalColHdr2 = Array.from({length:totalCols},function(_,c){
            var gc = colColor(c);
            var rn=1;
            for(var gi2=0;gi2<layout.groups.length;gi2++){
              var g2=layout.groups[gi2];
              if(g2.axis==="col" && c>=g2.startCol && c<g2.startCol+g2.cols){rn=c-g2.startCol+1;break;}
            }
            return <th key={c} style={{border:"1px solid #d1d1d6",padding:4,textAlign:"center",fontSize:9,fontWeight:600,background:gc.bg,color:gc.tx,whiteSpace:"normal",wordBreak:"break-word"}}>Rep {rn}</th>;
          });
          // Transposed: dil/blank labels, color-tinted to indicate which half they belong to
          var transposedColHdr = Array.from({length:totalCols},function(_,c){
            var inFirstHalf = c < halfWidth;
            var idxInHalf = inFirstHalf ? c : c-halfWidth;
            var isBlank = idxInHalf===dilsPerRep;
            var label = isBlank ? "Blank" : "Dil "+(idxInHalf+1);
            // Light tint to indicate the two halves visually
            var bg = isBlank ? "#e8e8eb" : (inFirstHalf ? "#eef3f8" : "#f4eef8");
            var color = isBlank ? "#6e6e73" : (inFirstHalf ? "#30437a" : "#5a3a7a");
            return <th key={c} style={{border:"1px solid #bbb",padding:"8px 4px",background:bg,color:color,textAlign:"center",fontSize:10,fontWeight:700,whiteSpace:"normal",wordBreak:"break-word"}}>{label}</th>;
          });

          // === ROW LABELS ===
          // Single label column on the left of the data grid.
          // Classical: A-H letters.
          // Transposed: sample/standard name. If a row has two different analytes (singlicate or wraparound), shows both stacked.
          var rowLabelCell = function(r){
            if(!isTransposed){
              return <td style={{border:"1px solid #d1d1d6",padding:3,textAlign:"center",fontSize:10,fontWeight:600,background:"#f4f4f6",color:"#6e6e73"}}>{LE[r]}</td>;
            }
            // Transposed: figure out what's on this row
            var g0 = groupAt(r, 0), g1 = groupAt(r, halfWidth);
            var sampleIdxOf = function(grpInfo){
              return layout.groups.slice(0, grpInfo.groupIdx).filter(function(gg){return gg.type==="smp";}).length;
            };
            var renderName = function(grpInfo, side){
              if(!grpInfo) return <span style={{color:"#aeaeb2",fontSize:9,fontStyle:"italic"}}>—</span>;
              var g = grpInfo.group;
              var gc = colorForCell(r, side==="L" ? 0 : halfWidth) || GC[0];
              if(g.type==="std") return <div style={{padding:"4px 5px",background:gc.hd,color:gc.tx,fontSize:9,fontWeight:700,textAlign:"center",borderRadius:4,whiteSpace:"nowrap",lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis"}}>{cfg.sn} std</div>;
              var sidx = sampleIdxOf(grpInfo);
              return <input value={sampleNameFor(pi,sidx,g.name)} onChange={function(e){hsnc(pi,sidx,e.target.value);}} style={{width:"100%",boxSizing:"border-box",border:"none",padding:"4px 5px",fontSize:9,fontFamily:"monospace",textAlign:"center",background:gc.hd,color:gc.tx,fontWeight:700,outline:"none",borderRadius:4}} />;
            };
            var sameGroup = g0 && g1 && g0.groupIdx===g1.groupIdx;
            if(sameGroup){
              // One analyte on this row → centered single label
              return <td style={{border:"1px solid #bbb",padding:3,background:"#fafbfd",verticalAlign:"middle"}}>{renderName(g0,"L")}</td>;
            }
            // Two different analytes (or one missing) → stacked, with subtle "L"/"R" indicators
            return <td style={{border:"1px solid #bbb",padding:2,background:"#fafbfd",verticalAlign:"middle"}}>
              <div style={{display:"flex",alignItems:"center",gap:3,marginBottom:2}}>
                <span style={{fontSize:8,color:"#8e9bb5",fontWeight:600,minWidth:8}}>L</span>
                <div style={{flex:1,minWidth:0}}>{renderName(g0,"L")}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:3}}>
                <span style={{fontSize:8,color:"#8e9bb5",fontWeight:600,minWidth:8}}>R</span>
                <div style={{flex:1,minWidth:0}}>{renderName(g1,"R")}</div>
              </div>
            </td>;
          };

          // === DETECTION NOTE ===
          var detNote = "";
          if(det[pi]){
            if(isTransposed){
              detNote = "Layout: transposed — "+dilsPerRep+" dilutions, "+populatedSampleIdxs.length+" sample"+(populatedSampleIdxs.length===1?"":"s")+" with data";
              if(populatedSampleIdxs.length<smpGroups.length) detNote += " ("+(smpGroups.length-populatedSampleIdxs.length)+" empty slot"+(smpGroups.length-populatedSampleIdxs.length===1?"":"s")+" will be ignored)";
            } else {
              detNote = "Detected "+(det[pi].rows-1)+" dilutions + blank, "+populatedSampleIdxs.length+" sample"+(populatedSampleIdxs.length===1?"":"s")+" with data";
              if(populatedSampleIdxs.length<smpGroups.length) detNote += " ("+(smpGroups.length-populatedSampleIdxs.length)+" empty column group"+(smpGroups.length-populatedSampleIdxs.length===1?"":"s")+" will be ignored)";
            }
          }
          // The leftmost label structure is:
          //   classical: just A-H column (width 30)
          //   transposed: A-H column (width 24) + analyte label column (width 110)
          var labelColCount = isTransposed ? 2 : 1;
          var totalGridWidth = totalCols*70 + 30 + 4;
          return (<div key={pi} style={{marginBottom:"1.5rem"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,gap:10,flexWrap:"wrap"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#30437a"}}>Plate {pi+1}{isTransposed?<span style={{fontSize:11,fontWeight:500,color:"#6337b9",marginLeft:8,padding:"2px 8px",background:"#f7f1ff",borderRadius:4}}>Transposed (Andrew+) layout</span>:null}</div>
              <button onClick={function(){
                var hasData = pl[pi] && pl[pi].some(function(row){return row && row.some(function(v){return v && v.trim();});});
                if(!hasData) return;
                if(window.confirm("Clear all data from Plate "+(pi+1)+"? This only affects the well values — your experiment setup, sample names, and dilution factors stay the same.")){
                  setPl(function(p){var n=p.slice();n[pi]=EP();return n;});
                  setDet(function(p){var n=p.slice();n[pi]=null;return n;});
                }
              }} style={{background:"#fff",border:"1px solid #d8dfeb",color:"#6e6e73",padding:"4px 10px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5}} title={"Clear data from Plate "+(pi+1)+" (keeps your setup)"}>
                <span style={{fontSize:13,lineHeight:1}}>×</span>
                Clear plate
              </button>
            </div>
            <div style={{overflowX:"auto",borderRadius:12,border:"1px solid #bbb",background:"#fff"}}>
              <table style={{borderCollapse:"collapse",fontSize:11,fontFamily:"monospace",tableLayout:"fixed",minWidth:Math.max(totalGridWidth+(isTransposed?180:0),300),width:"100%"}}>
                <colgroup>
                  <col style={{width:isTransposed?32:30}} />
                  {isTransposed && <col style={{width:50}} />}
                  {Array.from({length:totalCols},function(_,ci){return <col key={ci} style={{width:70}} />;})}
                  {isTransposed && <col style={{width:50}} />}
                  {isTransposed && <col style={{width:32}} />}
                </colgroup>
                <thead>
                  {isTransposed && <tr>
                    <th style={{border:"none",background:"#fff",padding:0}}></th>
                    <th style={{border:"none",background:"#fff",padding:0}}></th>
                    <th colSpan={5} style={{border:"none",background:"#fff",padding:0}}></th>
                    <th colSpan={2} style={{border:"none",padding:"3px 0 4px",fontSize:10,fontWeight:700,color:NAVY,textAlign:"center",letterSpacing:0.4,background:"#fff",lineHeight:1.2}}>
                      <div style={{fontSize:9,letterSpacing:0.5,textTransform:"uppercase",marginBottom:1}}>Plate splits here</div>
                      <div style={{fontSize:14,lineHeight:1}}>↓</div>
                    </th>
                    <th colSpan={5} style={{border:"none",background:"#fff",padding:0}}></th>
                    <th style={{border:"none",background:"#fff",padding:0}}></th>
                    <th style={{border:"none",background:"#fff",padding:0}}></th>
                  </tr>}
                  {!isTransposed && <tr>
                    <th rowSpan={2} style={{border:"1px solid #bbb",background:"#f4f4f6",padding:"8px 4px",fontSize:10,color:"#6e6e73",fontWeight:700}}></th>
                    {classicalColHdr1}
                  </tr>}
                  {isTransposed && <tr>
                    <th rowSpan={2} style={{border:"1px solid #bbb",background:"#f4f4f6",padding:"8px 4px",fontSize:10,color:"#6e6e73",fontWeight:700,verticalAlign:"middle"}}></th>
                    <th rowSpan={2} style={{border:"1px solid #bbb",background:"#f4f4f6",padding:"8px 4px",fontSize:9,color:"#6e6e73",fontWeight:700}}></th>
                    {Array.from({length:totalCols},function(_,c){
                      var halfDividerStyle = c===6 ? {borderLeft:"3px solid "+NAVY} : {};
                      return <th key={c} style={Object.assign({},{border:"1px solid #bbb",background:"#f4f4f6",padding:"8px 4px",fontSize:11,color:"#30437a",fontWeight:700,textAlign:"center"},halfDividerStyle)}>{c+1}</th>;
                    })}
                    <th rowSpan={2} style={{border:"1px solid #bbb",background:"#f4f4f6",padding:"8px 4px",fontSize:9,color:"#6e6e73",fontWeight:700}}></th>
                    <th rowSpan={2} style={{border:"1px solid #bbb",background:"#f4f4f6",padding:"8px 4px",fontSize:10,color:"#6e6e73",fontWeight:700,verticalAlign:"middle"}}></th>
                  </tr>}
                  {!isTransposed && <tr>
                    {classicalColHdr2}
                  </tr>}
                  {isTransposed && <tr>
                    {Array.from({length:totalCols},function(_,c){
                      var halfWidth = layout.halfWidth || 6;
                      var dilsPerRep = layout.dilsPerRep || 5;
                      var inFirstHalf = c < halfWidth;
                      var idxInHalf = inFirstHalf ? c : c - halfWidth;
                      var isBlankCol = idxInHalf === dilsPerRep;
                      var label = isBlankCol ? "Blank" : "Dil "+(idxInHalf+1);
                      var bg = isBlankCol ? "#e8e8eb" : "#eef3f8";
                      var color = isBlankCol ? "#6e6e73" : "#5a6984";
                      var halfDividerStyle = c===6 ? {borderLeft:"3px solid "+NAVY} : {};
                      return <th key={c} style={Object.assign({},{border:"1px solid #d1d1d6",padding:"4px 4px",fontSize:9,fontWeight:600,background:bg,color:color,textAlign:"center"},halfDividerStyle)}>{label}</th>;
                    })}
                  </tr>}
                </thead>
                <tbody>
                  {(function(){
                    var halfWidth = layout.halfWidth || 6;
                    var findGroupForSlot = function(r, halfIdx){
                      for(var gi=0;gi<layout.groups.length;gi++){
                        var g=layout.groups[gi];
                        if(!g.slots) continue;
                        for(var si=0;si<g.slots.length;si++){
                          if(g.slots[si].row===r && g.slots[si].halfIdx===halfIdx) return {group:g, groupIdx:gi};
                        }
                      }
                      return null;
                    };
                    // For each (row, halfIdx), figure out: is this the first row of a contiguous run of the same group?
                    // run length, and rep number within run.
                    var runMap = {};
                    if(isTransposed){
                      for(var hh=0; hh<2; hh++){
                        var r = 0;
                        while(r < totalRows2){
                          var info = findGroupForSlot(r, hh);
                          if(!info){ r++; continue; }
                          var runLen = 1;
                          while(r+runLen < totalRows2){
                            var nextInfo = findGroupForSlot(r+runLen, hh);
                            if(nextInfo && nextInfo.groupIdx === info.groupIdx) runLen++;
                            else break;
                          }
                          for(var k=0; k<runLen; k++){
                            runMap[hh+"-"+(r+k)] = {firstRow:r, runLen:runLen, repNum:k+1, groupIdx:info.groupIdx, info:info};
                          }
                          r += runLen;
                        }
                      }
                    }
                    var nameOf = function(grpInfo){
                      if(!grpInfo) return null;
                      var g = grpInfo.group;
                      if(g.type==="std") return cfg.sn+" std";
                      var sidx = layout.groups.slice(0, grpInfo.groupIdx).filter(function(gg){return gg.type==="smp";}).length;
                      return sampleNameFor(pi, sidx, g.name);
                    };
                    var colorFor = function(grpInfo){
                      if(!grpInfo) return null;
                      if(grpInfo.group.type==="std") return GC[0];
                      var sidx = layout.groups.slice(0, grpInfo.groupIdx).filter(function(gg){return gg.type==="smp";}).length;
                      return GC[(sidx+1)%GC.length];
                    };

                    return Array.from({length:totalRows2},function(_,r){
                      var leftLabelCell = null, rightLabelCell = null;
                      var leftRepCell = null, rightRepCell = null;

                      if(isTransposed){
                        var labelStyle = {fontSize:10,fontWeight:700,padding:"5px 8px",borderRadius:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",lineHeight:1.3,maxWidth:"100%",boxSizing:"border-box"};
                        var emptyStyle = {color:"#aeaeb2",fontSize:9,fontStyle:"italic"};

                        // Render the sample-name cell — only on the first row of a run; uses rowSpan
                        var renderNameCell = function(halfIdx, side){
                          var run = runMap[halfIdx+"-"+r];
                          if(!run){
                            return <td key={"lbl-"+side} style={{border:"1px solid #d1d1d6",padding:0,textAlign:"center",fontSize:11,fontWeight:700,background:"#f4f4f6",color:"#30437a",verticalAlign:"middle"}}>
                              <span style={emptyStyle}>—</span>
                            </td>;
                          }
                          if(run.firstRow !== r) return null;
                          var name = nameOf(run.info);
                          var col = colorFor(run.info);
                          // For multi-rep groups: vertical rotated label (uses available vertical space).
                          // For singlicate: horizontal label so the name is actually readable in a single row's height.
                          if(run.runLen >= 2){
                            return <td key={"lbl-"+side} rowSpan={run.runLen} style={{border:"1px solid #d1d1d6",padding:0,textAlign:"center",background:col.hd,verticalAlign:"middle",height:1}}>
                              <div title={name} style={{
                                writingMode:"vertical-rl",
                                transform:"rotate(180deg)",
                                fontSize:10,
                                fontWeight:700,
                                color:col.tx,
                                padding:"6px 4px",
                                whiteSpace:"nowrap",
                                overflow:"hidden",
                                textOverflow:"ellipsis",
                                maxHeight:"100%",
                                margin:"0 auto",
                                letterSpacing:0.3
                              }}>{name}</div>
                            </td>;
                          }
                          // Singlicate: horizontal label. Tooltip on hover shows the full name.
                          // Use a small font, padded to fit ~5-6 chars before truncation.
                          return <td key={"lbl-"+side} style={{border:"1px solid #d1d1d6",padding:0,textAlign:"center",background:col.hd,verticalAlign:"middle"}}>
                            <div title={name} style={{
                              fontSize:9,
                              fontWeight:700,
                              color:col.tx,
                              padding:"4px 3px",
                              whiteSpace:"nowrap",
                              overflow:"hidden",
                              textOverflow:"ellipsis",
                              letterSpacing:0.2
                            }}>{name}</div>
                          </td>;
                        };
                        // Render the Rep N cell — every row, color-tinted to its group
                        var renderRepCell = function(halfIdx, side){
                          var run = runMap[halfIdx+"-"+r];
                          if(!run){
                            return <td key={"rep-"+side} style={{border:"1px solid #d1d1d6",padding:"4px 3px",textAlign:"center",fontSize:9,fontWeight:600,background:"#f8f9fb",color:"#aeaeb2"}}>—</td>;
                          }
                          var col = colorFor(run.info);
                          return <td key={"rep-"+side} style={{border:"1px solid #d1d1d6",padding:"4px 3px",textAlign:"center",fontSize:9,fontWeight:700,background:col.bg,color:col.tx}}>Rep {run.repNum}</td>;
                        };

                        leftLabelCell = renderNameCell(0, "L");
                        rightLabelCell = renderNameCell(1, "R");
                        leftRepCell = renderRepCell(0, "L");
                        rightRepCell = renderRepCell(1, "R");
                      }

                      return (<tr key={r}>
                        {isTransposed
                          ? leftLabelCell
                          : <td style={{border:"1px solid #d1d1d6",padding:3,textAlign:"center",fontSize:11,fontWeight:700,background:"#f4f4f6",color:"#30437a",verticalAlign:"middle"}}>{LE[r]}</td>}
                        {isTransposed && leftRepCell}
                        {Array.from({length:totalCols},function(_,c){
                          var halfDividerStyle = isTransposed && c===6 ? {borderLeft:"3px solid "+NAVY} : {};
                          // Classical: tint cell by sample color; blank row = muted grey
                          var bgColor = "#fff";
                          if(!isTransposed){
                            var blank = isBlankCell(r,c);
                            if(blank){
                              bgColor = "#f4f4f6";
                            } else {
                              var gc = colorForCell(r,c);
                              bgColor = gc ? gc.cell : "#fff";
                            }
                          }
                          return <td key={c} style={Object.assign({},{border:"1px solid #d1d1d6",padding:0,background:bgColor},halfDividerStyle)}>
                            <input type="text" title={cellTooltip(r,c)} value={pl[pi]&&pl[pi][r]?pl[pi][r][c]||"":""} onChange={function(e){hcc(pi,r,c,e.target.value);}} onPaste={r===0&&c===0?hp(pi):undefined} style={{width:"100%",boxSizing:"border-box",border:"none",padding:"6px 6px",fontSize:11,fontFamily:"monospace",textAlign:"center",background:"transparent",outline:"none",color:"#1d1d1f"}} placeholder={r===0&&c===0?"paste":""} />
                          </td>;
                        })}
                        {isTransposed && rightRepCell}
                        {isTransposed && rightLabelCell}
                      </tr>);
                    });
                  })()}
                </tbody>
              </table>
            </div>
            {det[pi] && <p style={{fontSize:11,color:"#aeaeb2",margin:"6px 0 0"}}>{detNote}</p>}
          </div>);
        })}
        {/* Sample names text input */}
        <details style={{marginBottom:"1rem",background:SURFACE,borderRadius:14,border:"1px solid "+BORDER,padding:"0.85rem 1rem",boxShadow:"0 6px 18px rgba(11,42,111,0.03)"}}>
          <summary style={{fontSize:13,fontWeight:700,cursor:"pointer",color:"#30437a"}}>Optional sample names</summary>
          <p style={{fontSize:12,color:"#6e6e73",margin:"10px 0 8px",lineHeight:1.5}}>
            Paste one sample name per line, in the order they appear on the plate. The app assigns them automatically.
            {layout.axis==="row" && <span style={{display:"block",marginTop:6,padding:"6px 10px",background:"#f7f1ff",borderRadius:6,border:"1px solid #e2d7fb",color:"#5a6984"}}>
              <strong>Transposed order:</strong> down the left half first (top to bottom, skipping the standard's slot{(parseInt(cfg.sr)||2)>1?"s":""}), then down the right half. With your current setup, you can name up to <strong>{smpGroups.length} samples</strong>.
            </span>}
          </p>
          <textarea value={cfg.names} onChange={function(e){u("names",e.target.value);}} rows={4} placeholder={"Sample A\nSample B\nSample C\nSample D"} style={{width:"100%",boxSizing:"border-box",padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,fontFamily:"monospace",outline:"none",resize:"vertical"}} />
        </details>
        <div style={{background:SURFACE,borderRadius:18,border:"1px solid "+BORDER,padding:"1.25rem",marginBottom:"1.25rem",boxShadow:"0 8px 22px rgba(11,42,111,0.04)"}}>
        <div style={{background:"linear-gradient(135deg,"+NAVY+", "+TEAL_DARK+")",color:"#fff",padding:"10px 16px",borderRadius:12,fontSize:14,fontWeight:800,marginBottom:"1rem",boxShadow:"0 10px 22px rgba(11,42,111,0.16)"}}>General information</div>
        {[
          ["Assay type",<select value={assayKind} onChange={function(e){var v=e.target.value;if(v==="total"){u("tp","yes");u("at","direct");}else if(v==="elisa"){u("tp","no");u("at","elisa");}else{u("tp","no");u("at","direct");}}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}><option value="direct">GFP direct fluorescence</option><option value="elisa">ELISA</option><option value="total">Total protein assay</option></select>],
          ["Standard protein",<input value={cfg.sn} onChange={function(e){u("sn",e.target.value);}} style={{width:"100%",boxSizing:"border-box",padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none"}} />],
          ...(cfg.tp==="no"?[["Target protein",<input value={cfg.target} onChange={function(e){u("target",e.target.value);}} placeholder="e.g. IL-6" style={{width:"100%",boxSizing:"border-box",padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none"}} />]]:[]),
          ["Stock concentration",<div style={{display:"flex",alignItems:"center",gap:8}}><input type="number" step="any" value={cfg.sc} onChange={function(e){u("sc",e.target.value);}} style={{width:120,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none"}} /><select value={cfg.unit} onChange={function(e){u("unit",e.target.value);}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}><option value="mg/mL">mg/mL</option><option value="ug/mL">ug/mL</option><option value="ng/mL">ng/mL</option></select></div>],
          ...(function(){
            // Compute preview dilution count based on layout (rows-1 for classical, 5 for transposed)
            var nDils = cfg.layout === "transposed" ? 5 : 7;
            var sdfV = pDil(cfg.sdf), sdsV = pDil(cfg.sds);
            var xdfV = pDil(cfg.xdf), xdsV = pDil(cfg.xds);
            // Series rendered in the user's chosen format (ratio "1:N" or factor "N×").
            // Sci notation kicks in for big numbers so the caption doesn't overflow.
            var stdSeries = buildDilutionPreview(sdfV, sdsV, nDils, dilFormat);
            var smpSeries = buildDilutionPreview(xdfV, xdsV, nDils, dilFormat);
            // Helper renders a series preview beneath the input. labelColor is the highlight color.
            // The first invocation also renders the format toggle pill (subtle, dotted-underline).
            var seriesCaption = function(series, labelColor, showToggle){
              if (!series) return <div style={{fontSize:11,color:"#aeaeb2",fontStyle:"italic",marginTop:4}}>Enter values above to preview your series</div>;
              return <div style={{fontSize:11,color:"#5a6984",marginTop:6,lineHeight:1.5,display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap"}}>
                <span style={{color:"#aeaeb2"}}>{nDils}-row series (as <FormatPill
                  value={dilFormat}
                  onChange={setDilFormat}
                  labelOf={function(f){return f === "ratio" ? "ratio" : "factor";}}
                  toggleOf={function(f){return f === "ratio" ? "factor" : "ratio";}}
                  size={11}
                  color="#aeaeb2"
                  hoverColor="#0b2a6f"
                />):</span>{" "}
                <span style={{color:labelColor,fontFamily:"monospace",fontWeight:700,wordBreak:"break-word"}}>{series.join(", ")}</span>
              </div>;
            };
            // Helper renders a labelled input with a tiny helper-text caption inline
            var dilLabel = function(rowKind, isFirst, color){
              return <div>
                <div style={{fontWeight:700,color:"#1d1d1f"}}>{rowKind} <span style={{color:color}}>{isFirst?"first row":"subsequent rows"}</span></div>
                <div style={{fontSize:11,color:"#8e9bb5",marginTop:2,fontStyle:"italic",lineHeight:1.4}}>
                  {isFirst ? "Dilution applied to the most concentrated (top) row" : "Further dilution between each row and the one above"}
                </div>
              </div>;
            };
            // Helper renders the input + an inline format hint + preview line below
            var dilInputCell = function(stateKey, color){
              // The series preview is only attached to the SECOND row of each pair (sds, xds), since both values are needed.
              var preview = null;
              if (stateKey === "sds") preview = seriesCaption(stdSeries, "#d70015");
              else if (stateKey === "xds") preview = seriesCaption(smpSeries, "#30437a");
              return <div>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <input value={cfg[stateKey]} onChange={function(e){u(stateKey,e.target.value);}} placeholder="1/2" style={{width:100,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none",fontFamily:"monospace"}} />
                  <span style={{fontSize:11,color:"#aeaeb2"}}>e.g. <code style={{background:"#f4f4f6",padding:"1px 5px",borderRadius:3,fontSize:11}}>1/10</code> (10× dilution), <code style={{background:"#f4f4f6",padding:"1px 5px",borderRadius:3,fontSize:11}}>1/2</code> (2× dilution), <code style={{background:"#f4f4f6",padding:"1px 5px",borderRadius:3,fontSize:11}}>1</code> (neat)</span>
                </div>
                {preview}
              </div>;
            };
            return [
              [dilLabel("Standard", true, "#d70015"), dilInputCell("sdf","#d70015")],
              [dilLabel("Standard", false, "#d70015"), dilInputCell("sds","#d70015")],
              [dilLabel("Sample", true, "#30437a"), dilInputCell("xdf","#30437a")],
              [dilLabel("Sample", false, "#30437a"), dilInputCell("xds","#30437a")],
            ];
          })(),
          ["Spike recovery used?",<select value={cfg.spikeUsed} onChange={function(e){u("spikeUsed",e.target.value);}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}><option value="no">No</option><option value="yes">Yes</option></select>],
          [<div><div>Standard curve method</div><div style={{fontSize:11,color:"#aeaeb2",fontStyle:"italic",marginTop:2}}>How to fit the line</div></div>,<select value={cfg.forceOriginInCurve} onChange={function(e){u("forceOriginInCurve",e.target.value);}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}><option value="no">Standards only (ICH M10 — recommended)</option><option value="yes">Standards + blank as (0,0)</option></select>],
        ].map(function(row,i){return <div key={i} style={{display:"flex",gap:16,alignItems:"flex-start",padding:"10px 0",borderBottom:i<8?"1px solid #f0f0f3":"none"}}><div style={{width:240,flexShrink:0,fontSize:13,color:"#6e6e73",lineHeight:1.4}}>{row[0]}</div><div style={{flex:1}}>{row[1]}</div></div>;})}
        </div>
        {cfg.spikeUsed==="yes"&&<div style={{background:SURFACE,borderRadius:18,border:"1px solid "+BORDER,padding:"1.25rem",marginBottom:"1.25rem",boxShadow:"0 8px 22px rgba(11,42,111,0.04)"}}>
          <div style={{background:"linear-gradient(135deg,#8f3fdb,#3478F6)",color:"#fff",padding:"10px 16px",borderRadius:12,fontSize:14,fontWeight:800,marginBottom:"1rem",boxShadow:"0 10px 22px rgba(52,120,246,0.16)"}}>Accuracy / spike recovery</div>
          <div style={{display:"grid",gridTemplateColumns:"1.1fr 1fr",gap:"1rem",marginBottom:"1rem"}}>
            <SpikeGuide instructor={instructor} />
            <div style={{background:"linear-gradient(180deg,#fbfdff,#f6f9ff)",border:"1px solid #dfe7f2",borderRadius:16,padding:"14px 16px"}}>
              <div style={{fontSize:13,fontWeight:800,color:"#30437a",marginBottom:8}}>What the analyst should enter</div>
              <div style={{fontSize:12,color:"#5a6984",lineHeight:1.7}}>
                <div><strong>Unspiked sample:</strong> your original sample before any spike was added.</div>
                <div><strong>Spiked sample:</strong> that same sample after you mixed the spike stock in.</div>
                <div><strong>Spike stock:</strong> the concentrated spike material you pipetted into the sample.</div>
              </div>
            </div>
          </div>
          {spikeSets.map(function(set,idx){return <div key={idx} style={{border:"1px solid #e6ebf4",borderRadius:14,padding:"1rem",marginBottom:"0.9rem",background:"linear-gradient(180deg,#ffffff,#fbfcff)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:700,color:"#30437a"}}>Spike set {idx+1}</div>
              {spikeSets.length>1&&<button onClick={function(){removeSpike(idx);}} style={{background:"transparent",border:"none",color:"#d70015",fontSize:12,fontWeight:700,cursor:"pointer"}}>Remove</button>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem",marginBottom:"1rem"}}>
              <div style={{background:"#fffaf4",border:"1px solid #f3e3c8",borderRadius:14,padding:"12px 14px"}}>
                <div style={{fontSize:12,fontWeight:800,color:"#8a4000",marginBottom:8}}>Sample pair</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:"0.8rem"}}>
                  <div><label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:6,color:"#18233f"}}>Plate</label><select value={set.plate} onChange={function(e){updateSpike(idx,"plate",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}>{Array.from({length:np},function(_,i){return <option key={i} value={String(i+1)}>Plate {i+1}</option>;})}</select></div>
                  <div>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:2,color:"#18233f"}}>Sample name that represents the <em>unspiked</em> version</label>
                    <div style={{fontSize:10,color:"#6b7689",fontStyle:"italic",marginBottom:6}}>the wells where you measured your sample before adding any spike</div>
                    <select value={set.endo} onChange={function(e){updateSpike(idx,"endo",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}>{(populatedSampleIdxs.length>0?populatedSampleIdxs:smpGroups.map(function(_,i){return i;})).map(function(i){return <option key={i} value={String(i)}>{sampleNameFor(Math.max(0,(parseInt(set.plate)||1)-1),i,"Sample "+(i+1))}</option>;})}</select>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:2,color:"#18233f"}}>Sample name that represents the <em>spiked</em> version</label>
                    <div style={{fontSize:10,color:"#6b7689",fontStyle:"italic",marginBottom:6}}>the wells where you measured the same sample after the spike was mixed in</div>
                    <select value={set.spiked} onChange={function(e){updateSpike(idx,"spiked",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}>{(populatedSampleIdxs.length>0?populatedSampleIdxs:smpGroups.map(function(_,i){return i;})).map(function(i){return <option key={i} value={String(i)}>{sampleNameFor(Math.max(0,(parseInt(set.plate)||1)-1),i,"Sample "+(i+1))}</option>;})}</select>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:2,color:"#18233f"}}>Sample volume <em>before</em> spike was added</label>
                    <div style={{fontSize:10,color:"#6b7689",fontStyle:"italic",marginBottom:6}}>how much sample you had before you pipetted the stock in</div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <input value={set.sampleVol} onChange={function(e){updateSpike(idx,"sampleVol",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}} />
                      <select value={set.sampleVolUnit||"uL"} onChange={function(e){updateSpike(idx,"sampleVolUnit",e.target.value);}} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}><option value="uL">uL</option><option value="mL">mL</option></select>
                    </div>
                  </div>
                  {(function(){
                    var _sh=set.showNoEndoPanel;
                    return <div style={{marginTop:4}}>
                      {!_sh && !set.noEndo && <button 
                        onClick={function(){updateSpike(idx,"showNoEndoPanel",true);}}
                        style={{background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:"2px 0",textDecoration:"underline",textDecorationStyle:"dotted",fontStyle:"italic"}}
                      >My sample has no endogenous target protein</button>}
                      {(_sh || set.noEndo) && <div style={{padding:"10px 12px",background:set.noEndo?"#fef3e2":"#f7fbff",border:"1px solid "+(set.noEndo?"#e8c481":"#c6d3e8"),borderRadius:10}}>
                        <div style={{fontSize:11,color:set.noEndo?"#7a4a00":"#30437a",lineHeight:1.6,marginBottom:8}}>
                          <strong>What this means.</strong> Normally the unspiked sample tells us how much of the target protein is already in the sample before we spike it. We subtract that baseline out so the math measures only what we added.
                          <br/><br/>
                          <strong>When to turn this on.</strong> Only if you are certain the sample starts with <em>zero</em> of the target protein — for example, testing a drug in plasma from a person who has never taken that drug, or measuring a protein in a buffer that cannot contain it. In those cases, the unspiked baseline is effectively zero and does not need to be measured.
                          <br/><br/>
                          <strong>If you are unsure, leave this off.</strong> The matched unspiked aliquot is the standard approach and never gives a wrong answer from assuming too much.
                        </div>
                        <label style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:11,color:set.noEndo?"#7a4a00":"#18233f",cursor:"pointer",lineHeight:1.4}}>
                          <input type="checkbox" checked={!!set.noEndo} onChange={function(e){updateSpike(idx,"noEndo",e.target.checked);}} style={{marginTop:2,flexShrink:0}} />
                          <span>Assume endogenous concentration = 0 (override the matched-aliquot baseline)</span>
                        </label>
                        {!set.noEndo && <button onClick={function(){updateSpike(idx,"showNoEndoPanel",false);}} style={{marginTop:8,background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:0,textDecoration:"underline",textDecorationStyle:"dotted"}}>Hide this option</button>}
                      </div>}
                    </div>;
                  })()}
                </div>
              </div>
              <div style={{background:"#f7f1ff",border:"1px solid #e2d7fb",borderRadius:14,padding:"12px 14px"}}>
                <div style={{fontSize:12,fontWeight:800,color:"#6337b9",marginBottom:8}}>Spike stock</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:"0.8rem"}}>
                  <div><label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:6,color:"#18233f"}}>Spike protein used</label><input value={set.spikeProtein} onChange={function(e){updateSpike(idx,"spikeProtein",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}} /></div>
                  <div><label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:6,color:"#18233f"}}>Stock concentration of the spike</label><div style={{display:"flex",gap:8,alignItems:"center"}}><input value={set.stockConc} onChange={function(e){updateSpike(idx,"stockConc",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}} /><select value={set.stockUnit} onChange={function(e){updateSpike(idx,"stockUnit",e.target.value);}} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}><option value="ug/uL">ug/uL</option><option value="mg/mL">mg/mL</option><option value="ug/mL">ug/mL</option><option value="ng/mL">ng/mL</option></select></div></div>
                  <div><label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:6,color:"#18233f"}}>Volume of the stock spike added to the sample</label><div style={{display:"flex",gap:8,alignItems:"center"}}><input value={set.spikeVol} onChange={function(e){updateSpike(idx,"spikeVol",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}} /><select value={set.spikeVolUnit||"uL"} onChange={function(e){updateSpike(idx,"spikeVolUnit",e.target.value);}} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}><option value="uL">uL</option><option value="mL">mL</option></select></div>{(function(){var svUL=volToUL(parseFloat(set.spikeVol),set.spikeVolUnit||"uL")||0;var smUL=volToUL(parseFloat(set.sampleVol),set.sampleVolUnit||"uL")||0;var tv=svUL+smUL;if(tv>0&&svUL/tv>0.10){return <div style={{marginTop:6,fontSize:10,color:"#bf4800",fontWeight:600}}>&#9888; Spike is {((svUL/tv)*100).toFixed(0)}% of final volume (ICH M10 recommends &le;10%)</div>;}return null;})()}</div>
                  {(function(){
                    var svUL=volToUL(parseFloat(set.spikeVol),set.spikeVolUnit||"uL")||0;
                    var smUL=volToUL(parseFloat(set.sampleVol),set.sampleVolUnit||"uL")||0;
                    var tv=svUL+smUL;
                    if(tv<=0)return null;
                    var stockMgMl=concToMgMl(parseFloat(set.stockConc),set.stockUnit);
                    var spikeMassMg=stockMgMl!=null?stockMgMl*(svUL/1000):null;
                    var expectedMgMl=stockMgMl!=null?stockMgMl*(svUL/tv):null;
                    var expectedDisplay=expectedMgMl!=null?mgMlToUnit(expectedMgMl,unit):null;
                    var row=function(label,value,sub){return <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"6px 0",borderBottom:"1px dashed #d8e1f0"}}><span style={{fontSize:11,color:"#30437a",fontWeight:600}}>{label}</span><span style={{fontSize:13,fontWeight:700,color:"#0b2a6f",fontFamily:"monospace"}}>{value}{sub?<span style={{fontWeight:400,color:"#6e6e73",fontSize:10,marginLeft:6}}>{sub}</span>:null}</span></div>;};
                    return <div style={{marginTop:2,padding:"10px 14px",background:"#f2f7ff",borderRadius:10,border:"1px dashed #c6d3e8"}}>
                      <div style={{fontSize:10,color:"#30437a",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>Live preview (computed)</div>
                      {row("Final sample volume",tv.toFixed(1)+" µL","("+(tv/1000).toFixed(3)+" mL)")}
                      {spikeMassMg!=null?row("Mass of spike added",sig3(spikeMassMg)+" mg","("+sig3(spikeMassMg*1000)+" µg)"):null}
                      {expectedDisplay!=null?row("Expected spike concentration",sig3(expectedDisplay)+" "+unit):null}
                      <div style={{fontSize:10,color:"#6e6e73",fontStyle:"italic",marginTop:6,lineHeight:1.4}}>The spike is diluted as it mixes into the sample. This is the concentration of spike alone in the final mixture, before the assay reads out.</div>
                    </div>;
                  })()}
                </div>
              </div>
            </div>
          </div>;})}
          <button onClick={addSpike} style={{background:"transparent",border:"1px solid #d8dfeb",padding:"10px 14px",borderRadius:10,fontSize:12,color:"#30437a",cursor:"pointer",fontWeight:700}}>Add spike set</button>
        </div>}
        <div style={{display:"flex",gap:12}}><button onClick={confirmAnalyze} disabled={!dv} style={{background:"linear-gradient(135deg,#1b7f6a,#3478F6)",color:"#fff",border:"none",padding:"11px 24px",borderRadius:12,fontWeight:700,fontSize:13,cursor:dv?"pointer":"not-allowed",opacity:dv?1:.5,boxShadow:"0 10px 20px rgba(11,42,111,0.10)"}}>Analyze</button><button onClick={demo} style={{background:"transparent",border:"1px solid #e5e5ea",padding:"11px 20px",borderRadius:12,fontSize:12,color:"#6e6e73",cursor:"pointer",fontWeight:600}}>Load demo</button></div>
      </div>)}

      {/* ANALYSIS */}
      {tab===1&&res&&(function(){var p=res[vp];if(!p)return null;return (<div>
        <div style={{position:"relative",display:"flex",justifyContent:"center",marginBottom:"1.5rem",background:"linear-gradient(180deg,#ffffff,#f5f9fe)",borderRadius:18,padding:"1.25rem",border:"1px solid #dfe7f2",boxShadow:"0 16px 34px rgba(11,42,111,0.08), inset 0 1px 0 rgba(255,255,255,0.85)"}}>
          <StdChart pts={p.sc.pts} fn={p.fFn} sn={cfg.sn} fl={p.fL} r2={p.sc.r2} unit={unit} displayUnit={displayUnitChart} onDisplayUnitChange={setDisplayUnitChart} slope={p.sc.slope} intercept={p.sc.intercept} instructor={instructor} />
        </div>
        <details style={{marginBottom:"1rem"}}><summary style={{fontSize:13,fontWeight:700,cursor:"pointer"}}>Standard curve data</summary><table style={{borderCollapse:"collapse",width:"100%",marginTop:8}}><thead><tr><th style={{...thS,textAlign:"left"}}>[{cfg.sn}] (<UnitPill unit={displayUnitChart} onChange={setDisplayUnitChart} size={11} color="#6e6e73" hoverColor="#0b2a6f" weight={700} />)</th><th style={{...thS,textAlign:"right"}}>Avg optical response</th><th style={{...thS,textAlign:"right"}}>SD</th><th style={{...thS,textAlign:"right"}}>CV (%)</th></tr></thead><tbody>{p.sc.pts.map(function(pt,i){var concDisp = convertConc(pt.conc, unit, displayUnitChart); return <tr key={i}><td style={tdS}>{sig3(concDisp)}</td><td style={{...tdS,textAlign:"right"}}>{fm4(pt.avg)}</td><td style={{...tdS,textAlign:"right"}}>{fm4(pt.sd)}</td><td style={{...tdS,textAlign:"right"}}><CVB val={pt.cv} /></td></tr>;})}</tbody></table></details>
        {/* Expand/collapse all */}
        <div style={{display:"flex",gap:12,marginBottom:12}}><button onClick={function(){toggleAll(true);}} style={{fontSize:12,color:"#3478F6",background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>Expand all samples</button><button onClick={function(){toggleAll(false);}} style={{fontSize:12,color:"#6e6e73",background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>Collapse all</button></div>
        {p.samps.map(function(s,si){var sel=gsc(vp,si);var gc=GC[(si+1)%GC.length];var ek=vp+"-"+si;var isOpen=expanded[ek];return (
          <div key={si} style={{marginBottom:8,background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",overflow:"hidden",boxShadow:"0 10px 22px rgba(11,42,111,0.05)"}}>
            <div onClick={function(){var n={};for(var k in expanded)n[k]=expanded[k];n[ek]=!isOpen;setExpanded(n);}} style={{background:"linear-gradient(180deg,"+gc.hd+", "+gc.bg+")",padding:"11px 16px",display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none",borderBottom:"1px solid rgba(255,255,255,0.35)",boxShadow:glow(gc)}}>
              <span style={{fontSize:14,fontWeight:700,color:gc.tx,transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"rotate(0deg)"}}>&#9654;</span>
              <span style={{fontSize:11,fontWeight:700,color:gc.tx,textTransform:"uppercase",letterSpacing:1}}>Sample</span>
              <span style={{fontSize:15,fontWeight:800,color:gc.tx}}>{s.name}</span>
              <span style={{marginLeft:"auto",fontSize:12,color:gc.tx,fontWeight:700,opacity:0.95}}>{sel&&sel.conc!=null?"Selected by "+SM.find(function(m){return m.id===sm;}).short+": "+sig3(sel.conc)+" "+unit:"No qualified concentration selected"}</span>
            </div>
            {isOpen&&(<div style={{padding:"1rem 1.25rem",overflowX:"auto"}}>
              {instructor&&<div style={{fontSize:11,color:"#3478F6",marginBottom:8,fontWeight:600}}>Click any row for step-by-step math</div>}
              <table style={{borderCollapse:"collapse",width:"100%"}}><thead><tr>
                <th style={{...thS,textAlign:"left"}}>Dilution</th>
                <th style={{...thS,textAlign:"right"}}>Average corrected response</th>
                <th style={{...thS,textAlign:"right"}}>CV (%)</th>
                <th style={{...thS,textAlign:"right"}}>[{cfg.sn}] in well (<UnitPill unit={displayUnitChart} onChange={setDisplayUnitChart} size={11} color="#6e6e73" hoverColor="#0b2a6f" weight={700} />)</th>
                <th style={{...thS,textAlign:"right"}}>[{targetP}] in sample (<UnitPill unit={displayUnitChart} onChange={setDisplayUnitChart} size={11} color="#6e6e73" hoverColor="#0b2a6f" weight={700} />)</th>
                <th style={{...thS,textAlign:"center"}}>In range?</th>
              </tr></thead><tbody>{s.dils.map(function(d,di){
                var isRec=sel&&sel.dil===d.di&&!picks[ek];
                var isPk=picks[ek]===d.di;
                var bg=isPk?"#e3f0fc":isRec?"#e6f5f0":"transparent";
                var isMO=instructor&&mathRow&&mathRow.pi===vp&&mathRow.si===si&&mathRow.di===d.di;
                var dbD2=s.dbD?s.dbD.find(function(dd){return dd.di===d.di;}):null;
                return [
                  <tr key={di} style={{background:bg,cursor:instructor?"pointer":"default"}} onClick={function(){if(!instructor)return;if(isMO)setMathRow(null);else setMathRow({pi:vp,si:si,di:d.di});}} title={!d.ir&&instructor?"OOR — back-calculated value shown for teaching only. Do not report (extrapolated outside the standard curve range).":""}>
                    <td style={{...tdS,fontWeight:isRec||isPk?700:400}}>{d.di}{isRec?" *":""}</td>
                    <td style={{...tdS,textAlign:"right"}}>{fm4(d.avgA)}</td>
                    <td style={{...tdS,textAlign:"right"}}><CVB val={d.cv} /></td>
                    <td style={{...tdS,textAlign:"right",color:!d.ir&&instructor?"#a05a00":"inherit",fontStyle:!d.ir&&instructor?"italic":"normal"}}>{d.cW!=null?(d.ir?sig3(convertConc(d.cW, unit, displayUnitChart)):(instructor?sig3(convertConc(d.cW, unit, displayUnitChart)):"---")):"---"}</td>
                    <td style={{...tdS,textAlign:"right",fontWeight:isRec||isPk?700:400,color:!d.ir&&instructor?"#a05a00":"inherit",fontStyle:!d.ir&&instructor?"italic":"normal"}}>{d.cS!=null?(d.ir?sig3(convertConc(d.cS, unit, displayUnitChart)):(instructor?sig3(convertConc(d.cS, unit, displayUnitChart)):"---")):"---"}</td>
                    <td style={{...tdS,textAlign:"center"}}>{d.ir?<span style={{color:"#1b7f6a",fontWeight:700}}>IR</span>:<span style={{color:"#d70015"}}>OOR</span>}</td>
                  </tr>,
                  isMO&&dbD2?<tr key={di+"m"}><td colSpan={6} style={{padding:0,border:"none"}}><MathWalk d={dbD2} slope={p.sc.slope} intercept={p.sc.intercept} sn={cfg.sn} target={targetP} unit={unit} displayUnit={displayUnitChart} instructor={instructor} /></td></tr>:null
                ];})}</tbody></table>
            </div>)}
          </div>
        );})}
      </div>);})()}
      {tab===1&&!res&&<div style={{padding:"3rem",textAlign:"center",color:"#aeaeb2"}}>Paste data and click Analyze.</div>}

      {/* RESULTS */}
      {tab===2&&res&&(function(){
        var qc=runQC();
        return (<div>
        {/* Run-level QC banner (if spike recovery was performed) */}
        {qc && <div style={{marginBottom:"1.25rem",padding:"16px 18px",borderRadius:14,background:qc.status==="pass"?"linear-gradient(180deg,#e8f5ea,#d6eedf)":qc.status==="fail"?"linear-gradient(180deg,#ffeaed,#fcdce0)":"linear-gradient(180deg,#fff6e8,#fbe9cd)",border:"1px solid "+(qc.status==="pass"?"#8fc4a1":qc.status==="fail"?"#d98a8f":"#d4a76a")}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <span style={{fontSize:22,fontWeight:800,color:qc.status==="pass"?"#1b7f6a":qc.status==="fail"?"#b4332e":"#9a6a00"}}>{qc.status==="pass"?"✓":qc.status==="fail"?"✗":"⚠"}</span>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:qc.status==="pass"?"#1b5a4d":qc.status==="fail"?"#7a2620":"#5a3e00"}}>Run-level spike recovery QC: {qc.status==="pass"?"PASS":qc.status==="fail"?"FAIL":"MIXED"}</div>
              {qc.nWithRec>0 && <div style={{fontSize:12,color:"#5a6984"}}>{qc.nWithRec} of {qc.nSets} spike set{qc.nSets===1?"":"s"} had recovery computed. Range: {qc.minR.toFixed(1)}–{qc.maxR.toFixed(1)}% (mean {qc.meanR.toFixed(1)}%). ICH M10 pass window: 80–120%.</div>}
              {qc.nWithRec===0 && <div style={{fontSize:12,color:"#5a6984"}}>Spike sets are configured but recovery could not be computed (may be missing measured concentrations).</div>}
            </div>
          </div>
          <div style={{fontSize:11,color:"#5a6984",lineHeight:1.6,paddingLeft:32}}>
            {qc.status==="pass" && <span><strong>Interpretation:</strong> the assay is measuring accurately for the spiked sample(s). Report concentrations as-measured.</span>}
            {qc.status==="fail" && <span><strong>Interpretation:</strong> all spike recoveries are outside the 80–120% window. The run fails QC by ICH M10. Investigate matrix effects, stock accuracy, or assay drift before reporting. Do <em>not</em> apply recovery as a per-sample correction factor.</span>}
            {qc.status==="mixed" && <span><strong>Interpretation:</strong> recoveries vary across spike sets — some pass, some fail. The assay may be sensitive to matrix differences between samples. Review each spike set individually before deciding what to report.</span>}
            {qc.anyOverride && <span><br/><span style={{color:"#7a4a00"}}><strong>Note:</strong> {qc.nOverride} spike set{qc.nOverride===1?"":"s"} used the endogenous=0 override. Recovery on those sets is only valid if the matrix is truly analyte-free.</span></span>}
          </div>
        </div>}

        {/* Strategy selector (simple, at top) */}
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1rem 1.25rem",marginBottom:"1rem"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <label style={{fontSize:13,fontWeight:700}}>Dilution selection strategy</label>
            <select value={sm} onChange={function(e){setSm(e.target.value);}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,fontWeight:600}}>{SM.map(function(m){return <option key={m.id} value={m.id}>{m.name}</option>;})}</select>
            <span style={{fontSize:11,color:"#6e6e73",fontStyle:"italic"}}>{SM.find(function(m){return m.id===sm;}).desc}</span>
          </div>
          <div style={{fontSize:11,color:"#8e9bb5",marginTop:8,fontStyle:"italic"}}>Want to see how strategies compare? Open the <strong>Recommendations</strong> tab.</div>
        </div>

        {/* Per-sample cards */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
          <h3 style={{fontSize:14,fontWeight:700,margin:0}}>Per-sample results</h3>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#aeaeb2"}}>
              <span style={{opacity:0.7}}>units:</span>
              <UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={11} color="#aeaeb2" hoverColor="#0b2a6f" />
            </div>
            <button onClick={function(){toggleResultsAll(true);}} style={{fontSize:12,color:"#3478F6",background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>Expand all</button>
            <button onClick={function(){toggleResultsAll(false);}} style={{fontSize:12,color:"#6e6e73",background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>Collapse all</button>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:12,color:"#6e6e73"}}>
          <span style={{color:"#1b7f6a",fontWeight:800,fontSize:14}}>★</span>
          <span>Recommended by the current strategy ({SM.find(function(m){return m.id===sm;}).short})</span>
        </div>
        {res.flatMap(function(pp,pi){return pp.samps.map(function(s,si){
          var algoSel=s.aS[sm];var apk=pi+"-"+si;var gc=GC[(si+1)%GC.length];var rk=pi+"-"+si;var open=resultsExpanded[rk];
          var mySpikeRows=spikeRowsForSample(pi,si);
          return (<div key={pi+"-"+si} style={{marginBottom:"1rem",background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",overflow:"hidden",boxShadow:"0 10px 22px rgba(11,42,111,0.05)"}}>
            <div onClick={function(){var n={};for(var k in resultsExpanded)n[k]=resultsExpanded[k];n[rk]=!open;setResultsExpanded(n);}} style={{background:"linear-gradient(180deg,"+gc.hd+", "+gc.bg+")",padding:"11px 16px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",borderBottom:open?"1px solid rgba(255,255,255,0.35)":"none",boxShadow:glow(gc)}}>
              <span style={{fontSize:14,fontWeight:700,color:gc.tx,transition:"transform 0.2s",transform:open?"rotate(90deg)":"rotate(0deg)"}}>&#9654;</span>
              <span style={{fontSize:11,fontWeight:700,color:gc.tx,textTransform:"uppercase",letterSpacing:1}}>Plate {pi+1}</span>
              <span style={{fontSize:14,fontWeight:800,color:gc.tx}}>{s.name}</span>
              {mySpikeRows.length>0 && mySpikeRows[0].recovery!=null && <span style={{marginLeft:"auto",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:mySpikeRows[0].recovery>=80&&mySpikeRows[0].recovery<=120?"#e8f5ea":"#ffeaed",color:mySpikeRows[0].recovery>=80&&mySpikeRows[0].recovery<=120?"#1b7f6a":"#b4332e"}}>Recovery {mySpikeRows[0].recovery.toFixed(0)}%</span>}
            </div>
            {open&&<div style={{padding:"0.75rem 1rem"}}>
              <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",width:"100%"}}><thead><tr>
                <th style={{...thS,textAlign:"left"}}>Dilution</th><th style={{...thS,textAlign:"right"}}>CV (%)</th><th style={{...thS,textAlign:"right"}}>[{targetP}] in sample (<UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={11} color="#6e6e73" hoverColor="#0b2a6f" weight={700} />)</th>
                {mySpikeRows.length>0 && <th style={{...thS,textAlign:"right",background:"#faf5ff",color:"#6337b9"}} title="Recovery if you reported this dilution, paired against your current unspiked concentration pick. Updates when you change the unspiked sample's pick.">Recovery<span style={{fontSize:8,fontWeight:400,display:"block",marginTop:2,opacity:0.75}}>(vs current unspiked pick)</span></th>}
                <th style={{...thS,textAlign:"center"}}>Pick</th>
              </tr></thead><tbody>{s.dils.map(function(d){
                var canPick=d.ir&&d.cS!=null&&d.cv<=.20;
                var isAlgo=algoSel&&algoSel.dil===d.di;
                var isPk=picks[apk]===d.di;
                var isDef=picks[apk]==null&&isAlgo&&canPick;
                var muted=!canPick;
                // Recovery at this dilution: pair THIS spiked dilution with the analyst's/strategy's CHOSEN unspiked concentration.
                // This means every row in the recovery column reflects "if I reported this dilution for spiked, paired with my current unspiked pick, recovery is X".
                // When the user picks a different unspiked dilution on the unspiked sample's card, the whole column updates.
                var dilRec = null;
                if(mySpikeRows.length>0){
                  var _sr = mySpikeRows[0];
                  // Current (reactive) chosen unspiked concentration:
                  var _curUnspiked = _sr.noEndo ? 0 : (function(){var g=gsc(pi,_sr.endoIdx);return g?g.conc:null;})();
                  // This spiked dilution's concentration
                  var _thisSp = (d.ir && d.cS!=null && d.cv<=0.20) ? d.cS : null;
                  var _exp = _sr.expectedSpike;
                  if(_curUnspiked!=null && _thisSp!=null && _exp!=null && _exp!==0){
                    dilRec = ((_thisSp - _curUnspiked) / _exp) * 100;
                  }
                }
                var dilRecPass = dilRec!=null ? (dilRec>=80 && dilRec<=120) : null;
                return (<tr key={d.di} style={{background:isPk||isDef?"#e6f5f0":muted?"#fafafa":"transparent",color:muted?"#9ca0a8":"inherit"}} title={!d.ir&&instructor?"OOR — back-calculated value shown for teaching only. Do not report (extrapolated outside the standard curve range).":""}>
                  <td style={{...tdS,fontWeight:isAlgo?700:400}}>{d.di}{isAlgo?<span style={{color:"#1b7f6a",fontWeight:800}}> ★</span>:null}</td>
                  <td style={{...tdS,textAlign:"right"}}><CVB val={d.cv} /></td>
                  <td style={{...tdS,textAlign:"right",fontWeight:700,color:!d.ir&&instructor?"#a05a00":"inherit",fontStyle:!d.ir&&instructor?"italic":"normal"}}>{canPick?sig3(convertConc(d.cS, unit, displayUnitResults)):(instructor&&d.cS!=null?sig3(convertConc(d.cS, unit, displayUnitResults)):"")}</td>
                  {mySpikeRows.length>0 && <td style={{...tdS,textAlign:"right",fontFamily:"monospace",fontWeight:isAlgo?800:600,color:dilRec==null?"#aeaeb2":(dilRecPass?"#1b7f6a":"#b4332e")}}>{dilRec!=null?dilRec.toFixed(0)+"%":"—"}</td>}
                  <td style={{...tdS,textAlign:"center"}}><input type="radio" name={"pk-"+pi+"-"+si} checked={isPk||isDef} disabled={!canPick} onChange={function(){var n={};for(var k in picks)n[k]=picks[k];n[apk]=d.di;setPicks(n);}} /></td>
                </tr>);
              })}</tbody></table></div>
              {picks[apk]!=null&&algoSel&&algoSel.dil!==picks[apk]&&(<div style={{marginTop:8,padding:"8px 12px",background:"#fef3e2",borderRadius:8,fontSize:12,color:"#a05a00",borderLeft:"3px solid #a05a00"}}>Your pick differs from the {SM.find(function(m){return m.id===sm;}).short} recommendation. Document your rationale.</div>)}

              {/* Spike recovery row — if this sample was the spiked side of any spike set */}
              {mySpikeRows.map(function(sr){var pass=sr.recovery!=null?(sr.recovery>=80&&sr.recovery<=120):null;return (<div key={"sr-"+sr.key} style={{marginTop:12,padding:"14px 16px",background:"#fafcff",borderRadius:10,border:"1px solid #dfe7f2"}}>
                <div style={{fontSize:11,color:"#6337b9",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:12}}>Spike recovery (accuracy check)</div>
                {/* Four-tile hierarchy: Unspiked | Spiked | Expected | Recovery */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginBottom:10}}>
                  {/* Unspiked — slate card */}
                  <div style={{padding:"10px 12px",background:"#fff",borderRadius:8,border:"1px solid #d8e1f0"}}>
                    <div style={{fontSize:9,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Unspiked</div>
                    <div style={{fontSize:11,color:"#30437a",fontWeight:600,marginBottom:4}}>{sr.endogenousName}</div>
                    <div style={{fontFamily:"monospace",fontSize:17,fontWeight:800,color:"#0b2a6f",lineHeight:1.1}}>{sr.endogenousConc!=null?sig3(convertConc(sr.endogenousConc, unit, displayUnitResults)):"\u2014"}<span style={{fontSize:10,fontWeight:400,color:"#6e6e73",marginLeft:4}}>{displayUnitResults}</span></div>
                    <div style={{fontSize:9,color:"#8e9bb5",marginTop:3}}>{sr.chosenDilEndo!=null?"dilution #"+sr.chosenDilEndo:(sr.noEndo?"override = 0":"combined")}</div>
                  </div>
                  {/* Spiked — purple-accent card */}
                  <div style={{padding:"10px 12px",background:"#fff",borderRadius:8,border:"1px solid #e2d7fb",borderTop:"3px solid #6337b9"}}>
                    <div style={{fontSize:9,color:"#6337b9",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Spiked</div>
                    <div style={{fontSize:11,color:"#30437a",fontWeight:600,marginBottom:4}}>{s.name}</div>
                    <div style={{fontFamily:"monospace",fontSize:17,fontWeight:800,color:"#0b2a6f",lineHeight:1.1}}>{sr.spikedConc!=null?sig3(convertConc(sr.spikedConc, unit, displayUnitResults)):"\u2014"}<span style={{fontSize:10,fontWeight:400,color:"#6e6e73",marginLeft:4}}>{displayUnitResults}</span></div>
                    <div style={{fontSize:9,color:"#8e9bb5",marginTop:3}}>{sr.chosenDilSpiked!=null?"dilution #"+sr.chosenDilSpiked:"combined"}</div>
                  </div>
                  {/* Expected spike — purple-accent card */}
                  <div style={{padding:"10px 12px",background:"#f7f1ff",borderRadius:8,border:"1px solid #e2d7fb"}}>
                    <div style={{fontSize:9,color:"#6337b9",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>Expected spike</div>
                    <div style={{fontSize:11,color:"#6337b9",fontWeight:600,marginBottom:4,fontStyle:"italic",opacity:0.8}}>from stock + volumes</div>
                    <div style={{fontFamily:"monospace",fontSize:17,fontWeight:800,color:"#6337b9",lineHeight:1.1}}>{sr.expectedSpike!=null?sig3(convertConc(sr.expectedSpike, unit, displayUnitResults)):"\u2014"}<span style={{fontSize:10,fontWeight:400,marginLeft:4,opacity:0.8}}>{displayUnitResults}</span></div>
                  </div>
                  {/* Reported % Recovery — outcome, color-coded */}
                  <div style={{padding:"10px 12px",background:pass==null?"#f4f4f6":(pass?"#e8f5ea":"#ffeaed"),borderRadius:8,border:"1px solid "+(pass==null?"#d8dfeb":(pass?"#8fc4a1":"#d98a8f"))}}>
                    <div style={{fontSize:9,color:pass==null?"#6e6e73":(pass?"#1b5a4d":"#7a2620"),fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4}}>% Recovery</div>
                    <div style={{fontSize:11,color:pass==null?"#6e6e73":(pass?"#1b5a4d":"#7a2620"),fontWeight:600,marginBottom:4,fontStyle:"italic",opacity:0.8}}>(spiked &minus; unspiked) / expected</div>
                    <div style={{fontFamily:"monospace",fontSize:22,fontWeight:800,color:pass==null?"#6e6e73":(pass?"#1b7f6a":"#b4332e"),lineHeight:1}}>{sr.recovery!=null?sr.recovery.toFixed(1)+"%":"\u2014"}</div>
                  </div>
                </div>
                {sr.noEndo && <div style={{marginTop:8,padding:"6px 10px",background:"#fef3e2",borderRadius:6,borderLeft:"3px solid #bf4800",fontSize:10,color:"#7a4a00"}}>⚠ Endogenous = 0 override in effect. Matrix must be independently verified as analyte-free.</div>}
                {!pass && sr.recovery!=null && <div style={{marginTop:8,padding:"6px 10px",background:"#ffeaed",borderRadius:6,borderLeft:"3px solid #d70015",fontSize:11,color:"#7a2620"}}>Recovery outside 80–120% window. See run-level QC banner above for interpretation.</div>}
                {instructor && <details style={{marginTop:10}}>
                  <summary style={{fontSize:11,color:"#6337b9",fontWeight:700,cursor:"pointer"}}>Show math walkthrough</summary>
                  <div style={{marginTop:10,padding:"12px 14px",borderRadius:10,background:"#fff",border:"1px solid #e5ecf5"}}>
                    <div style={{fontSize:10,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Step 1 — Expected spike concentration</div>
                    <div style={{fontSize:11,color:"#5a6984",marginBottom:8,fontStyle:"italic"}}>The spike is diluted by the sample it is added to. Expected spike = mass added / total volume.</div>
                    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:13,color:"#30437a",marginBottom:12}}>
                      <span>Expected</span><span>=</span>
                      <Fraction top={<span>({sr.stockConc} {sr.stockUnit}) × ({sr.spikeVolRaw} {sr.spikeVolUnit})</span>} bottom={<span>({sr.sampleVolRaw} {sr.sampleVolUnit}) + ({sr.spikeVolRaw} {sr.spikeVolUnit})</span>} w={300} />
                      <span>=</span>
                      <strong style={{color:"#0b2a6f"}}>{sr.expectedSpike!=null?sig3(convertConc(sr.expectedSpike, unit, displayUnitResults))+" "+displayUnitResults:"—"}</strong>
                    </div>
                    <div style={{fontSize:10,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Step 2 — Percent recovery</div>
                    <div style={{fontSize:11,color:"#5a6984",marginBottom:8,fontStyle:"italic"}}>Subtract the endogenous baseline so the numerator isolates only the spike contribution.</div>
                    <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:13,color:"#30437a"}}>
                      <span>% Recovery</span><span>=</span>
                      <Fraction top={<span>{sr.spikedConc!=null?sig3(convertConc(sr.spikedConc, unit, displayUnitResults)):"—"} {sr.noEndo?"– 0":("– "+(sr.endogenousConc!=null?sig3(convertConc(sr.endogenousConc, unit, displayUnitResults)):"—"))}</span>} bottom={<span>{sr.expectedSpike!=null?sig3(convertConc(sr.expectedSpike, unit, displayUnitResults))+" "+displayUnitResults:"expected"}</span>} w={260} />
                      <span>× 100</span><span>=</span>
                      <strong style={{color:pass==null?"#6e6e73":(pass?"#1b7f6a":"#b4332e"),fontSize:16}}>{sr.recovery!=null?sr.recovery.toFixed(1)+"%":"—"}</strong>
                    </div>
                  </div>
                </details>}
              </div>);})}
            </div>}
          </div>);
        });})}

        <details style={{marginBottom:"1.5rem"}}><summary style={{fontSize:13,fontWeight:600,cursor:"pointer",color:"#6e6e73"}}>References</summary><div style={{marginTop:8,fontSize:12,color:"#6e6e73",lineHeight:1.7}}><p style={{margin:"0 0 6px"}}>FDA Bioanalytical Method Validation (2018), VII.A.</p><p style={{margin:"0 0 6px"}}>ICH M10 (2022).</p><p style={{margin:"0 0 6px"}}>Findlay and Dillard, AAPS J 2007;9(2):E260.</p><p style={{margin:0}}>DeSilva et al., AAPS J 2003;5(4):22.</p></div></details>
        <div style={{marginBottom:"1rem",padding:"10px 14px",background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:10,fontSize:12,color:"#30437a",lineHeight:1.6}}>
          <strong>Final reported numbers</strong> are summarized in the <strong>Recommendations</strong> tab.
        </div>
        <button onClick={doExport} style={{background:"linear-gradient(135deg,#1b7f6a,#3478F6)",color:"#fff",border:"none",padding:"12px 32px",borderRadius:12,fontWeight:700,fontSize:14,cursor:"pointer"}}>Export CSV</button>
      </div>);
      })()}
      {tab===2&&!res&&<div style={{padding:"3rem",textAlign:"center",color:"#aeaeb2"}}>Run analysis first.</div>}

      {/* RECOMMENDATIONS */}
      {tab===3&&res&&(function(){
        var cd=res.flatMap(function(pp){return pp.samps.map(function(s){return {nm:s.name,r:s.aS};});});
        var cols2=["#1b7f6a","#3478F6","#bf4800","#6b4fa0","#a05a00","#248a3d"];
        // Per-sample strategy agreement: for each sample, compute range/median across strategies
        var divergences = cd.map(function(d){
          var vals = SM.map(function(m){return d.r[m.id]&&d.r[m.id].conc!=null?d.r[m.id].conc:null;}).filter(function(v){return v!=null;});
          if(vals.length<2) return {nm:d.nm, range:null, pct:null, n:vals.length};
          var vmin=Math.min.apply(null,vals), vmax=Math.max.apply(null,vals);
          var vmed=med(vals);
          var range=vmax-vmin;
          var pct=vmed>0?(range/vmed)*100:null;
          return {nm:d.nm, range:range, pct:pct, vmin:vmin, vmax:vmax, vmed:vmed, n:vals.length};
        });
        // Pairwise Wilcoxon: for each pair of strategies, compute signed-rank p-value across samples
        var pairwise = [];
        for(var i=0;i<SM.length;i++){
          for(var j=i+1;j<SM.length;j++){
            var mA=SM[i], mB=SM[j];
            var diffs = cd.map(function(d){
              var a = d.r[mA.id]&&d.r[mA.id].conc!=null?d.r[mA.id].conc:null;
              var b = d.r[mB.id]&&d.r[mB.id].conc!=null?d.r[mB.id].conc:null;
              if(a==null||b==null) return null;
              return a-b;
            }).filter(function(v){return v!=null;});
            var test = wilcoxonSignedRank(diffs);
            var mdiff = diffs.length?med(diffs):null;
            var aAvgs = cd.map(function(d){return d.r[mA.id]&&d.r[mA.id].conc!=null?d.r[mA.id].conc:null;}).filter(function(v){return v!=null;});
            var avgA = aAvgs.length?avg(aAvgs):null;
            var pctDiff = (mdiff!=null && avgA!=null && avgA>0)?(mdiff/avgA)*100:null;
            pairwise.push({mA:mA, mB:mB, test:test, mdiff:mdiff, pctDiff:pctDiff, n:diffs.length});
          }
        }
        // Build the analyst summary using the LITERATURE-BACKED (ICH M10) strategy as the canonical reporting choice
        var litStrat = SM.find(function(m){return m.id==="literature";});
        var summaryRows = res.flatMap(function(pp,pi){return pp.samps.map(function(s,si){
          var sl = s.aS && s.aS.literature;
          var srs = spikeRowsForSample(pi,si);
          var rec = srs.length>0 ? srs[0].recovery : null;
          return {pi:pi+1, name:s.name, dil:sl&&sl.dil!=null?sl.dil:"", cv:sl&&sl.cv!=null?sl.cv:null, conc:sl&&sl.conc!=null?sl.conc:null, recovery:rec};
        });});
        return (<div>
          <div style={{marginBottom:"1.25rem"}}>
            <h3 style={{fontSize:18,fontWeight:800,color:"#0b2a6f",marginBottom:4}}>Recommendations</h3>
            <p style={{fontSize:13,color:"#6e6e73",margin:0,lineHeight:1.6}}>{instructor
              ? "Explore how the six selection strategies compare on your data. Concentrations the analyst would report can differ across strategies — this tab helps you decide which to use."
              : "Final reported concentrations using the recommended ICH M10 strategy (least-diluted qualified, no averaging). Toggle Instructor mode to compare strategies."}</p>
          </div>

          {/* Analyst summary: simple reported-concentration table with recovery */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1.25rem",marginBottom:"1.25rem"}}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
              <h4 style={{fontSize:14,fontWeight:700,margin:0,color:"#30437a"}}>Reported concentrations</h4>
              <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic"}}>Strategy: {litStrat.short} (ICH M10 default)</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%"}}>
                <thead><tr>
                  <th style={{...thS,textAlign:"left"}}>Plate</th>
                  <th style={{...thS,textAlign:"left"}}>Sample</th>
                  <th style={{...thS,textAlign:"right"}}>Dilution</th>
                  <th style={{...thS,textAlign:"right"}}>CV (%)</th>
                  <th style={{...thS,textAlign:"right"}}>[{targetP}] (<UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={11} color="#6e6e73" hoverColor="#0b2a6f" weight={700} />)</th>
                  <th style={{...thS,textAlign:"right"}}>Recovery</th>
                </tr></thead>
                <tbody>
                  {summaryRows.map(function(r,i){return <tr key={i}>
                    <td style={tdS}>{r.pi}</td>
                    <td style={{...tdS,fontWeight:700}}>{r.name}</td>
                    <td style={{...tdS,textAlign:"right"}}>{r.dil!==""?r.dil:"—"}</td>
                    <td style={{...tdS,textAlign:"right"}}>{r.cv!=null?<CVB val={r.cv} />:"—"}</td>
                    <td style={{...tdS,textAlign:"right",fontWeight:700}}>{r.conc!=null?sig3(convertConc(r.conc, unit, displayUnitResults)):"—"}</td>
                    <td style={{...tdS,textAlign:"right",fontWeight:700,color:r.recovery==null?"#aeaeb2":(r.recovery>=80&&r.recovery<=120?"#1b7f6a":"#b4332e")}}>{r.recovery!=null?r.recovery.toFixed(0)+"%":"—"}</td>
                  </tr>;})}
                </tbody>
              </table>
            </div>
            <div style={{marginTop:12,padding:"10px 14px",background:"#f6fbff",borderRadius:8,border:"1px solid #d7e7fb",fontSize:11,color:"#30437a",lineHeight:1.6}}>
              <strong>Why this strategy?</strong> ICH M10 (and FDA Bioanalytical Method Validation 2018) recommend reporting the least-diluted in-range, qualified dilution — no averaging across dilutions. This minimizes random and matrix-related error and is the regulatory default for bioanalytical reporting. The other strategies (averaging, mid-curve, etc.) are useful for method development and teaching but should not be the default for regulated work.
            </div>
            <button onClick={doExport} style={{marginTop:12,background:"linear-gradient(135deg,#1b7f6a,#3478F6)",color:"#fff",border:"none",padding:"10px 24px",borderRadius:10,fontWeight:700,fontSize:13,cursor:"pointer"}}>Export CSV</button>
          </div>

          {/* INSTRUCTOR-ONLY: full strategy comparison and statistical analysis */}
          {instructor && <div>

          {/* Per-sample agreement table (always visible) */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1.25rem",marginBottom:"1.25rem"}}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,marginBottom:6,flexWrap:"wrap"}}>
              <h4 style={{fontSize:14,fontWeight:700,margin:0,color:"#30437a"}}>Strategy agreement — per sample</h4>
              <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic"}}>How much do the six strategies disagree for each sample?</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%",marginTop:10}}>
                <thead><tr>
                  <th style={{...thS,textAlign:"left"}}>Sample</th>
                  {SM.map(function(m){return <th key={m.id} style={{...thS,textAlign:"right",fontSize:9}}>{m.short}</th>;})}
                  <th style={{...thS,textAlign:"left",background:"#f4f4f6"}}>Agreement</th>
                </tr></thead>
                <tbody>
                  {cd.map(function(d,i){
                    var div=divergences[i];
                    var agreementLabel, agreementBg, agreementFg;
                    if(div.pct==null){ agreementLabel="—"; agreementBg="#f4f4f6"; agreementFg="#6e6e73"; }
                    else if(div.pct<=10){ agreementLabel=instructor?"Strategies agree ("+div.pct.toFixed(0)+"%)":"Strategies agree"; agreementBg="#e8f5ea"; agreementFg="#1b7f6a"; }
                    else if(div.pct<=20){ agreementLabel=instructor?"Strategies differ mildly ("+div.pct.toFixed(0)+"%)":"Strategies differ mildly"; agreementBg="#fef3e2"; agreementFg="#a05a00"; }
                    else { agreementLabel=instructor?"Strategies disagree ("+div.pct.toFixed(0)+"%)":"Strategies disagree"; agreementBg="#ffeaed"; agreementFg="#b4332e"; }
                    return <tr key={i}>
                      <td style={{...tdS,fontWeight:700}}>{d.nm}</td>
                      {SM.map(function(m){return <td key={m.id} style={{...tdS,textAlign:"right"}}>{d.r[m.id]&&d.r[m.id].conc!=null?sig3(convertConc(d.r[m.id].conc, unit, displayUnitResults)):"—"}</td>;})}
                      <td style={{...tdS,background:agreementBg,color:agreementFg,fontWeight:700,fontSize:11}}>{agreementLabel}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            <details style={{marginTop:10}}>
              <summary style={{fontSize:11,color:"#3478F6",fontWeight:600,cursor:"pointer"}}>How is “Agreement” calculated?</summary>
              <div style={{marginTop:8,padding:"10px 14px",background:"#fafcff",borderRadius:8,border:"1px solid #dfe7f2",fontSize:12,color:"#5a6984",lineHeight:1.6}}>
                For each sample, we take the six concentrations produced by the six strategies, find the <strong>range</strong> (max − min), and divide it by the <strong>median</strong> of those six values. That gives a percent describing how much the strategies disagree relative to a typical reported value.
                <ul style={{marginTop:6,paddingLeft:22,marginBottom:0}}>
                  <li><span style={{color:"#1b7f6a",fontWeight:700}}>Strategies agree</span> (&le;10%): any strategy gives essentially the same answer — safe to use the default.</li>
                  <li><span style={{color:"#a05a00",fontWeight:700}}>Strategies differ mildly</span> (10–20%): the choice matters a little; usually within typical assay variability.</li>
                  <li><span style={{color:"#b4332e",fontWeight:700}}>Strategies disagree</span> (&gt;20%): the choice meaningfully changes the reported concentration. Investigate why (often an outlier or borderline in-range dilution).</li>
                </ul>
              </div>
            </details>
          </div>

          {/* Strategy comparison chart */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1.25rem",marginBottom:"1.25rem"}}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
              <h4 style={{fontSize:14,fontWeight:700,margin:0,color:"#30437a"}}>Strategy comparison chart</h4>
              <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic"}}>All samples, all strategies, side by side</span>
            </div>
            <CmpChart data={cd} />
            <div style={{display:"flex",gap:14,marginTop:12,flexWrap:"wrap",fontSize:11}}>{SM.map(function(m,i){return <span key={m.id} style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:12,height:12,borderRadius:4,background:cols2[i],display:"inline-block"}}></span><span style={{color:"#6e6e73"}}>{m.short}</span></span>;})}</div>
          </div>

          {/* Instructor-only pairwise Wilcoxon */}
          {instructor && <div style={{background:"linear-gradient(180deg,#fffdf6,#fef8e8)",borderRadius:14,border:"1px solid #e8d396",padding:"1.25rem",marginBottom:"1.25rem"}}>
            <h4 style={{fontSize:14,fontWeight:800,color:"#7a5400",marginTop:0,marginBottom:6}}>Instructor view: pairwise statistical comparison</h4>
            <div style={{fontSize:12,color:"#5a4a20",lineHeight:1.6,marginBottom:12}}>
              <div style={{marginBottom:8}}>The <strong>per-sample agreement table above</strong> answers: <em>"do the strategies disagree on this specific sample?"</em> &mdash; that's what your analyst cares about for a single run. <strong>You only need one sample to see that.</strong></div>
              <div style={{marginBottom:8}}>The <strong>Wilcoxon test below</strong> answers a different question: <em>"across many samples, does strategy A systematically differ from strategy B?"</em> &mdash; that's a population-level question for method-development or validation work.</div>
              <div style={{marginBottom:8,padding:"8px 12px",background:"#fffaec",borderRadius:6,border:"1px dashed #e8d396"}}>
                <strong>Why N matters &mdash; the coin-flip analogy:</strong> if I flip a coin once and get heads, is the coin biased? I can't tell &mdash; one flip proves nothing. If I flip it 3 times and get 3 heads, it's suspicious but still plausible as random luck (12.5% chance). If I get 20 heads in 20 flips, now I'm almost certain the coin is biased. The Wilcoxon works the same way: each sample is one "flip" (does strategy A come out higher than B on this sample, or lower?). You need enough flips to distinguish a real bias from random coincidence. Usually <strong>N &ge; 7</strong> for a meaningful p-value; <strong>N &ge; 20</strong> for a publishable claim.
              </div>
              {cd.length < 7 && <div style={{color:"#a05a00",fontWeight:600,padding:"8px 12px",background:"#fff",borderRadius:8,border:"1px solid #e8d396"}}>You currently have {cd.length} sample{cd.length===1?"":"s"}. The Wilcoxon test needs about 7+ to be meaningful. Use the per-sample agreement above for operational decisions; treat these p-values as descriptive only.</div>}
            </div>

            {/* P-value mnemonic legend */}
            <div style={{padding:"12px 14px",background:"#fff",borderRadius:10,border:"1px solid #e8d396",marginBottom:12}}>
              <div style={{fontSize:11,color:"#7a5400",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>How to read p-values (legend)</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10,marginBottom:10}}>
                <div style={{padding:"10px 12px",background:"#ffeaed",borderLeft:"4px solid #b4332e",borderRadius:6}}>
                  <div style={{fontSize:13,color:"#b4332e",fontWeight:800,marginBottom:4}}>p &lt; 0.05</div>
                  <div style={{fontSize:11,color:"#7a2620",lineHeight:1.5}}>The strategies <strong>really do</strong> differ. Your choice <strong>matters</strong> &mdash; a different strategy would give a systematically different reported number.</div>
                </div>
                <div style={{padding:"10px 12px",background:"#e8f5ea",borderLeft:"4px solid #1b7f6a",borderRadius:6}}>
                  <div style={{fontSize:13,color:"#1b7f6a",fontWeight:800,marginBottom:4}}>p &ge; 0.05</div>
                  <div style={{fontSize:11,color:"#1b5a4d",lineHeight:1.5}}>Any difference seen <strong>could be just noise</strong>. Either strategy gives essentially the same answer in the long run.</div>
                </div>
              </div>
              <div style={{padding:"8px 12px",background:"#fff7e8",borderRadius:6,border:"1px dashed #e8d396",fontSize:11,color:"#7a5400",lineHeight:1.6}}>
                <strong>A way to remember it &mdash;</strong> p is the probability the difference is <em>fake</em> (just random noise).
                <ul style={{margin:"4px 0 0",paddingLeft:20}}>
                  <li>p = 0.001 → "0.1% chance this is fake" → <strong>very real</strong></li>
                  <li>p = 0.05 → "5% chance this is fake" → <strong>real-ish</strong> (just below the line)</li>
                  <li>p = 0.50 → "50% chance this is fake" → <strong>could go either way</strong></li>
                  <li>p = 0.90 → "90% chance this is fake" → <strong>almost certainly noise</strong></li>
                </ul>
                <div style={{marginTop:6,fontStyle:"italic"}}>Or the rhyme: <strong>"P below five, strategies collide. P above five, both survive."</strong></div>
              </div>
            </div>

            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
                <thead>
                  <tr>
                    <th style={{...thS,textAlign:"left",fontSize:10}}>Strategy A</th>
                    <th style={{...thS,textAlign:"left",fontSize:10}}>vs. Strategy B</th>
                    <th style={{...thS,textAlign:"right",fontSize:10}}>Median diff (A−B)</th>
                    <th style={{...thS,textAlign:"right",fontSize:10}}>% diff</th>
                    <th style={{...thS,textAlign:"right",fontSize:10}}>p-value</th>
                    <th style={{...thS,textAlign:"left",fontSize:10}}>Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {pairwise.map(function(pw,pi){
                    var sig = pw.test.p!=null && pw.test.p<0.05;
                    var practical = pw.pctDiff!=null && Math.abs(pw.pctDiff)>10;
                    var verdict, vcolor, vbg;
                    if(pw.test.p==null){ verdict="Too few pairs to test"; vcolor="#6e6e73"; vbg="#f4f4f6"; }
                    else if(sig && practical){ verdict="Different and it matters"; vcolor="#b4332e"; vbg="#ffeaed"; }
                    else if(sig && !practical){ verdict="Statistically different but small"; vcolor="#a05a00"; vbg="#fef3e2"; }
                    else if(!sig && practical){ verdict="Large spread but not consistent"; vcolor="#a05a00"; vbg="#fef3e2"; }
                    else { verdict="Practically equivalent"; vcolor="#1b7f6a"; vbg="#e8f5ea"; }
                    return <tr key={pi}>
                      <td style={{...tdS,fontWeight:600}}>{pw.mA.short}</td>
                      <td style={{...tdS,fontWeight:600,color:"#6e6e73"}}>{pw.mB.short}</td>
                      <td style={{...tdS,textAlign:"right",fontFamily:"monospace"}}>{pw.mdiff!=null?(pw.mdiff>=0?"+":"")+sig3(convertConc(pw.mdiff, unit, displayUnitResults)):"—"}</td>
                      <td style={{...tdS,textAlign:"right",fontFamily:"monospace"}}>{pw.pctDiff!=null?(pw.pctDiff>=0?"+":"")+pw.pctDiff.toFixed(1)+"%":"—"}</td>
                      <td style={{...tdS,textAlign:"right",fontFamily:"monospace",fontWeight:700,color:sig?"#b4332e":"#30437a"}}>{pw.test.p!=null?(pw.test.p<0.001?"<0.001":pw.test.p.toFixed(3)):"n/a"}</td>
                      <td style={{...tdS,background:vbg,color:vcolor,fontWeight:700,fontSize:10}}>{verdict}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            <details style={{marginTop:12}}>
              <summary style={{fontSize:11,color:"#7a5400",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,cursor:"pointer"}}>How these numbers are calculated</summary>
              <div style={{marginTop:10,padding:"12px 16px",background:"#fff",borderRadius:10,border:"1px solid #e8d396",fontSize:11,color:"#5a4a20",lineHeight:1.7}}>
                <p style={{margin:"0 0 8px"}}><strong>Median diff (A−B)</strong>: for each sample, we take the concentration under strategy A and subtract the concentration under strategy B. The median is reported to be robust against a single outlying sample.</p>
                <p style={{margin:"0 0 8px"}}><strong>% diff</strong>: the median difference expressed as a percentage of the mean concentration under strategy A across samples. Gives an intuitive magnitude: “strategy A reports X% higher than strategy B on average”.</p>
                <p style={{margin:"0 0 8px"}}><strong>p-value (Wilcoxon signed-rank)</strong>: rank the absolute paired differences from smallest to largest, then sum the ranks of the positive differences and the ranks of the negative differences. Under the null hypothesis (A and B give equivalent answers), those sums should be about equal. The test quantifies how unlikely the observed imbalance is. We use the normal approximation (valid for N≥7, reasonable for smaller N with appropriate caveats).</p>
                <p style={{margin:"0 0 8px"}}><strong>Verdict logic</strong>:
                  <br/>&bull; <span style={{color:"#1b7f6a",fontWeight:700}}>Practically equivalent</span>: p ≥ 0.05 AND |% diff| ≤ 10% — pick either strategy.
                  <br/>&bull; <span style={{color:"#b4332e",fontWeight:700}}>Different and it matters</span>: p &lt; 0.05 AND |% diff| &gt; 10% — real decision; ICH M10 favors the literature-backed strategy.
                  <br/>&bull; <span style={{color:"#a05a00",fontWeight:700}}>Statistically different but small</span>: p &lt; 0.05 AND |% diff| ≤ 10% — persistent bias smaller than typical assay noise; usually not clinically meaningful.
                  <br/>&bull; <span style={{color:"#a05a00",fontWeight:700}}>Large spread but not consistent</span>: p ≥ 0.05 AND |% diff| &gt; 10% — scatter without systematic direction; likely driven by outlier samples.
                </p>
                <p style={{margin:0,fontStyle:"italic"}}>Why Wilcoxon and not paired t-test? The signed-rank test is non-parametric — it doesn’t assume your concentrations are normally distributed. For small-N bioanalytical datasets where normality can’t be verified, this is the safer default.</p>
              </div>
            </details>
          </div>}

          {/* Strategy descriptions */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1.25rem",marginBottom:"1.25rem"}}>
            <h4 style={{fontSize:14,fontWeight:700,margin:"0 0 10px",color:"#30437a"}}>What each strategy does</h4>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12}}>
              {SM.map(function(m,i){return <div key={m.id} style={{padding:"10px 14px",background:"#fafcff",borderLeft:"3px solid "+cols2[i],borderRadius:6}}>
                <div style={{fontSize:12,fontWeight:800,color:"#30437a",marginBottom:4}}>{m.short} — {m.name}</div>
                <div style={{fontSize:11,color:"#5a6984",lineHeight:1.6}}>{m.desc}</div>
              </div>;})}
            </div>
            <div style={{marginTop:12,padding:"10px 14px",background:"#f6fbff",borderRadius:8,border:"1px solid #d7e7fb",fontSize:11,color:"#30437a",lineHeight:1.6}}>
              <strong>Regulatory note:</strong> for regulated bioanalysis (PK, biomarker for clinical trials), ICH M10 and FDA Bioanalytical Method Validation guidance recommend the <strong>literature-backed</strong> strategy (least-diluted qualified, no averaging). The other strategies are useful for method development, cross-validation, and teaching — but should not be the default reporting strategy in a regulated submission.
            </div>
          </div>
          </div>}
        </div>);
      })()}
      {tab===3&&!res&&<div style={{padding:"3rem",textAlign:"center",color:"#aeaeb2"}}>Run analysis first.</div>}

            {tab===4&&(<div>
        {planningMode && <div style={{marginBottom:"1rem",padding:"12px 16px",background:"linear-gradient(180deg,#f2f7ff,#eaf1fb)",border:"1px solid #c6d3e8",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:"#6337b9",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,flexShrink:0}}>▶</div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#30437a"}}>Planning mode</div>
              <div style={{fontSize:11,color:"#5a6984"}}>Use the calculators below to plan before you set up a plate. You can return to the main workflow anytime.</div>
            </div>
          </div>
          <button onClick={function(){setOn(false);setPlanningMode(false);setTab(0);}} style={{background:"#fff",border:"1px solid #c6d3e8",padding:"7px 12px",borderRadius:8,fontSize:11,fontWeight:600,color:"#30437a",cursor:"pointer",flexShrink:0}}>← Back to setup</button>
        </div>}
        <div style={{marginBottom:"1rem"}}>
          <h3 style={{fontSize:18,fontWeight:700,color:"#0b2a6f",marginBottom:4}}>Tools</h3>
          <p style={{fontSize:13,color:"#6e6e73",margin:0}}>Quick calculators for planning experiments. No plate data required.</p>
        </div>
        {(function(){
          var iconSpike = <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="3" width="10" height="14" rx="2" stroke="#fff" strokeWidth="1.6" fill="none"/>
            <line x1="11" y1="3" x2="11" y2="17" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1.5 2"/>
            <line x1="11" y1="17" x2="11" y2="20" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
          </svg>;
          var iconConv = <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 8 L18 8 L15 5 M18 8 L15 11" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <path d="M18 14 L4 14 L7 11 M4 14 L7 17" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>;
          var iconDilution = <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 2 L11 7 L7 16 Q7 19 11 19 Q15 19 15 16 L11 7" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinejoin="round"/>
            <path d="M8 14 Q11 12 14 14" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          </svg>;
          var iconElisa = <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="4" width="16" height="14" rx="1.5" stroke="#fff" strokeWidth="1.6" fill="none"/>
            <line x1="7" y1="4" x2="7" y2="18" stroke="#fff" strokeWidth="0.9" opacity="0.6"/>
            <line x1="11" y1="4" x2="11" y2="18" stroke="#fff" strokeWidth="0.9" opacity="0.6"/>
            <line x1="15" y1="4" x2="15" y2="18" stroke="#fff" strokeWidth="0.9" opacity="0.6"/>
            <line x1="3" y1="8" x2="19" y2="8" stroke="#fff" strokeWidth="0.9" opacity="0.6"/>
            <line x1="3" y1="13" x2="19" y2="13" stroke="#fff" strokeWidth="0.9" opacity="0.6"/>
            <circle cx="5" cy="6" r="0.9" fill="#fff"/>
            <circle cx="9" cy="10.5" r="0.9" fill="#fff"/>
            <circle cx="13" cy="15.5" r="0.9" fill="#fff"/>
          </svg>;
          var tools = [
            {id:"unit",  title:"Unit Converter",          desc:"Convert mg/mL ↔ ug/mL ↔ ng/mL etc.",  icon:iconConv,  color:"#0F8AA2"},
            {id:"spike", title:"Spike Recovery Planner",   desc:"Plan spike volumes and check expected recovery.", icon:iconSpike, color:"#6337b9"},
            {id:"elisa", title:"ELISA Designer",          desc:"Plan dilution schemes, interpret pilot runs, run real plates.", icon:iconElisa, color:"#BF7A1A"},
          ];
          if(!selectedTool){
            return <div>
              <div style={{fontSize:11,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>Choose a tool</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))",gap:12,marginBottom:"1rem"}}>
                {tools.map(function(t){
                  var tileBase = {
                    background:"#fff",
                    border:"1px solid "+BORDER,
                    borderRadius:14,
                    padding:"18px 18px",
                    textAlign:"left",
                    cursor:t.disabled?"not-allowed":"pointer",
                    boxShadow:"0 4px 10px rgba(11,42,111,0.04)",
                    display:"flex",
                    gap:14,
                    alignItems:"center",
                    transition:"all 0.15s",
                    fontFamily:"inherit",
                    opacity:t.disabled?0.55:1,
                    position:"relative"
                  };
                  return <button key={t.id} disabled={t.disabled} onClick={t.disabled?undefined:function(){setSelectedTool(t.id);}} style={tileBase} onMouseEnter={t.disabled?undefined:function(e){e.currentTarget.style.borderColor=t.color;e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 18px rgba(11,42,111,0.08)";}} onMouseLeave={t.disabled?undefined:function(e){e.currentTarget.style.borderColor=BORDER;e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 10px rgba(11,42,111,0.04)";}}>
                    <div style={{width:46,height:46,borderRadius:12,background:t.color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{t.icon}</div>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                        <span style={{fontSize:14,fontWeight:800,color:"#0b2a6f"}}>{t.title}</span>
                        {t.comingSoon && <span style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,background:"#fff7e0",color:"#8a6420",letterSpacing:0.4,textTransform:"uppercase"}}>Coming soon</span>}
                      </div>
                      <div style={{fontSize:12,color:"#6e6e73",lineHeight:1.4}}>{t.desc}</div>
                    </div>
                  </button>;
                })}
              </div>
              <div style={{background:"#fafcff",borderRadius:14,border:"1px dashed #dfe7f2",padding:"1rem 1.25rem",textAlign:"center"}}>
                <div style={{fontSize:11,color:"#aeaeb2",fontStyle:"italic"}}>Dilution planner, CV estimator, and other tools will appear here as they are added.</div>
              </div>
            </div>;
          }
          // A tool is selected: show back button + the tool
          var current = tools.filter(function(t){return t.id===selectedTool;})[0];
          return <div>
            <button onClick={function(){setSelectedTool(null);}} style={{background:"#fff",border:"1px solid #d8dfeb",color:"#30437a",padding:"6px 12px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",marginBottom:14,display:"inline-flex",alignItems:"center",gap:5}}>
              ← All tools
            </button>
            {selectedTool==="unit" && <UnitConverterCard />}
            {selectedTool==="spike" && <SpikeCalculatorCard instructor={instructor} />}
            {selectedTool==="elisa" && <ElisaDesignerCard instructor={instructor} onApplyDilutions={function(xdf, xds){
              // Populate the General Information sample dilution fields with the planned series, then jump to Data Entry tab.
              u("xdf", xdf);
              u("xds", xds);
              setOn(true);
              setTab(0);
            }} />}
          </div>;
        })()}
      </div>)}

      {tab===5&&dbg&&res&&(<div><h3 style={{fontSize:16,fontWeight:800,color:"#a05a00"}}>Debug</h3>{res.map(function(pp,pi){return <div key={pi} style={{marginBottom:"2rem"}}><h4 style={{fontSize:13,fontWeight:700}}>Plate {pi+1} | Blank: {fm4(pp.bA)}</h4><details><summary style={{fontSize:12,cursor:"pointer",color:"#6e6e73"}}>Standard</summary><table style={{borderCollapse:"collapse",width:"100%",marginTop:6,fontSize:10,fontFamily:"monospace"}}><thead><tr>{["Row","Conc","Raw","Blank","Corr","Avg","SD","CV (%)"].map(function(h){return <th key={h} style={thS}>{h}</th>;})}</tr></thead><tbody>{(pp.dbS||[]).map(function(d,i){return <tr key={i}><td style={tdS}>{d.row}</td><td style={tdS}>{sig3(d.conc)}</td><td style={tdS}>{d.raw.map(function(v){return v.toFixed(3);}).join(", ")}</td><td style={tdS}>{fm4(d.blank)}</td><td style={tdS}>{d.cor.map(function(v){return v.toFixed(4);}).join(", ")}</td><td style={tdS}>{fm4(d.avg)}</td><td style={tdS}>{fm4(d.sd)}</td><td style={tdS}><CVB val={d.cv} /></td></tr>;})}</tbody></table></details>{pp.samps.map(function(s,si){return <details key={si} style={{marginBottom:6}}><summary style={{fontSize:12,cursor:"pointer",color:"#6e6e73"}}>{s.name}</summary><table style={{borderCollapse:"collapse",width:"100%",marginTop:6,fontSize:10,fontFamily:"monospace"}}><thead><tr>{["Dil","Raw","Blank","Corr","Avg","CV (%)","IR","Well","DilF","Smp"].map(function(h){return <th key={h} style={thS}>{h}</th>;})}</tr></thead><tbody>{(s.dbD||[]).map(function(d,i){return <tr key={i}><td style={tdS}>{d.di}</td><td style={tdS}>{d.raw.map(function(v){return v.toFixed(3);}).join(", ")}</td><td style={tdS}>{fm4(d.blank)}</td><td style={tdS}>{d.cor.map(function(v){return v.toFixed(4);}).join(", ")}</td><td style={tdS}>{fm4(d.avgA)}</td><td style={tdS}><CVB val={d.cv} /></td><td style={tdS}>{d.ir?"Y":"N"}</td><td style={tdS}>{sig3(d.cW)}</td><td style={tdS}>{fm4(d.df)}</td><td style={tdS}>{sig3(d.cS)}</td></tr>;})}</tbody></table></details>;})}</div>;})}</div>)}
    </div>
  );
}

