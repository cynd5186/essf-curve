import { useState, useCallback, useRef, useEffect } from "react";

var avg = function(a) { return a.length ? a.reduce(function(s,v){return s+v;},0)/a.length : 0; };
var sdc = function(a) { if (a.length<2) return 0; var m=avg(a); return Math.sqrt(a.reduce(function(s,v){return s+(v-m)*(v-m);},0)/(a.length-1)); };
var cvc = function(a) { var m=avg(a); return m ? sdc(a)/Math.abs(m) : Infinity; };
var med = function(a) { var s=a.slice().sort(function(x,y){return x-y;}); var m=Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };
var APP_NAME = "eSSF Curve";
var APP_VERSION = "v5d3";

// Plain-language tooltip texts — used in many places via `title` attr on inline spans so
// analysts (who don't have the time/context for the long instructor-mode prose) can still
// hover for a definition. Keeping them at module scope so they're shared across components.
//
// DILUTIONAL_LINEARITY_TIP is intentionally written for a high-school-junior reading level —
// the long version is in DILUTIONAL_LINEARITY_LONG and shown in click-to-expand panels.
var DILUTIONAL_LINEARITY_TIP = "Dilutional linearity (in plain English): if you dilute a sample by 1:10 and 1:100 and measure both, you should get the same answer back after multiplying each by its dilution factor. If they don't match (within 80–120%), something's interfering with the measurement.";
var DILUTIONAL_LINEARITY_LONG = "Imagine a stock solution at 100 mg/mL. You dilute 1:10 (now 10 mg/mL), measure it, multiply your reading by 10 to undo the dilution — you should get back to 100 mg/mL.\n\nNow dilute the same stock 1:100 (now 1 mg/mL). Measure, multiply by 100. You should still get 100 mg/mL.\n\nIf both dilutions give about the same answer (within ±20% — say 90 to 110 mg/mL), the assay has DILUTIONAL LINEARITY. The math works. You can trust readings at any of those dilution levels.\n\nIf they don't agree — say 1:10 reads 100 mg/mL but 1:100 reads 130 mg/mL — something's wrong. Common causes:\n\n• MATRIX INTERFERENCE: stuff in the sample (salts, lipids, other proteins) messes with the measurement at high concentration. Diluting more lets the matrix get diluted away too.\n• HOOK EFFECT: at very high concentrations, the signal saturates and even drops back down. So a less-diluted reading may be falsely LOW.\n• NON-PARALLELISM: the sample's signal-vs-concentration curve has a different shape than the standard's curve. The standard is pure protein in clean buffer; your sample is the same protein in real biology, which doesn't always behave the same.\n\nThis is why ICH M10 wants neighboring dilutions to agree: passing dilutional linearity gives you confidence that the answer you're reporting reflects what's actually in the sample.";
var LLOQ_TIP = "LLOQ = Lower Limit of Quantitation: the lowest concentration the assay can quantitate with acceptable accuracy and precision. ICH M10 allows wider acceptance at LLOQ (accuracy 75–125%, CV ≤20%) because measurement noise is intrinsically larger at the bottom of the curve.";
var BLOQ_TIP = "BLOQ = Below Limit of Quantitation: a sample whose result fell below the LLOQ. Should not be reported as a numeric concentration; flag as <LLOQ instead.";
var SST_TIP = "SST = System Suitability sample: an independently-prepared known concentration that travels through the assay alongside unknowns. Its observed result is compared to the expected. If accuracy is within 80–120%, the workflow (matrix + dilutions + curve fit) is quantitating accurately for that concentration.";
var APP_TAGLINE = "Curve analysis, fitting & quantitation";
var APP_SUBTITLE = "Curve, qualify, validate.";
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
// fmtResponse: format optical-response / peak-area values. For LC-MS peak areas (1e6+), uses
// scientific notation (e.g. "1.23e7"). For smaller values (absorbance, fluorescence units),
// falls back to sig3. Threshold = 1e5 — below that, normal display is fine.
var fmtResponse = function(v) {
  if (v==null||isNaN(v)) return "---";
  if (v===0) return "0.00";
  var abs = Math.abs(v);
  if (abs >= 1e5 || abs < 0.001) {
    // Scientific notation with 3 sig figs
    var exp = Math.floor(Math.log10(abs));
    var mantissa = v / Math.pow(10, exp);
    return mantissa.toFixed(2) + "e" + (exp >= 0 ? "+" + exp : exp);
  }
  return sig3(v);
};
var fm4 = function(v) { if (v==null||isNaN(v)) return "---"; return Number(v).toFixed(4); };
var fpct = function(v) { if (v==null||isNaN(v)||!isFinite(v)) return "---"; return (v*100).toFixed(1)+"%"; };
var LE = "ABCDEFGH";
var pDil = function(s) { if (!s) return NaN; var t=s.trim(); if (t.indexOf("/")>=0) { var p=t.split("/"); return p[1]*1 ? p[0]*1/(p[1]*1) : NaN; } return parseFloat(t); };
var pOptionalDil = function(s) { var v=pDil(s); return (!isNaN(v)&&isFinite(v)&&v>0) ? v : 1; };
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
var buildBackcalcPreview = function(xf1, xs, n, sciThreshold) {
  if (!isFinite(xf1) || !isFinite(xs) || xf1 <= 0 || xs <= 0 || n <= 0) return null;
  var out = [];
  for (var d = 0; d < n; d++) {
    var df = xf1 * Math.pow(xs, d);
    if (!isFinite(df) || df <= 0) return null;
    out.push(fmtDilNum(1 / df, sciThreshold || 100000) + "×");
  }
  return out;
};
function linReg(x,y) { var n=x.length; if(n<2) return {slope:0,intercept:0,r2:0}; var sx=0,sy=0,sxx=0,sxy=0,syy=0; for(var i=0;i<n;i++){sx+=x[i];sy+=y[i];sxx+=x[i]*x[i];sxy+=x[i]*y[i];syy+=y[i]*y[i];} var d=n*sxx-sx*sx; if(Math.abs(d)<1e-15) return {slope:0,intercept:0,r2:0}; var sl=(n*sxy-sx*sy)/d, ic=(sy-sl*sx)/n, tot=syy-sy*sy/n, rs=syy-ic*sy-sl*sxy; return {slope:sl,intercept:ic,r2:tot?1-rs/tot:0}; }

// Log-log linear regression: fits log10(y) = slope*log10(x) + intercept. The model is y = (10^intercept) * x^slope,
// equivalently a power law. Useful in LC-MS and other wide-dynamic-range assays where a single-pass linear fit
// on un-transformed data is dominated by the high-conc points and underweights the low end.
//   To predict y from x:  y = pow(10, slope * log10(x) + intercept)
//   To predict x from y:  x = pow(10, (log10(y) - intercept) / slope)
// Both transforms require x > 0 and y > 0; pairs with non-positive values are skipped.
// Returns {slope, intercept, r2} on the LOG-TRANSFORMED data (so r2 reflects fit quality on log-log axes).
function logLogReg(x,y) {
  var lx=[], ly=[];
  for(var i=0;i<x.length;i++){
    if(x[i]>0 && y[i]>0 && isFinite(x[i]) && isFinite(y[i])){
      lx.push(Math.log10(x[i]));
      ly.push(Math.log10(y[i]));
    }
  }
  if(lx.length < 2) return {slope:0, intercept:0, r2:0};
  return linReg(lx, ly);
}

// Autosampler-mode standard-curve helpers
//
// In vials mode, the data-entry table references standards by integer level (1, 2, 3, ...). The
// actual concentration for each level is computed from General Information settings:
//   - cfg.asStdMode === "serial": top conc × DF^(level-1). User enters top conc + DF once, every
//     level gets its concentration via geometric series.
//   - cfg.asStdMode === "discrete": each level's concentration is typed individually into a small
//     editable list stored in cfg.asDiscreteLevels (JSON array of strings).
//
// asStandardConcForLevel(level, cfg) returns the actual concentration for a given level number.
// Returns null if the level cannot be resolved (e.g., discrete mode but level beyond the list).
//
// The unit returned is whatever the analyst set as cfg.unit. The serial dilution factor uses the
// pDil parser so accepts "1/2", "1:2", or "0.5" — same as the plate workflow.
function asStandardConcForLevel(level, cfg) {
  level = parseInt(level);
  if (!isFinite(level) || level < 1) return null;
  // Determine the level order. Default "highest" preserves backward compat: Level 1 = top, Level N = bottom.
  // "lowest" inverts: Level 1 = bottom, Level N = top.
  var levelOrder = (cfg && cfg.asLevelOrder) || "highest";
  if (cfg.asStdMode === "discrete") {
    var list = (function(){try{var x=JSON.parse(cfg.asDiscreteLevels||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
    var nonEmpty = list.filter(function(v){return parseFloat(v) > 0;});
    if (level > nonEmpty.length) return null;
    // For "lowest" mode: level 1 → list[N-1], level N → list[0]. Sort the list by VALUE first
    // so the inversion is conceptually "lowest concentration at top". For "highest" mode (default):
    // use the list as the analyst entered it (level 1 = first entry).
    var idx = (levelOrder === "lowest") ? (nonEmpty.length - level) : (level - 1);
    var v = parseFloat(nonEmpty[idx]);
    return isFinite(v) && v > 0 ? v : null;
  }
  // Default: serial dilution
  var top = parseFloat(cfg.asTopConc);
  if (!isFinite(top) || top <= 0) return null;
  var df = pDil(cfg.asSerialDF);
  if (!isFinite(df) || df <= 0 || df >= 1) return null;  // DF must be a real dilution-down step
  if (levelOrder === "lowest") {
    // Need a total level count for the inversion. Use cfg.asNStdLevels.
    var total = parseInt(cfg.asNStdLevels) || 6;
    if (level > total) return null;
    // Level 1 = top × df^(total-1) (lowest); Level total = top (highest)
    return top * Math.pow(df, total - level);
  }
  // "highest" — Level 1 = top, Level N = top × df^(N-1)
  return top * Math.pow(df, level - 1);
}

// Returns the count of standard levels currently configured in General Info.
//   - Discrete mode: count of non-empty entries in cfg.asDiscreteLevels
//   - Serial mode: returns a default of 6 levels (the typical autosampler curve length).
//     There's no inherent count in serial mode — the DF series is open-ended — so we pick a
//     sensible default and let the user adjust on Data Entry by adding/removing dilution rows.
//
// Used by Data Entry to size the standard-block grid.
function asNumLevels(cfg) {
  if (cfg.asStdMode === "discrete") {
    var list = (function(){try{var x=JSON.parse(cfg.asDiscreteLevels||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
    var nonEmpty = list.filter(function(v){return parseFloat(v) > 0;}).length;
    return nonEmpty > 0 ? nonEmpty : 6;
  }
  // Serial mode: default to 6 levels (most LC-MS calibration curves are 5-8 levels).
  return 6;
}

var logisticY=function(x,p,model){var A=p.A,D=p.D,C=Math.max(p.C,1e-12),B=Math.max(p.B,1e-6),G=model==="5pl"?Math.max(p.G,1e-6):1;return D+(A-D)/Math.pow(1+Math.pow(Math.max(x,1e-12)/C,B),G);};
var logisticInv=function(y,p,model){var A=p.A,D=p.D,C=Math.max(p.C,1e-12),B=Math.max(p.B,1e-6),G=model==="5pl"?Math.max(p.G,1e-6):1;var denom=y-D;if(Math.abs(denom)<1e-12)return null;var q=(A-D)/denom;if(q<=0)return null;var inner=Math.pow(q,1/G)-1;if(inner<=0||!isFinite(inner))return null;var x=C*Math.pow(inner,1/B);return isFinite(x)&&x>0?x:null;};
function fitLogistic(x,y,model){
  var n=x.length;if(n<(model==="5pl"?5:4))return null;
  var minX=Math.min.apply(null,x.filter(function(v){return v>0;})),maxX=Math.max.apply(null,x),minY=Math.min.apply(null,y),maxY=Math.max.apply(null,y);
  if(!isFinite(minX)||!isFinite(maxX)||maxX<=0||maxY===minY)return null;
  var tot=y.reduce(function(s,v){return s+Math.pow(v-avg(y),2);},0);
  // More initial guesses than before — improves convergence on noisy data with limited replicates.
  // Cover B from 0.5 to 3.0 (typical biological slopes), plus one assuming inverted curve direction.
  var starts = [];
  [0.5, 0.8, 1.0, 1.4, 2.0, 3.0].forEach(function(b){
    starts.push({A:minY, D:maxY, C:Math.sqrt(minX*maxX), B:b, G:1});
    starts.push({A:maxY, D:minY, C:Math.sqrt(minX*maxX), B:b, G:1});  // inverted (signal decreases with conc)
  });
  var best=null;
  var score=function(p){var s=0;for(var i=0;i<n;i++){var e=logisticY(x[i],p,model)-y[i];if(!isFinite(e))return Infinity;s+=e*e;}return s;};
  starts.forEach(function(st){
    var p={A:st.A,D:st.D,C:st.C,B:st.B,G:st.G},step={A:(maxY-minY)||1,D:(maxY-minY)||1,C:Math.log(maxX/minX||10),B:0.75,G:0.5};
    var theta=function(){return [p.A,p.D,Math.log(p.C),Math.log(p.B),Math.log(p.G)];};
    var apply=function(t){p.A=t[0];p.D=t[1];p.C=Math.exp(t[2]);p.B=Math.exp(t[3]);p.G=Math.exp(t[4]);};
    var stp=[step.A,step.D,step.C,step.B,step.G],t=theta(),cur=score(p);
    for(var iter=0;iter<220;iter++){
      var improved=false;
      for(var j=0;j<(model==="5pl"?5:4);j++){
        var cand=t.slice();cand[j]+=stp[j];apply(cand);var sc=score(p);
        if(sc<cur){t=cand;cur=sc;improved=true;continue;}
        cand=t.slice();cand[j]-=stp[j];apply(cand);sc=score(p);
        if(sc<cur){t=cand;cur=sc;improved=true;continue;}
        apply(t);
      }
      if(!improved){for(j=0;j<stp.length;j++)stp[j]*=0.72;if(Math.max.apply(null,stp)<1e-6)break;}
    }
    apply(t);cur=score(p);
    if(!best||cur<best.sse)best={p:{A:p.A,D:p.D,C:p.C,B:p.B,G:p.G},sse:cur};
  });
  if(!best)return null;
  return {model:model,params:best.p,sse:best.sse,r2:tot?1-best.sse/tot:0};
}
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

function selAll(dils,midA,assayKind) {
  var ir=dils.filter(function(d){return d.ir&&d.cv<.20&&d.cS!=null;});var r={};
  SM.forEach(function(m) {
    if(!ir.length){r[m.id]={conc:null,dil:null,cv:null,note:"No qualified",meth:m.short};return;}
    if(m.id==="literature"){
      var q=ir.filter(function(d){return d.cv<=.15;});
      if(assayKind==="elisa"){
        var qLba=q.filter(function(d){return d.lbaOK;});
        if(qLba.length){q=qLba;}
      }
      if(!q.length){r[m.id]={conc:null,dil:null,cv:null,note:"None CV<=15%",meth:m.short};return;}
      q.sort(function(a,b){return a.di-b.di;});
      r[m.id]={conc:q[0].cS,dil:q[0].di,cv:q[0].cv,note:(assayKind==="elisa"?(q[0].lbaOK?"Least-diluted qualified + dilutionally linear":"Least-diluted in range; no parallel neighbor"):"Least-diluted (#"+q[0].di+")"),meth:m.short};
    }
    else if(m.id==="mid_curve"){var so=ir.slice().sort(function(a,b){return Math.abs(a.avgA-midA)-Math.abs(b.avgA-midA);});r[m.id]={conc:so[0].cS,dil:so[0].di,cv:so[0].cv,note:"Mid-curve",meth:m.short};}
    // For averaging strategies, the meaningful CV is the SPREAD of the averaged sample concentrations (cS),
    // not any individual dilution's replicate CV. Small CV here means the dilutions agree well = good
    // dilutional linearity. Large CV means the dilutions disagree = report is suspect.
    else if(m.id==="avg_all_ir"){
      var concs = ir.map(function(d){return d.cS;});
      var mean = avg(concs);
      var sdSq = concs.length > 1 ? concs.reduce(function(s,v){return s + (v-mean)*(v-mean);}, 0) / (concs.length - 1) : 0;
      var sd = Math.sqrt(sdSq);
      var aggCv = (mean > 0 && concs.length > 1) ? sd/mean : null;
      r[m.id]={conc:mean,dil:null,cv:aggCv,note:"Avg "+ir.length,meth:m.short};
    }
    else if(m.id==="weighted_avg"){
      var wt=ir.map(function(d){return d.cv>0?1/d.cv:100;});
      var ws=wt.reduce(function(s,w){return s+w;},0);
      var wmean = ir.reduce(function(s,d,i){return s+d.cS*wt[i];},0)/ws;
      // Weighted variance: sum(w * (x-wmean)^2) / sum(w)
      var wvar = ir.length > 1 ? ir.reduce(function(s,d,i){return s + wt[i]*(d.cS-wmean)*(d.cS-wmean);}, 0) / ws : 0;
      var wsd = Math.sqrt(wvar);
      var aggCv2 = (wmean > 0 && ir.length > 1) ? wsd/wmean : null;
      r[m.id]={conc:wmean,dil:null,cv:aggCv2,note:"Weighted",meth:m.short};
    }
    else if(m.id==="median_ir"){
      var medVal = med(ir.map(function(d){return d.cS;}));
      var concs2 = ir.map(function(d){return d.cS;});
      var mean2 = avg(concs2);
      var sdSq2 = concs2.length > 1 ? concs2.reduce(function(s,v){return s + (v-mean2)*(v-mean2);}, 0) / (concs2.length - 1) : 0;
      var sd2 = Math.sqrt(sdSq2);
      var aggCv3 = (mean2 > 0 && concs2.length > 1) ? sd2/mean2 : null;
      r[m.id]={conc:medVal,dil:null,cv:aggCv3,note:"Median",meth:m.short};
    }
    else if(m.id==="lowest_cv"){var b2=ir.slice().sort(function(a,b){return a.cv-b.cv;})[0];r[m.id]={conc:b2.cS,dil:b2.di,cv:b2.cv,note:"Best CV",meth:m.short};}
  });return r;
}

function cvBg(v){if(v==null||isNaN(v)||!isFinite(v))return"#f0f0f0";var p=v*100;if(p<2)return"#e6f5f0";if(p<5)return"#e8f5ea";if(p<10)return"#e3f0fc";if(p<20)return"#fef3e2";return"#ffeaed";}
function cvTx(v){if(v==null||isNaN(v)||!isFinite(v))return"#999";var p=v*100;if(p<2)return"#0f5c4d";if(p<5)return"#248a3d";if(p<10)return"#0058b0";if(p<20)return"#a05a00";return"#d70015";}
function CVB(props){return <span style={{background:cvBg(props.val),color:cvTx(props.val),padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:600,display:"inline-block"}}>{fpct(props.val)}</span>;}

function MathWalk(props) {
  var d=props.d,m=props.slope,b=props.intercept,sn=props.sn,target=props.target,unit=props.unit,instructor=props.instructor,curveModel=props.curveModel||"linear";
  var params=props.params||{};
  if(!d) return null;
  // Display-unit conversion: if displayUnit differs from input unit, convert slope and conc outputs.
  // Intercept does NOT change. Optical-response (avgA, blank, raw) does NOT change.
  var dispUnit = props.displayUnit || unit;
  var convFactor = convertConc(1, unit, dispUnit);
  if (convFactor == null || !isFinite(convFactor) || convFactor === 0) convFactor = 1;
  var mDisp = m!=null ? m / convFactor : null;
  var bDisp = b;
  var cWDisp = d.cW != null ? d.cW * convFactor : null;
  var cSDisp = d.cS != null ? d.cS * convFactor : null;
  // Helper to render a number as superscript using Unicode superscript chars where possible,
  // falling back to <sup> for arbitrary numbers (decimals, large numbers).
  var sup = function(val){
    return <sup style={{fontSize:"0.75em",verticalAlign:"super",lineHeight:0}}>{val}</sup>;
  };
  var sub = function(val){
    return <sub style={{fontSize:"0.75em",verticalAlign:"sub",lineHeight:0}}>{val}</sub>;
  };
  var bx={padding:"10px 14px",margin:"8px 0",background:"#f8fafd",borderRadius:10,fontSize:13,lineHeight:1.9,fontFamily:"monospace",borderLeft:"3px solid #0071e3"};
  var lb={fontSize:11,color:"#6e6e73",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginTop:14,marginBottom:4};
  return (
    <div style={{padding:"1.25rem",background:"#fafcff",borderRadius:12,border:"1px solid #e0e8f0",marginTop:8}}>
      <div style={{fontSize:15,fontWeight:700,color:"#30437a",marginBottom:14}}>Calculation walkthrough: Dilution #{d.di}</div>
      <div style={lb}>Step 1: Standard curve equation</div>
      <div style={bx}>
        {curveModel==="linear" ? <div>
          <div>y = mx + b</div>
          <div>y = ({sig3(mDisp)}) x + ({sig3(bDisp)})</div>
        </div> : (curveModel==="loglog" ? <div>
          <div>log{sub("10")}(y) = m · log{sub("10")}(x) + b</div>
          <div>log{sub("10")}(y) = ({sig3(m)}) · log{sub("10")}(x) + ({sig3(b)})</div>
        </div> : <div>
          <div style={{marginBottom:6}}>{curveModel.toUpperCase()} logistic fit:</div>
          {/* Render equation as a proper fraction: y = D + (A - D) / (1 + (x/C)^B)^G */}
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:14,marginTop:4,flexWrap:"wrap"}}>
            <span>y =</span>
            <span>{params.D!=null ? sig3(params.D*convFactor) : "D"}</span>
            <span>+</span>
            <Fraction
              top={<span style={{whiteSpace:"nowrap"}}>{params.A!=null && params.D!=null ? sig3((params.A-params.D)*convFactor) : "(A − D)"}</span>}
              bottom={<span style={{whiteSpace:"nowrap"}}>
                (1 + (x / {params.C!=null ? sig3(params.C*convFactor) : "C"}){sup(params.B!=null ? sig3(params.B) : "B")})
                {curveModel==="5pl" && <span>{sup(params.G!=null ? sig3(params.G) : "G")}</span>}
              </span>}
              w={260}
            />
          </div>
          {params.A!=null && <div style={{fontSize:11,color:"#6e6e73",marginTop:8,fontStyle:"italic",fontFamily:"system-ui,-apple-system,sans-serif"}}>
            Fitted parameters: A (top asymptote) = {sig3(params.A*convFactor)} {dispUnit}; D (bottom asymptote) = {sig3(params.D*convFactor)} {dispUnit}; C (inflection point) = {sig3(params.C*convFactor)} {dispUnit}; B (slope factor) = {sig3(params.B)}
            {curveModel==="5pl" && params.G!=null && <span>; G (asymmetry) = {sig3(params.G)}</span>}
          </div>}
        </div>)}
        {instructor && <div style={{marginTop:8,paddingTop:8,borderTop:"1px dashed #cfd8e3",color:"#6e6e73",fontSize:12}}>
          <div style={{fontStyle:"italic",marginBottom:2,fontFamily:"system-ui,-apple-system,sans-serif",textTransform:"none",letterSpacing:0}}>What the variables represent here:</div>
          <div>y = optical signal (absorbance / fluorescence read by the plate reader)</div>
          <div>x = concentration of {sn} in the well ({dispUnit})</div>
          {curveModel==="linear" ? <div><div>m = slope of the standard curve = {sig3(mDisp)}</div><div>b = y-intercept = {sig3(bDisp)}</div></div> : (curveModel==="loglog" ? <div>The app converts the linear log{sub("10")}–log{sub("10")} fit back to natural y for back-calculation.</div> : <div>The app solves the logistic curve backward to find x from the measured signal.</div>)}
        </div>}
      </div>
      <div style={lb}>Step 2: Blank correction</div>
      <div style={bx}><div>Raw replicates: {d.raw?d.raw.map(function(v){return v.toFixed(3);}).join(", "):"N/A"}</div><div>Blank: {fm4(d.blank)}</div><div>Corrected = Raw - Blank</div><div>Corrected: {d.cor?d.cor.map(function(v){return v.toFixed(4);}).join(", "):"N/A"}</div></div>
      <div style={lb}>Step 3: Average + CV</div>
      <div style={bx}><div>Avg corrected = {fmtResponse(d.avgA)}</div><div>CV = SD(corrected) / Mean(corrected) = {fpct(d.cv)}</div></div>
      <div style={lb}>Step 4: Solve for [{sn}] in well</div>
      <div style={bx}>
        {instructor && <div style={{marginBottom:10,paddingBottom:10,borderBottom:"1px dashed #cfd8e3",fontFamily:"system-ui,-apple-system,sans-serif",letterSpacing:0,textTransform:"none"}}>
          <div style={{fontSize:11,color:"#6337b9",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>How we rearrange the equation</div>
          <div style={{fontSize:13,color:"#30437a",lineHeight:1.8,fontFamily:"monospace"}}>
            {curveModel==="linear" ? <div><div>Start with the standard curve:</div>
            <div style={{marginLeft:12,marginTop:2,marginBottom:6}}>y = m x + b</div>
            <div>where y = optical signal, x = [Protein], m = slope, b = intercept.</div>
            <div style={{marginTop:8}}>Subtract b from both sides:</div>
            <div style={{marginLeft:12,marginTop:2,marginBottom:6}}>y &minus; b = m x</div>
            <div>Divide both sides by m:</div>
            <div style={{marginLeft:12,marginTop:2,marginBottom:6}}>(y &minus; b) / m = x</div>
            <div>Which gives us [Protein] in the well:</div>
            <div style={{marginLeft:12,marginTop:2,fontWeight:700,color:"#0b2a6f"}}>[Protein]<sub>well</sub> = (y &minus; b) / m</div></div> : <div>
              <div>For ELISA, the curve is S-shaped rather than linear.</div>
              <div style={{marginTop:6}}>The app fits a {curveModel.toUpperCase()} logistic model to the standards, then uses the inverse logistic equation to solve for concentration.</div>
            </div>}
          </div>
        </div>}
        {curveModel==="linear" && <div><div>x = (y - b) / m</div><div>x = ({fmtResponse(d.avgA)} - {sig3(bDisp)}) / {sig3(mDisp)}</div></div>}
        {curveModel!=="linear" && <div>x = inverse {curveModel.toUpperCase()}({fmtResponse(d.avgA)})</div>}
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
  // Multi-series overlay support:
  //   When props.series is provided, draw all curves overlaid. Each series object: {label, pts, fn, fL, r2, slope, intercept, params, model, color}.
  //   props.activeIdx selects which series gets the bold/highlight rendering; others are faded.
  //   Equation/R² text in the chart header reflects the ACTIVE series only (the focus).
  //   When props.series is omitted, behavior is identical to the legacy single-curve mode (uses props.pts/fn/fl/r2/slope/intercept/params/curveModel directly).
  useEffect(function() {
    var cv=ref.current; if(!cv) return;
    var multi = Array.isArray(props.series) && props.series.length>0;
    // Normalize to a series array internally so the draw logic is uniform.
    var seriesAll = multi ? props.series : [{
      label: null, pts: props.pts, fn: props.fn, fL: props.fl, r2: props.r2,
      slope: props.slope, intercept: props.intercept, params: props.params, model: props.curveModel,
      color: "#2d74ea"
    }];
    var activeIdx = multi ? Math.max(0, Math.min(seriesAll.length-1, props.activeIdx||0)) : 0;
    var active = seriesAll[activeIdx];
    if(!active || !active.pts || !active.pts.length) return;
    // Display-unit conversion: pts are stored in props.unit; if displayUnit differs, convert x-axis values + slope.
    // y-axis (optical response) does NOT change. Intercept does NOT change.
    var inUnit = props.unit;
    var dispUnit = props.displayUnit || props.unit;
    var convFactor = convertConc(1, inUnit, dispUnit);
    if (convFactor == null || !isFinite(convFactor) || convFactor === 0) convFactor = 1;
    var displaySlope = active.slope!=null ? active.slope / convFactor : null;
    var displayIntercept = active.intercept;
    var w=520,h=332,ctx=cv.getContext("2d"),dpr=window.devicePixelRatio||1;
    cv.width=w*dpr; cv.height=h*dpr; ctx.scale(dpr,dpr);
    var pd={top:52,right:30,bottom:60,left:88};
    var cw2=w-pd.left-pd.right, ch=h-pd.top-pd.bottom;
    // Map every series' pts into display units; compute combined extents so all curves fit.
    var seriesPts = seriesAll.map(function(s){
      return (s.pts||[]).map(function(p){return {conc: p.conc*convFactor, avg:p.avg, sd:p.sd};});
    });
    var allPts = seriesPts.reduce(function(a,b){return a.concat(b);},[]);
    if(!allPts.length) return;
    var xM=Math.max.apply(null,allPts.map(function(p){return p.conc;}))*1.15;
    var yM=Math.max.apply(null,allPts.map(function(p){return p.avg+(p.sd||0);}))*1.25;
    var sx=function(v){return pd.left+(v/xM)*cw2;};
    var sy=function(v){return pd.top+ch-(v/yM)*ch;};
    ctx.clearRect(0,0,w,h);
    var outer=ctx.createLinearGradient(0,0,w,h);
    outer.addColorStop(0,"#ffffff");
    outer.addColorStop(1,"#f6fbff");
    ctx.fillStyle=outer;
    ctx.fillRect(0,0,w,h);
    ctx.fillStyle="#15213d"; ctx.font="700 16px -apple-system,system-ui,sans-serif"; ctx.textAlign="center";
    ctx.fillText(multi ? "Standard Curves (all plates)" : "Standard Curve", w/2, 24);
    ctx.fillStyle="#7283a7";
    ctx.font="500 11px -apple-system,system-ui,sans-serif";
    // Subtitle: only shown for single-plate (where there's no in-chart dropdown to disambiguate).
    // Multi-plate suppresses the subtitle to avoid colliding with the Focus dropdown overlay.
    if(!multi) ctx.fillText("Average optical response with SD error bars", w/2, 40);
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
    // Helper: parse a hex color "#rrggbb" into rgba string with given alpha
    var toRgba = function(hex, a){
      if(!hex || hex.charAt(0)!=="#" || hex.length!==7) return "rgba(45,116,234,"+a+")";
      var r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
      return "rgba("+r+","+g+","+b+","+a+")";
    };
    // Draw inactive series first (faded), so the active one renders on top.
    var drawOrder = [];
    for(var di=0; di<seriesAll.length; di++) if(di!==activeIdx) drawOrder.push(di);
    drawOrder.push(activeIdx);
    drawOrder.forEach(function(idx){
      var s = seriesAll[idx];
      var spts = seriesPts[idx];
      if(!spts.length) return;
      var isActive = (idx === activeIdx);
      var color = s.color || "#2d74ea";
      // Inactive plates: clearly visible fit line (so analyst can compare curve shapes across plates)
      // but no markers/error bars (those would clutter when there are many plates).
      // Active plate: full color line + markers + error bars + glow.
      var alpha = isActive ? 1.0 : 0.55;
      // Draw fitted curve line
      if(s.fn){
        if(isActive){
          ctx.strokeStyle=toRgba(color, 0.12);
          ctx.lineWidth=8;
          ctx.lineCap="round";
          ctx.beginPath();
          {
            var lastValid = false;
            for(i=0;i<=200;i++){
              var xv=xM*i/200, yv=s.fn(xv/convFactor);
              if (yv == null || !isFinite(yv) || isNaN(yv)) { lastValid = false; continue; }
              var py_clamped = sy(Math.max(0,Math.min(yM*2,yv)));
              var px=sx(xv);
              if (!lastValid) { ctx.moveTo(px, py_clamped); lastValid = true; }
              else ctx.lineTo(px, py_clamped);
            }
          }
          ctx.stroke();
        } else {
          // Subtle dashing for inactive lines so they're visually distinct from the active one even at similar colors
          ctx.setLineDash([5,3]);
        }
        ctx.strokeStyle=toRgba(color, alpha);
        ctx.lineWidth=isActive ? 3 : 2;
        ctx.beginPath();
        {
          var lastValid2 = false;
          for(i=0;i<=200;i++){
            xv=xM*i/200; yv=s.fn(xv/convFactor);
            if (yv == null || !isFinite(yv) || isNaN(yv)) { lastValid2 = false; continue; }
            px=sx(xv); var py_c = sy(Math.max(0,Math.min(yM*2,yv)));
            if (!lastValid2) { ctx.moveTo(px, py_c); lastValid2 = true; }
            else ctx.lineTo(px, py_c);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Markers + error bars only for the active series (keeps the chart readable when 10+ plates).
      if(isActive){
        for(i=0;i<spts.length;i++){
          var p=spts[i],px2=sx(p.conc),py2=sy(p.avg);
          if(p.sd>0){
            var yt=sy(p.avg+p.sd),yb=sy(Math.max(0,p.avg-p.sd));
            ctx.strokeStyle=toRgba("#10b3c8", alpha);ctx.lineWidth=2.4;
            ctx.beginPath();ctx.moveTo(px2,yt);ctx.lineTo(px2,yb);ctx.stroke();
            ctx.beginPath();ctx.moveTo(px2-7,yt);ctx.lineTo(px2+7,yt);ctx.stroke();
            ctx.beginPath();ctx.moveTo(px2-7,yb);ctx.lineTo(px2+7,yb);ctx.stroke();
          }
          ctx.shadowColor=toRgba(color, 0.24);ctx.shadowBlur=10;
          ctx.fillStyle=color;ctx.beginPath();ctx.arc(px2,py2,6.5,0,Math.PI*2);ctx.fill();
          ctx.shadowBlur=0;
          ctx.fillStyle="#ffffff";ctx.beginPath();ctx.arc(px2,py2,3.2,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle="#dff7fb";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(px2,py2,6.5,0,Math.PI*2);ctx.stroke();
        }
      }
    });
    // x-axis label is rendered as HTML overlay outside the canvas (so the unit can be a clickable UnitPill).
    // Y-axis label still drawn in canvas (rotated text doesn't pair well with HTML overlay).
    ctx.fillStyle="#556682"; ctx.font="500 12px -apple-system,system-ui,sans-serif";
    ctx.save();ctx.translate(18,pd.top+ch/2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";ctx.fillText("Optical Response (avg +/- SD)",0,0);ctx.restore();
    var activeColor = active.color || "#2d74ea";
    // Fit label is rendered as HTML overlay (props.onFitChange enables click-to-change), so the canvas
    // skips drawing it here. The R² label stays canvas-drawn since it's not interactive.
    ctx.fillStyle="#71819f";ctx.font="600 12px -apple-system,system-ui,sans-serif";ctx.textAlign="right";
    ctx.fillText("R\u00b2 = "+sig3(active.r2),pd.left+cw2-12,pd.top+18);
    ctx.textAlign="left";
    ctx.fillStyle="#556682";
    ctx.font="600 13px -apple-system,system-ui,sans-serif";
    var activeModel = active.model;
    // All equations render as HTML overlay below (proper math typesetting + automatic update on
    // fit change). Canvas only shows R² in the upper-right. This keeps linear/log-log/4PL/5PL
    // visually consistent.
    if(props.instructor){
      ctx.fillStyle="#8e9bb5";
      ctx.font="italic 500 10.5px -apple-system,system-ui,sans-serif";
      var teachLine = (activeModel==="4pl"||activeModel==="5pl")
        ? "A=top signal, D=bottom signal, C=midpoint concentration, B=slope; inverse solves concentration from signal"
        : (activeModel==="loglog"
            ? "Power law: peak area scales as concentration^slope. Slope=1 means linear, slope>1 means area grows faster than concentration."
            : "Optical Response = (slope) \u00d7 ["+props.sn+"] + (intercept)");
      ctx.fillText(teachLine, pd.left+12, pd.top+(activeModel==="4pl"||activeModel==="5pl"?64:50));
    }
  },[props.pts,props.fn,props.sn,props.fl,props.r2,props.unit,props.instructor,props.displayUnit,props.slope,props.intercept,props.curveModel,props.params,props.series,props.activeIdx]);
  // Wrapper holds canvas + HTML x-axis label with clickable UnitPill positioned over where the canvas text was.
  // Canvas is 520x332 with the x-axis label horizontally centered; the label sits ~10px above the canvas bottom edge.
  // props.overlay (optional): a React node positioned absolute, bottom-right of the canvas, INSIDE the plot area.
  // Plot area spans from pd.left to w-pd.right horizontally and from pd.top to h-pd.bottom vertically; the
  // bottom-right corner of the plot area is at (w-pd.right, h-pd.bottom) = (490, 272) on the 520x332 canvas.
  // We position the overlay just inside that corner so it sits within the plot's gradient background.
  return <div style={{position:"relative",display:"inline-block"}}>
    <canvas ref={ref} style={{width:520,height:332,maxWidth:"100%",borderRadius:16,display:"block"}} />
    <div style={{position:"absolute",left:0,right:0,bottom:6,textAlign:"center",fontSize:12,color:"#556682",fontWeight:500,pointerEvents:"none"}}>
      <span style={{pointerEvents:"auto"}}>[{props.sn}] (<UnitPill unit={props.displayUnit||props.unit} onChange={props.onDisplayUnitChange||function(){}} size={12} color="#556682" hoverColor="#0b2a6f" weight={500} />)</span>
    </div>
    {/* Clickable fit-type changer at the canvas text position (pd.left+12=100, pd.top+18=70 on 520x332).
        As percentages: left ≈ 19%, top ≈ 17%. Underline shows it's clickable; dropdown changes the fit
        and parent re-runs analysis. */}
    {props.onFitChange && (function(){
      var activeFL = (function(){
        if (props.series && props.activeIdx != null && props.series[props.activeIdx]) return props.series[props.activeIdx].fL;
        return props.fl || "Linear";
      })();
      var activeColor = (function(){
        if (props.series && props.activeIdx != null && props.series[props.activeIdx] && props.series[props.activeIdx].color) return props.series[props.activeIdx].color;
        return "#2d74ea";
      })();
      var activeModel = (function(){
        if (props.series && props.activeIdx != null && props.series[props.activeIdx]) return props.series[props.activeIdx].model;
        return props.curveModel || "linear";
      })();
      var fitOptions = [
        {value:"auto", label:"Auto (best fit)"},
        {value:"linear", label:"Linear"},
        {value:"loglog", label:"Log-log"},
        {value:"4pl", label:"4PL"},
        {value:"5pl", label:"5PL"}
      ];
      // For the dropdown's selected value: if cfg told us "auto" but the actual fit ended up "loglog",
      // we should still show "auto" as selected (so the user knows it's auto-picked). Use a separate
      // prop `autoMode` for that. Falls back to activeModel when not provided.
      var dropdownValue = props.autoMode ? "auto" : activeModel;
      return <div style={{position:"absolute",left:"18%",top:"17%",fontSize:11,fontWeight:600,color:activeColor,fontFamily:"-apple-system,system-ui,sans-serif"}}>
        <span style={{position:"relative",display:"inline-block"}}>
          <span style={{borderBottom:"1px dotted "+activeColor,cursor:"pointer",pointerEvents:"none"}}>{props.autoMode ? activeFL+" fit (auto best fit)" : activeFL+" fit"}</span>
          <select
            value={dropdownValue}
            onChange={function(e){
              var newFm = e.target.value;
              if (newFm === dropdownValue) return;
              props.onFitChange(newFm);
            }}
            style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",fontSize:12,fontFamily:"inherit",border:"none",background:"transparent",appearance:"none",WebkitAppearance:"none"}}
            title="Click to change curve fit"
          >
            {fitOptions.map(function(o){return <option key={o.value} value={o.value}>{o.label}</option>;})}
          </select>
        </span>
      </div>;
    })()}
    {/* Equation overlay — proper math typesetting for all fit types (linear, log-log, 4PL, 5PL).
        Replaces canvas-drawn equations entirely so all fits get consistent typography and live
        update on fit change. Positioned just under the fit-picker. */}
    {(function(){
      var active = (function(){
        if (props.series && props.activeIdx != null && props.series[props.activeIdx]) return props.series[props.activeIdx];
        return {model: props.curveModel, params: props.params, slope: props.slope, intercept: props.intercept};
      })();
      var model = active && active.model;
      if (!model) return null;
      var disp = props.displayUnit || props.unit;
      var convF = (function(){var f = convertConc(1, props.unit, disp); return (f && isFinite(f) && f !== 0) ? f : 1;})();
      var sup = function(val){return <sup style={{fontSize:"0.75em",verticalAlign:"super",lineHeight:0}}>{val}</sup>;};
      var sub = function(val){return <sub style={{fontSize:"0.75em",verticalAlign:"sub",lineHeight:0}}>{val}</sub>;};
      var bg = "#f5f9fd";  // matches plot gradient at this vertical position — formula "melts" into plot
      var wrapStyle = {position:"absolute",left:"18%",top:"23%",fontSize:11,color:"#0b2a6f",fontFamily:"-apple-system,system-ui,sans-serif",pointerEvents:"none",background:bg,padding:"3px 6px",borderRadius:5,maxWidth:"50%"};
      if (model === "linear") {
        // Linear: y = (m) · x + (b). m and b are reported in the active display unit's space.
        if (active.slope == null || active.intercept == null) return null;
        // Slope conversion: slope has units of [signal/concentration]. Converting display unit
        // multiplies x by convF, so to keep y unchanged the slope divides by convF.
        var mDisp = active.slope / convF;
        var bDisp = active.intercept;
        return <div style={wrapStyle}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span>y = </span>
            <span>{sig3(mDisp)}</span>
            <span> · x + </span>
            <span>{sig3(bDisp)}</span>
          </div>
        </div>;
      }
      if (model === "loglog") {
        if (active.slope == null || active.intercept == null) return null;
        // Log-log fit: log₁₀(y) = m · log₁₀(x) + b. Power-law form: y = 10^b · x^m.
        return <div style={wrapStyle}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <span>log{sub("10")}(y) = </span>
            <span>{sig3(active.slope)}</span>
            <span> · log{sub("10")}(x) + </span>
            <span>{sig3(active.intercept)}</span>
          </div>
        </div>;
      }
      if (model === "4pl" || model === "5pl") {
        if (!active.params) return null;
        var A = active.params.A;  // signal — no conv
        var D = active.params.D;  // signal — no conv
        var C = active.params.C * convF;  // concentration — convert
        var B = active.params.B;
        var G = active.params.G;
        return <div style={wrapStyle}>
          <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"nowrap"}}>
            <span>y =</span>
            <span>{sig3(D)}</span>
            <span>+</span>
            <Fraction
              top={<span style={{whiteSpace:"nowrap"}}>{sig3(A - D)}</span>}
              bottom={<span style={{whiteSpace:"nowrap"}}>
                (1 + (x/{sig3(C)}){sup(sig3(B))})
                {model==="5pl" && sup(sig3(G))}
              </span>}
              w={130}
            />
          </div>
        </div>;
      }
      return null;
    })()}
    {/* Overlay: bottom-right INSIDE the plot rectangle. Plot area on the 520x332 canvas spans
        x: 88..490 (cw=402, padding 88L/30R) and y: 52..272 (ch=220, padding 52T/60B).
        Bottom-right corner = (490, 272) → right offset = (520-490)/520 = 5.8%, bottom offset = (332-272)/332 = 18.1%.
        We add a small inset so the overlay sits a few px inside the plot edge (not flush against it).
        Percentage offsets ensure the overlay tracks the canvas as it scales down on narrow viewports. */}
    {props.overlay && <div style={{position:"absolute",bottom:"20%",right:"7.5%",zIndex:2}}>{props.overlay}</div>}
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

function BrandHero(){return <div style={{marginBottom:"1.5rem"}}><img src={ESSF_LOGO_B64} alt="eSSF Curve" style={{height:96,objectFit:"contain",marginBottom:10,display:"block"}} /><div style={{fontSize:14,color:"#5a6984",marginBottom:12,fontWeight:500}}>Curve, qualify, validate.</div><div style={{height:1,background:"#cfd9ea"}} /></div>;}

var thS={padding:"8px 10px",borderBottom:"2px solid #e5e5ea",fontSize:11,color:"#6e6e73",fontWeight:700,letterSpacing:0,background:"#fafafa",whiteSpace:"normal",textAlign:"center"};
var tdS={padding:"8px 10px",borderBottom:"1px solid #f0f0f3",fontSize:12,whiteSpace:"normal",textAlign:"center"};
var TABS=["Data Entry","Analysis","Results","Method Review","Tools"];

var ESSF_LOGO_B64 = "data:image/png;base64,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ZUuX3HXXXZMP3N7/+Sc///l5H3+yfPHmLVu5pa2dM1mbU5k8b9+xR23YuPnDm2666cBt/Ygl/OenZvxsxer1n27dtjPflkhxRzLHrW0d/NmWbcm577434+qrr+4/fvx4079Onyjxk5/8/LtLPvpk2979LdyeznNbop2bWpr5s61bef777/PqtWu5I5XkvG2xrZygBuUoh20rz8ys57y/hHv1O2TcwdalZCUrWcm+nNXXu5FB9yGjn397ocXMKmfb7GjH+1JsK82WrTiXtzlvK844zElbczKf545kkpPtCU6lktyRz3NbMsmWY7FtZziTjrOtbe5Qmtc1NvOCz/bwX+Z/yre+vJjPf+hl/sofXubwxGv3muNuYOPoG7IY/3MH467XdMS1+cgxv2L0vHjFq++vWdyRTvG3Lv+eU92tx4cArgdQV1tbO6G+vj52INj6jreopyh8yimnjOzWrdshB166P3L9AJAJIsuKrl0PHf+Vo0eNGTNmbASRfsVp0b/nhIv7kvoPGXLYD667bsI9Dzxw+NenTDmyS48eAw72uYO9dvkVVxyxcOGSoz/+ePmxW7ZsGX3WWVMG+u8tXbr0wF4rrxzk2tXfu3rEO+/MP2HZslXHvPbWvLEAqrwP4YorrjD/zhrU/vyXvzxt4cLFk996663jHnz4weNGjRo1rmu3mr/94JqredWa1SpvW+woF5xs5bCtFStHMTPb8Wyep1525W0HrmHJSlaykn2pyMl3Jg0NDerEi66+6rEH7njokG6VjuMogw0B0hbAIUgi0D/gZzkAUjmFRCqJpK2wO5HV25rb9P6kEit3NmJPokPsTKSQgomsBQAaYAOQQP/23S073tnShPLyYbIiTKA8tJLg/fHNJxzde95bT//moq1bN5U/9sgjumvXmpf79+27bO/e/Ttef/75hQuXLt1FRLjgggvkLK9jvGhiLADEZsyY0fedd+Yd3qt7LzOVTe+bNeu/VjU2Njb5DvuACbiBGgSAHitWrOA//OHhI2JduiQMKc2+vQZs+vGPr9xXBIL6ICBDQghmZvTq1Su2cOHC8r/8ZUb322+ftuvVV181zz777JaiY3+uj2r69OnmVVddZXvn0OWee+6p/OST5ZP69u392VlTz9o98ciJaQBtB9mepk+fbhRti8ceu7fmvfeWDh04cCAvX75895w5c3Yf7Nxnzpwp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";


function PageHeader(props){
  var doReset = function(){
    if (typeof props.onReset === "function") {
      if (window.confirm("Start over? This will clear your data, plate setup, and analysis results.\n\nThis cannot be undone.")) {
        props.onReset();
      }
    }
  };
  var large = !!props.large;
  var logoH = large ? 96 : 38;
  return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,padding:large?"18px 20px 18px 20px":"10px 16px 12px 16px",background:"linear-gradient(180deg,#ffffff,#f7fbff)",borderBottom:"1px solid #dfe7f2",marginBottom:"1rem",borderRadius:"14px 14px 0 0"}}>
    <div style={{display:"flex",alignItems:"center",gap:large?16:12}}>
      <img src={ESSF_LOGO_B64} alt="eSSF Curve" style={{height:logoH,objectFit:"contain",display:"block"}} />
      <div onClick={props.onSecretTap} style={{fontSize:large?12:10,color:"#6f7fa0",fontFamily:"Georgia,serif",letterSpacing:1,paddingLeft:large?12:8,borderLeft:"1px solid #dfe7f2",cursor:"default",userSelect:"none"}}>{APP_VERSION}</div>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:14}}>
      <ModeToggle instructor={props.instructor} setInstructor={props.setInstructor} />
      {props.onReset && <button
        onClick={doReset}
        title="Clear data and return to setup"
        style={{
          background:"#fdecec",
          border:"1px solid #e8b8b8",
          color:"#8a3a3a",
          padding:"7px 14px",
          borderRadius:8,
          fontSize:12,
          fontWeight:700,
          cursor:"pointer",
          letterSpacing:0.3,
          boxShadow:"0 1px 2px rgba(138,58,58,0.08)"
        }}
        onMouseEnter={function(e){e.currentTarget.style.background="#fbdcdc";e.currentTarget.style.borderColor="#d99a9a";}}
        onMouseLeave={function(e){e.currentTarget.style.background="#fdecec";e.currentTarget.style.borderColor="#e8b8b8";}}
      >↺ Start over</button>}
    </div>
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
  return {sn:"GFP",sc:"1",sdf:"1/10",sds:"1/2",xdf:"1/10",xds:"1/2",stdPredil:"",smpPredil:"",np:"1",tp:"no",at:"direct",fm:"linear",names:"",sr:"3",xr:"3",unit:"mg/mL",target:"GFP",tmpl:"bca",spikeUsed:"no",requireUnspiked:"yes",layout:"classical",forceOriginInCurve:"no",sstExpected:"{}",sstFlags:"{}",stdMode:"top_plus_df",stdLevels:"[]",msSamples:"[]",msInjections:"[]",yAxisLabel:"Peak area",asStdMode:"serial",asTopConc:"",asSerialDF:"1/2",asDiscreteLevels:"[]",asNSamples:"3",asHasBlank:"yes",asGrid:"{}",asSampleNames:"[]",asSampleTypes:"[]",asNDilutions:"3",asNStdLevels:"6",asLevelOrder:"highest",xrMix:"3,3,2"};
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
  if (unit==="mg/mL" || unit==="ug/uL" || unit==="g/L") return v;
  if (unit==="mg/L" || unit==="ug/mL" || unit==="ng/uL") return v/1000;
  if (unit==="ug/L" || unit==="ng/mL" || unit==="pg/uL") return v/1000000;
  if (unit==="pg/mL") return v/1000000000;
  return null;
};
var mgMlToUnit = function(v, unit) {
  if (v==null || isNaN(v)) return null;
  if (unit==="mg/mL" || unit==="ug/uL" || unit==="g/L") return v;
  if (unit==="mg/L" || unit==="ug/mL" || unit==="ng/uL") return v*1000;
  if (unit==="ug/L" || unit==="ng/mL" || unit==="pg/uL") return v*1000000;
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
// Common mass-per-volume concentration units used across direct assays, protein assays, and ELISAs.
var CONC_UNITS = ["mg/mL", "mg/L", "ug/uL", "ug/mL", "ug/L", "ng/uL", "ng/mL", "pg/uL", "pg/mL"];
var SPIKE_STOCK_UNITS = ["mg/mL", "ug/uL", "ug/mL", "ng/uL", "ng/mL", "pg/uL", "pg/mL"];
// Cycle through compact display units (descending order of magnitude).
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
          {fldUnit("Estimated unspiked sample concentration","endoConc","assayUnit",CONC_UNITS)}
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
          {fldUnit("Stock concentration of the spike","stockConc","stockUnit",SPIKE_STOCK_UNITS)}
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
  var dilFormat = props.dilFormat || "ratio";
  var setDilFormat = props.setDilFormat || function(){};
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
    // Use a full column pilot by default: 7 dilution rows + 1 blank row.
    // This matches how many analysts already run serial dilutions and avoids wasting the column.
    var nPoints = 7;
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
    var preDilutionNeeded = false;
    var preDilutionFactor = 0;
    var preDilutionSource = "";
    var onPlateFirstDilution = dStart;
    var Vsample = firstWellTotal / onPlateFirstDilution;
    Vsample = Math.round(Vsample*100)/100;
    var firstWellDiluent = Math.round((firstWellTotal - Vsample)*100)/100;
    // If Vsample is impractically small, suggest a pre-dilution
    var preDilutedSampleVol = 0;
    var preDilutedDiluentVol = 0;
    if(Vsample < 2 && dStart > 1){
      preDilutionNeeded = true;
      preDilutionSource = "suggested";
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
      onPlateFirstDilution = dStart / preDilutionFactor;
      Vsample = firstWellTotal / onPlateFirstDilution;
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
      preDilutionSource: preDilutionSource,
      onPlateFirstDilution: onPlateFirstDilution,
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
      <div style={hdrTitle}>Dilution Planner</div>
      <div style={hdrSub}>Plan sample dilution schemes for ELISA, BCA, Bradford, Pierce 660, and other plate assays.</div>
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
          Tell us the measuring range for your assay and what you know about your sample. We'll design a pilot dilution series that brings at least one well into the usable curve range.
        </p>

        {/* Assay preset picker */}
        <div style={{display:"grid", gridTemplateColumns:"1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle}>Assay / kit preset (optional)</label>
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
                <div style={{fontSize:12, fontWeight:700, color:"#30437a", marginBottom:2}}>Or upload the assay SOP / datasheet (PDF)</div>
                <div style={{fontSize:10, color:"#6e6e73", lineHeight:1.5}}>
                  We'll scan the text for "standard curve range", "LLOQ", and concentration ranges to pre-fill the fields below. Best-effort extraction — always verify against your assay insert.
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
              {CONC_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}
            </select>
          </div>
        </div>

        {/* Estimate */}
        <h5 style={sectionH}>What is in your original tube?</h5>
        <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, marginBottom:14}}>
          {[
            {id:"value", label:"I have a number", desc:"Concentration before any dilution"},
            {id:"range", label:"I have a range", desc:"Range before any dilution"},
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
            <label style={labelStyle}>Original/neat concentration</label>
            <input value={planSt.estimateVal} onChange={function(e){pu("estimateVal",e.target.value);}} placeholder="e.g. 100" style={monoInputBox} />
            <div style={{fontSize:10, color:"#6e6e73", marginTop:4, lineHeight:1.4}}>This is the concentration in the starting tube before any tube or plate dilution.</div>
          </div>
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={planSt.estimateUnit} onChange={function(e){pu("estimateUnit",e.target.value);}} style={selectBox}>
              {CONC_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}
            </select>
          </div>
        </div>}
        {planSt.estimateMode==="range" && <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14}}>
          <div>
            <label style={labelStyle}>Low end before dilution</label>
            <input value={planSt.estimateLo} onChange={function(e){pu("estimateLo",e.target.value);}} placeholder="e.g. 10" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>High end before dilution</label>
            <input value={planSt.estimateHi} onChange={function(e){pu("estimateHi",e.target.value);}} placeholder="e.g. 1000" style={monoInputBox} />
          </div>
          <div>
            <label style={labelStyle}>Unit</label>
            <select value={planSt.estimateUnit} onChange={function(e){pu("estimateUnit",e.target.value);}} style={selectBox}>
              {CONC_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}
            </select>
          </div>
        </div>}
        {/* Result */}
        {planResult && <div style={{marginTop:18, paddingTop:18, borderTop:"2px solid "+BORDER}}>
          <div style={{fontSize:12, fontWeight:700, color:"#0f5c6a", textTransform:"uppercase", letterSpacing:0.5, marginBottom:10}}>Recommended pilot dilution series</div>

          {/* Number-line diagram */}

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
            {/* Numerical table shown by default */}
            <div style={{background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, overflow:"auto", marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px 0",flexWrap:"wrap",gap:8}}>
                <div style={{fontSize:11, fontWeight:700, color:"#0b2a6f", textTransform:"uppercase", letterSpacing:0.5}}>How to do it at the bench</div>
                <div style={{fontSize:10, color:"#aeaeb2", display:"flex", alignItems:"baseline", gap:4}}>
                  show dilutions as: <FormatPill value={dilFormat} onChange={setDilFormat}
                    labelOf={function(f){return f==="ratio"?"ratio (1:N)":"factor (N×)";}}
                    toggleOf={function(f){return f==="ratio"?"factor":"ratio";}}
                    size={10} color="#aeaeb2" hoverColor="#0b2a6f" />
                </div>
              </div>
              {planResult.preDilutionNeeded && <div style={{margin:"8px 12px 0",padding:"7px 10px",background:"#fff8ea",border:"1px solid #e8c77d",borderRadius:8,fontSize:11,color:"#7a5800",lineHeight:1.5}}>
                <strong>Step 1 — Pre-dilute in a tube first:</strong> Add {sig3(planResult.preDilutedSampleVol)} µL of your stock to {sig3(planResult.preDilutedDiluentVol)} µL of diluent. Mix. This gives you a {fmtDilution(1/planResult.preDilutionFactor,dilFormat,100000)} working dilution to load into A1.
              </div>}
              <div style={{padding:"6px 12px 4px",fontSize:10,color:"#6e6e73",fontStyle:"italic"}}>{planResult.preDilutionNeeded ? "Step 2 — " : "Step 1 — "}Pre-load diluent into all wells, then add {sig3(planResult.preDilutionNeeded ? planResult.benchProtocol[0].sampleVol : planResult.benchProtocol[0].sampleVol)} µL {planResult.preDilutionNeeded ? "of pre-dilution" : "of sample"} to A1. Transfer {sig3(planResult.transferVol)} µL down from each well to the next. Mix before each transfer.</div>
              <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
                <thead>
                  <tr style={{background:"#0b2a6f", color:"#fff"}}>
                    <th style={{padding:"7px 10px", textAlign:"left", fontWeight:700, fontSize:11}}>Well</th>
                    <th style={{padding:"7px 10px", textAlign:"left", fontWeight:700, fontSize:11}}>Dilution</th>
                    <th style={{padding:"7px 10px", textAlign:"left", fontWeight:700, fontSize:11, minWidth:220}}>What to do</th>
                    <th style={{padding:"7px 10px", textAlign:"left", fontWeight:700, fontSize:11}}>Then</th>
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
                        Pre-load <strong style={{fontFamily:"monospace", color:"#0b2a6f"}}>{sig3(b.preload)} µL</strong> diluent. Transfer <strong style={{fontFamily:"monospace", color:"#bf7a1a"}}>{sig3(b.transferIn)} µL</strong> from <strong>{b.transferInFrom}</strong>. Mix.
                      </span>;
                    }
                    if(b.transferOut > 0){
                      thenDesc = <span>Transfer <strong style={{fontFamily:"monospace"}}>{sig3(b.transferOut)} µL</strong> → <strong>{b.nextWell}</strong></span>;
                    } else {
                      thenDesc = <span style={{color:"#1a6b32", fontWeight:700}}>Last well — done</span>;
                    }
                    return <tr key={i} style={{borderTop:i?"1px solid #eef2f7":"none", background:bg}}>
                      <td style={{padding:"7px 10px", fontFamily:"monospace", fontWeight:800, color:"#30437a", fontSize:13, whiteSpace:"nowrap"}}>{b.wellLabel}</td>
                      <td style={{padding:"7px 10px", fontFamily:"monospace", fontWeight:700, color:"#6337b9", whiteSpace:"nowrap"}}>{fmtDilution(1/b.dilution, dilFormat, 100000)}</td>
                      <td style={{padding:"7px 10px", color:"#1d1d1f", fontSize:11, lineHeight:1.5}}>{stepDesc}</td>
                      <td style={{padding:"7px 10px", color:"#5a6984", fontSize:11, whiteSpace:"nowrap"}}>{thenDesc}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
              <div style={{padding:"6px 12px 8px", fontSize:10, color:"#6e6e73", fontStyle:"italic"}}>Each well ends at <strong>{planResult.workingVol} µL</strong>. Transfer = <strong>{sig3(planResult.transferVol)} µL</strong>. Pre-load diluent into all wells first (multichannel), then add sample to A1.</div>
            </div>
            {/* Graphical view — optional expand */}
            <details style={{marginTop:6}}>
              <summary style={{fontSize:11, color:"#3478F6", fontWeight:600, cursor:"pointer", userSelect:"none"}}>Show graphical diagram</summary>
              <div style={{marginTop:8}}>
                <BenchWorkflowDiagram result={planResult} dilFormat={dilFormat} setDilFormat={setDilFormat} />
              </div>
            </details>
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
            var plannedSeries = buildDilutionPreview(1/planResult.dStart, 1/planResult.step, planResult.series.length, dilFormat, 100000);
            var backcalcSeries = buildBackcalcPreview(1/planResult.dStart, 1/planResult.step, planResult.series.length, 100000);
            var firstWellOnPlate = planResult.preDilutionNeeded ? (planResult.dStart / planResult.preDilutionFactor) : planResult.dStart;
            var firstWellOnPlateLabel = fmtDilution(1/firstWellOnPlate, dilFormat, 100000);
            var tubeDilutionLabel = planResult.preDilutionNeeded ? fmtDilution(1/planResult.preDilutionFactor, dilFormat, 100000) : "none (1:1)";
            var sourceConcLabel = planSt.estimateMode==="value" && planSt.estimateVal
              ? planSt.estimateVal + " " + planSt.estimateUnit
              : "original tube";
            var totalMathText = planResult.preDilutionNeeded
              ? fmtDilution(1/planResult.preDilutionFactor, dilFormat, 100000) + " tube pre-dilution × " + firstWellOnPlateLabel + " in A1 = " + firstLabel + " total"
              : firstLabel + " is made directly in A1";
            return <div style={{marginTop:14, padding:"12px 14px", background:"linear-gradient(135deg,#eaf6f8,#f7fbfc)", border:"1.5px solid #0F8AA2", borderRadius:10}}>
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:14, flexWrap:"wrap"}}>
              <div style={{flex:"1 1 280px", fontSize:12, color:"#0f5c6a", lineHeight:1.6}}>
                <div style={{fontSize:12, fontWeight:800, color:"#0f5c6a", marginBottom:3, textTransform:"uppercase", letterSpacing:0.5}}>Send to Data Entry</div>
                Use these two sample-dilution fields if you follow this setup.
              </div>
              <button onClick={function(){props.onApplyDilutions(xdfStr, xdsStr);}} style={{background:"linear-gradient(135deg,#0F8AA2,#0b2a6f)", color:"#fff", border:"none", padding:"10px 18px", borderRadius:10, fontSize:13, fontWeight:800, cursor:"pointer", boxShadow:"0 6px 14px rgba(15,138,162,0.25)", whiteSpace:"nowrap"}}>Apply these values →</button>
              </div>
              <div style={{marginTop:10, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:8}}>
                <div style={{background:"#fff", border:"1.5px solid #0f8aa2", borderRadius:8, padding:"9px 10px"}}>
                  <div style={{fontSize:10, fontWeight:800, color:"#0f5c6a", textTransform:"uppercase", letterSpacing:0.4}}>Sample — first row</div>
                  <div style={{fontSize:20, fontWeight:900, color:"#0f5c6a", fontFamily:"monospace", marginTop:4}}>{xdfStr}</div>
                  <div style={{fontSize:10, color:"#6e6e73", marginTop:4, lineHeight:1.4}}>
                    {planResult.preDilutionNeeded
                      ? <span>= {fmtDilution(1/planResult.preDilutionFactor,dilFormat,100000)} tube pre-dil <strong>×</strong> {firstWellOnPlateLabel} in A1 combined into one value. The app uses this single number so the back-calculation is always: in-well conc × {fmtDilNum(planResult.dStart,100000)} = original sample.</span>
                      : <span>Dilution applied at A1. Back-calc: in-well conc × {fmtDilNum(planResult.dStart,100000)} = original sample.</span>}
                  </div>
                </div>
                <div style={{background:"#fff", border:"1px solid #d8dfeb", borderRadius:8, padding:"9px 10px"}}>
                  <div style={{fontSize:10, fontWeight:800, color:"#30437a", textTransform:"uppercase", letterSpacing:0.4}}>Sample — subsequent rows</div>
                  <div style={{fontSize:20, fontWeight:900, color:"#30437a", fontFamily:"monospace", marginTop:4}}>{xdsStr}</div>
                  <div style={{fontSize:10, color:"#6e6e73", marginTop:4, lineHeight:1.4}}>Additional dilution between each row. Each row after the first is another {fmtDilNum(planResult.step,100000)}× more dilute.</div>
                </div>
              </div>
            </div>;
          })()}

          {/* [Numerical table now shown by default above] */}
          {false && <details style={{marginTop:10}}>
            <summary>hidden</summary>
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
          </details>}

          {/* Optional dilution coverage table — useful for troubleshooting, hidden by default */}
          <details style={{marginTop:10}}>
            <summary style={{fontSize:11, color:"#3478F6", fontWeight:600, cursor:"pointer"}}>Optional: why each dilution is useful</summary>
            <div style={{marginTop:8, background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, overflow:"hidden"}}>
              <div style={{fontSize:11, color:"#6e6e73", lineHeight:1.5, padding:"8px 10px", borderBottom:"1px solid #eef2f7"}}>
                Use this only when troubleshooting. It shows which original-sample concentrations each well can measure without falling below or above the standard curve.
              </div>
              <table style={{width:"100%", borderCollapse:"collapse", fontSize:12}}>
                <thead>
                  <tr style={{background:"#eef3f8"}}>
                    <th style={{padding:"6px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Well</th>
                    <th style={{padding:"6px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Dilution</th>
                    <th style={{padding:"6px 10px", textAlign:"left", fontSize:10, fontWeight:700, color:"#30437a"}}>Original sample range that would read in-curve</th>
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
          </details>

          <div style={{marginTop:14, padding:"12px 14px", background:"#fff7e0", borderRadius:8, border:"1px solid #e8c77d", fontSize:12, color:"#5d4500", lineHeight:1.6}}>
            <div style={{fontWeight:800, marginBottom:4}}>Why these dilutions?</div>
            <div>Step factor: <strong>{planResult.step}×</strong>. Number of points: <strong>{planResult.nPoints}</strong>. Starting at <strong>1:{planResult.dStart}</strong>. {planResult.uncertainty==="high" ? "Because your sample's concentration is unknown, we use log-step (10×) dilutions to cover many orders of magnitude." : planResult.uncertainty==="medium" ? "Because your sample's concentration is somewhat uncertain, we use moderate steps to cover the range with redundancy." : "Because your sample's concentration is well-characterized, we use small steps (3×) for tight bracketing."} The step factor is also chosen so consecutive dilutions don't leave a gap larger than your standard curve's dynamic range.</div>
          </div>

          {/* Blank picker — visible to all */}
          {props.instructor && <BlankPicker />}

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
              {CONC_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}
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

// BenchWorkflowDiagram — clean visual guide for on-plate serial dilution.
// Design principles:
//   • No diluent arrows into wells — diluent shown as pre-filled liquid inside the well
//   • One amber arrow: sample/tube → A1 only
//   • Purple transfer arrows going straight down, label shows volume only
//   • Dilution table below the SVG (removes clutter from the graphic)
//   • No numbered badges
//   • Pre-dilution tube: two-color fill (diluent + sample layers distinct)
function BenchWorkflowDiagram(props){
  var r = props.result;
  var bench = r.benchProtocol;
  var Vf = r.workingVol;
  var Vt = r.transferVol;
  var nWells = bench.length;
  var dilFormat = props.dilFormat || "ratio";
  var setDilFormat = props.setDilFormat || function(){};

  // ── Layout ──────────────────────────────────────────────────────────────
  var W = 620;
  var rowH = 78;
  var wellR = 28;
  var preDilH = r.preDilutionNeeded ? 195 : 0;  // taller for bigger tubes
  var preDilGap = r.preDilutionNeeded ? 24 : 0;
  var topPad = 22;
  var botPad = 28;
  var H = topPad + preDilH + preDilGap + nWells * rowH + botPad;

  // X positions
  var xWell = 390;         // centre of the well column (shifted right to fit Eppendorf tube left)
  var xEppX = 52;           // Eppendorf tube centre X (no-predil case only)

  // Y of well centre i (counting from 0)
  var yWell = function(i){ return topPad + preDilH + preDilGap + i * rowH + rowH / 2; };

  var fmtVol = function(v){ return sig3(v) + " µL"; };
  var SCI_WELL  = 1000;    // tight — inside well circles
  var SCI_BADGE = 10000;   // medium — tube/arrow labels

  return <div style={{background:"#fafbfd", borderRadius:10, border:"1px solid "+BORDER, padding:"14px 14px 10px"}}>

    {/* Header row: title + format toggle */}
    <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:6, flexWrap:"wrap"}}>
      <div style={{fontSize:11, fontWeight:700, color:"#0b2a6f", textTransform:"uppercase", letterSpacing:0.5}}>How to do it at the bench</div>
      <div style={{fontSize:10, color:"#aeaeb2", display:"flex", alignItems:"baseline", gap:4}}>
        <span>show dilutions as:</span>
        <FormatPill value={dilFormat} onChange={setDilFormat}
          labelOf={function(f){return f==="ratio"?"ratio (1:N)":"factor (N×)";}}
          toggleOf={function(f){return f==="ratio"?"factor":"ratio";}}
          size={10} color="#aeaeb2" hoverColor="#0b2a6f" />
      </div>
    </div>

    {/* One-line instructions */}
    <div style={{fontSize:11, color:"#6e6e73", marginBottom:10, lineHeight:1.55}}>
      {r.preDilutionNeeded
        ? "Make the pre-dilution tube first (Step 1), then pipette into A1 and transfer straight down — one well at a time."
        : "Pre-load diluent into every well, add sample to A1, then transfer straight down — one well at a time. Mix before each transfer."}
    </div>

    {/* ── SVG ── */}
    <svg viewBox={"0 0 "+W+" "+H} width="100%" style={{display:"block"}} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="bwd-arr-samp" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,4 L0,8 z" fill="#bf7a1a" />
        </marker>
        <marker id="bwd-arr-xfer" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,4 L0,8 z" fill="#6337b9" />
        </marker>
        <marker id="bwd-arr-disc" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,4 L0,8 z" fill="#a0a8bb" />
        </marker>
      </defs>

      {/* ── PRE-DILUTION STEP (optional) ── */}
      {r.preDilutionNeeded && (function(){
        var pLabel = fmtDilution(1/r.preDilutionFactor, dilFormat, SCI_BADGE);
        var onPlateLabel = fmtDilution(1/(r.dStart/r.preDilutionFactor), dilFormat, SCI_BADGE);

        // Tube geometry — large enough to be legible
        var T1X = 38,  T1Y = topPad + 36, T1W = 68, T1H = 110;  // neat sample tube
        var T2X = 270, T2Y = topPad + 36, T2W = 68, T2H = 110;  // pre-dil tube

        // Tube outline path (closed, rounded bottom, flat top)
        var tubeOutline = function(x,y,w,h){
          var rr = 10;
          return "M "+x+" "+y
            +" L "+x+" "+(y+h-rr)
            +" Q "+x+" "+(y+h)+" "+(x+rr)+" "+(y+h)
            +" L "+(x+w-rr)+" "+(y+h)
            +" Q "+(x+w)+" "+(y+h)+" "+(x+w)+" "+(y+h-rr)
            +" L "+(x+w)+" "+y+" Z";
        };
        var tubeClipPath = function(x,y,w,h){
          var rr = 8;
          return "M "+(x+3)+" "+(y+3)
            +" L "+(x+3)+" "+(y+h-rr)
            +" Q "+(x+3)+" "+(y+h-2)+" "+(x+rr+1)+" "+(y+h-2)
            +" L "+(x+w-rr-1)+" "+(y+h-2)
            +" Q "+(x+w-3)+" "+(y+h-2)+" "+(x+w-3)+" "+(y+h-rr)
            +" L "+(x+w-3)+" "+(y+3)+" Z";
        };

        // Arrow 1: tube1 → tube2 (horizontal)
        var a1x1 = T1X+T1W+6, a1y = T1Y+T1H*0.52;
        var a1x2 = T2X-5;

        // Arrow 2: tube2 → A1 (curved down-right)
        var a2x1 = T2X+T2W+6, a2y1 = T2Y+T2H*0.50;
        var a2x2 = xWell-wellR-5, a2y2 = yWell(0);
        var cp1x = a2x1+56, cp1y = a2y1-8;
        var cp2x = a2x2-44, cp2y = a2y2-18;

        return <g>
          {/* Step 1 amber-tinted background box */}
          <rect x={12} y={topPad} width={W-24} height={preDilH}
            fill="#fff8ea" stroke="#e8c77d" strokeWidth={1} strokeDasharray="4,3" rx={7} />
          <text x={26} y={topPad+16} fontSize={10} fontWeight={800} fill="#7a5800">Step 1 — Pre-dilution in a tube ({pLabel})</text>

          {/* ── TUBE 1: neat sample ── */}
          <path d={tubeOutline(T1X,T1Y,T1W,T1H)} fill="#fffaf3" stroke="#bf7a1a" strokeWidth={1.8} />
          <clipPath id="bwd-t1clip"><path d={tubeClipPath(T1X,T1Y,T1W,T1H)} /></clipPath>
          {/* Amber fill representing neat sample */}
          <rect x={T1X+4} y={T1Y+T1H*0.22} width={T1W-8} height={T1H*0.76}
            fill="#bf7a1a" fillOpacity={0.25} clipPath="url(#bwd-t1clip)" />
          {/* Liquid surface line */}
          <ellipse cx={T1X+T1W/2} cy={T1Y+T1H*0.22} rx={T1W/2-5} ry={4}
            fill="#bf7a1a" fillOpacity={0.35} clipPath="url(#bwd-t1clip)" />
          {/* Tube opening — subtle rim, no solid cap */}
          <rect x={T1X} y={T1Y-3} width={T1W} height={4} rx={1} fill="#e8c77d" fillOpacity={0.5} />
          {/* Text labels */}
          <text x={T1X+T1W/2} y={T1Y+T1H*0.52} fontSize={10} fontWeight={800} fill="#6a3a00" textAnchor="middle">neat</text>
          <text x={T1X+T1W/2} y={T1Y+T1H*0.52+14} fontSize={10} fontWeight={800} fill="#6a3a00" textAnchor="middle">sample</text>
          <text x={T1X+T1W/2} y={T1Y-9} fontSize={9} fontWeight={800} fill="#7a5800" textAnchor="middle">① start here</text>

          {/* ── ARROW 1: curved from inside tube1 → tube2 ── */}
          {(function(){
            var cpx=(a1x1+a1x2)/2, cpy=a1y-28; // arc upward
            return <g>
              <path d={"M "+a1x1+" "+a1y+" Q "+cpx+" "+cpy+" "+a1x2+" "+a1y}
                fill="none" stroke="#bf7a1a" strokeWidth={1.6} markerEnd="url(#bwd-arr-samp)" />
              <text x={cpx} y={cpy-6} fontSize={9} fontWeight={700} fill="#7a5800" textAnchor="middle">{fmtVol(r.preDilutedSampleVol)} aliquot</text>
            </g>;
          })()}

          {/* ── TUBE 2: pre-dil tube — two-color fill ── */}
          <path d={tubeOutline(T2X,T2Y,T2W,T2H)} fill="#f9fbff" stroke="#0b2a6f" strokeWidth={1.8} />
          <clipPath id="bwd-t2clip"><path d={tubeClipPath(T2X,T2Y,T2W,T2H)} /></clipPath>
          {/* Navy diluent — lower ~65% */}
          <rect x={T2X+4} y={T2Y+T2H*0.31} width={T2W-8} height={T2H*0.67}
            fill="#0b2a6f" fillOpacity={0.18} clipPath="url(#bwd-t2clip)" />
          {/* Amber sample layer — thin band where it sits on the diluent */}
          <rect x={T2X+4} y={T2Y+T2H*0.27} width={T2W-8} height={T2H*0.07}
            fill="#bf7a1a" fillOpacity={0.55} clipPath="url(#bwd-t2clip)" />
          {/* Surface sheen on sample layer */}
          <ellipse cx={T2X+T2W/2} cy={T2Y+T2H*0.27} rx={T2W/2-5} ry={4}
            fill="#bf7a1a" fillOpacity={0.35} clipPath="url(#bwd-t2clip)" />
          {/* Tube opening rim */}
          <rect x={T2X} y={T2Y-3} width={T2W} height={4} rx={1} fill="#d8dfeb" fillOpacity={0.5} />
          {/* Volume labels outside-right to avoid crowding */}
          <text x={T2X+T2W+10} y={T2Y+T2H*0.24} fontSize={9} fontWeight={700} fill="#6a3a00">
            {fmtVol(r.preDilutedSampleVol)} sample
          </text>
          <text x={T2X+T2W+10} y={T2Y+T2H*0.56} fontSize={9} fontWeight={700} fill="#0b2a6f">
            {fmtVol(r.preDilutedDiluentVol)} diluent
          </text>
          {/* Mix label inside */}
          <text x={T2X+T2W/2} y={T2Y+T2H*0.80} fontSize={10} fontWeight={800} fill="#5a3a7a" textAnchor="middle" fontStyle="italic">mix</text>
          {/* Result label — moved right of tube to avoid collision with curved arrow to A1 */}
          <text x={T2X+T2W+10} y={T2Y+T2H+4} fontSize={10} fontWeight={800} fill="#7a5800">→ {pLabel}</text>
          <text x={T2X+T2W/2} y={T2Y-9} fontSize={9} fontWeight={800} fill="#30437a" textAnchor="middle">② pre-dil tube</text>

          {/* ── ARROW 2: curved from tube2 → A1 ── */}
          <path d={"M "+a2x1+" "+a2y1+" C "+cp1x+" "+cp1y+" "+cp2x+" "+cp2y+" "+a2x2+" "+a2y2}
            fill="none" stroke="#bf7a1a" strokeWidth={1.6} markerEnd="url(#bwd-arr-samp)" />
          {(function(){
            var t=0.5, m=1-t;
            var lx=m*m*m*a2x1+3*m*m*t*cp1x+3*m*t*t*cp2x+t*t*t*a2x2;
            var ly=m*m*m*a2y1+3*m*m*t*cp1y+3*m*t*t*cp2y+t*t*t*a2y2;
            return <g>
              <rect x={lx-62} y={ly+6} width={124} height={17} rx={8} fill="#fff8ea" />
              <text x={lx} y={ly+19} fontSize={9} fontWeight={700} fill="#7a5800" textAnchor="middle">③ {fmtVol(bench[0].sampleVol)} aliquot → A1</text>
            </g>;
          })()}
        </g>;
      })()}

      {/* ── PLATE COLUMN ── */}
      {/* Step label */}
      <text x={xWell} y={topPad + preDilH + preDilGap - 6} fontSize={10} fontWeight={800} fill="#0b2a6f" textAnchor="middle">
        {r.preDilutionNeeded ? "Step 2" : "Step 1"} — serial dilution down column 1  (bold blue number inside each well = diluent pre-loaded)
      </text>

      {/* ── Eppendorf tube (no-predilution case only, drawn once, aligned with A1) ── */}
      {!r.preDilutionNeeded && (function(){
        var cy0 = yWell(0);
        var ex = xEppX, ey = cy0 - 52, ew = 34, eh = 68;
        // Eppendorf-style microcentrifuge tube: conical bottom, straight sides, small open top
        var body = "M "+(ex)+" "+ey
          +" L "+(ex)+" "+(ey+eh*0.62)
          +" L "+(ex+ew/2)+" "+(ey+eh)
          +" L "+(ex+ew)+" "+(ey+eh*0.62)
          +" L "+(ex+ew)+" "+ey+" Z";
        var fill = "M "+(ex+3)+" "+(ey+3)
          +" L "+(ex+3)+" "+(ey+eh*0.58)
          +" L "+(ex+ew/2)+" "+(ey+eh-3)
          +" L "+(ex+ew-3)+" "+(ey+eh*0.58)
          +" L "+(ex+ew-3)+" "+(ey+3)+" Z";
        // Hinge / lid at top
        var lidY = ey - 6;
        return <g>
          <path d={body} fill="#fffaf3" stroke="#bf7a1a" strokeWidth={1.6} />
          <path d={fill} fill="#bf7a1a" fillOpacity={0.25} />
          {/* Liquid surface */}
          <line x1={ex+3} y1={ey+12} x2={ex+ew-3} y2={ey+12} stroke="#bf7a1a" strokeOpacity={0.4} strokeWidth={1} />
          {/* Open-top cap suggestion — small rect */}
          <rect x={ex+4} y={lidY} width={ew-8} height={8} rx={2} fill="#e8c77d" />
          {/* Label */}
          <text x={ex+ew/2} y={ey-12} fontSize={9} fontWeight={800} fill="#7a5000" textAnchor="middle">neat sample</text>
          {/* Arrow: curved from inside tube → A1 well */}
          {(function(){
            var ax1 = ex+ew+4, ay1 = ey+eh*0.30;
            var ax2 = xWell-wellR-4, ay2 = cy0;
            var cpx1 = ax1+40, cpy1 = ay1-14;
            var cpx2 = ax2-20, cpy2 = ay2-14;
            return <g>
              <path d={"M "+ax1+" "+ay1+" C "+cpx1+" "+cpy1+" "+cpx2+" "+cpy2+" "+ax2+" "+ay2}
                fill="none" stroke="#bf7a1a" strokeWidth={1.6} markerEnd="url(#bwd-arr-samp)" />
              <text x={(ax1+ax2)/2} y={ay1-18} fontSize={9} fontWeight={700} fill="#7a5000" textAnchor="middle">
                {fmtVol(bench[0].sampleVol)} → A1
              </text>
            </g>;
          })()}
        </g>;
      })()}

      {bench.map(function(b, i){
        var cy = yWell(i);
        var nextY = i < nWells - 1 ? yWell(i + 1) : null;
        var dv = b.isFirst ? b.diluentVol : b.preload; // diluent volume pre-loaded in this well

        // Liquid fill — use SVG arc path to perfectly follow the well circle, no clipping needed
        var fillFrac = dv > 0 ? Math.min(dv / Vf, 0.92) : 0;
        var fillH = fillFrac * (wellR * 1.7);
        var fillY = cy + wellR - fillH;

        return <g key={i}>
          {/* Well base fill (light) */}
          <circle cx={xWell} cy={cy} r={wellR} fill="#f7fbff" stroke="#0b2a6f" strokeWidth={1.5} />
          {/* Diluent fill: SVG arc path that perfectly follows the circle — no rectangular corners */}
          {fillFrac > 0.05 && (function(){
            var dfc = cy + wellR - fillY; // distance from circle centre to top of fill
            // clamp so arcHW never exceeds radius
            var arcHW = Math.sqrt(Math.max(0, (wellR-0.5)*(wellR-0.5) - (wellR - dfc)*(wellR - dfc)));
            // arc path: move to left edge of chord, arc clockwise to right edge, then down along inside of circle back to bottom
            var lx = xWell - arcHW, rx = xWell + arcHW;
            // We use two arcs: top arc (the chord surface, flat-ish) drawn as a straight line + bottom arc
            var path = "M "+lx+" "+fillY
              +" A "+(wellR-0.5)+" "+(wellR-0.5)+" 0 "+(fillH > wellR ? "1" : "0")+" 1 "+rx+" "+fillY
              +" A "+(wellR-0.5)+" "+(wellR-0.5)+" 0 1 1 "+lx+" "+fillY+" Z";
            return <g>
              <path d={path} fill="#0b2a6f" fillOpacity={0.13} />
              {/* Surface sheen — ellipse at the top of the liquid */}
              <ellipse cx={xWell} cy={fillY} rx={arcHW*0.80} ry={3} fill="#0b2a6f" fillOpacity={0.20} />
            </g>;
          })()}
          {/* Well border on top of fill */}
          <circle cx={xWell} cy={cy} r={wellR} fill="none" stroke="#0b2a6f" strokeWidth={1.5} />

          {/* Well letter above */}
          <text x={xWell} y={cy - wellR - 7} fontSize={10} fontWeight={800} fill="#30437a" textAnchor="middle">{b.wellLabel}</text>

          {/* Diluent volume INSIDE the well, bold, near bottom */}
          {dv > 0 && <text x={xWell} y={cy + 5} fontSize={8} fontWeight={800} fill="#0b2a6f" textAnchor="middle">{sig3(dv)} µL</text>}

          {/* Transfer arrow straight down — label left of arrow to avoid overlap with diluent label on right */}
          {nextY != null && <g>
            <line x1={xWell} y1={cy+wellR+2} x2={xWell} y2={nextY-wellR-5} stroke="#6337b9" strokeWidth={1.7} markerEnd="url(#bwd-arr-xfer)" />
            <text x={xWell - wellR - 8} y={(cy+nextY)/2+4} fontSize={9} fontWeight={700} fill="#6337b9" textAnchor="end">transfer {fmtVol(Vt)}</text>
          </g>}

          {/* Last well: discard stub to right */}
          {nextY == null && <g>
            <line x1={xWell+wellR+2} y1={cy} x2={xWell+wellR+40} y2={cy} stroke="#a0a8bb" strokeWidth={1.2} strokeDasharray="3,2" markerEnd="url(#bwd-arr-disc)" />
            <text x={xWell+wellR+46} y={cy-4} fontSize={8} fill="#a0a8bb">discard {fmtVol(Vt)}</text>
            <text x={xWell+wellR+46} y={cy+8} fontSize={8} fontWeight={700} fill="#1a6b32">✓ all wells {Vf} µL</text>
          </g>}
        </g>;
      })}
    </svg>

    {/* Dilution reference table — below the SVG, clean grid */}
    <div style={{marginTop:10}}>
      <div style={{fontSize:10, fontWeight:700, color:"#0b2a6f", marginBottom:6, textTransform:"uppercase", letterSpacing:0.4}}>Dilution at each well</div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(66px,1fr))", gap:5}}>
        {bench.map(function(b){
          return <div key={b.wellLabel} style={{border:"1px solid #e5eaf3", borderRadius:8, background:"#fff", padding:"5px 6px", textAlign:"center"}}>
            <div style={{fontSize:10, fontWeight:800, color:"#30437a"}}>{b.wellLabel}</div>
            <div style={{fontSize:11, fontWeight:800, color:"#6337b9", fontFamily:"monospace", marginTop:2}}>{fmtDilution(1/b.dilution, dilFormat, 100000)}</div>
          </div>;
        })}
      </div>
    </div>

    {/* Footer */}
    <div style={{fontSize:10, color:"#6e6e73", marginTop:8, fontStyle:"italic", lineHeight:1.5, padding:"6px 10px", background:"#f4f4f6", borderRadius:6}}>
      Each well ends at <strong>{Vf} µL</strong>. Transfer between wells = <strong>{sig3(Vt)} µL</strong>. Run replicate columns independently, or pre-load all diluent with a multichannel first.
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


// ─────────────────────────────────────────────────────────────────────────────
// System Suitability card — shared component, mounted on BOTH Results and
// Recommendations tabs (Option α architecture: one source, two view sites).
//
// Computes, per plate:
//   • Standard-curve goodness:  R² (informational only — ICH M10 doesn't pin a numeric threshold)
//   • Back-fit accuracy:         For each standard, run its corrected absorbance through the
//                                inverse fit (iFn) to get back-calculated concentration, then
//                                accuracy = backFit / nominal × 100. ICH M10 wants ≥75% of
//                                standards within 80–120% (within 75–125% at LLOQ).
//   • Standard precision:        CV across replicates per standard (already in dbS[i].cv).
//                                ICH M10: ≤15%, ≤20% at LLOQ.
//   • LLOQ identification:       The lowest-concentration standard is treated as LLOQ for
//                                wider-window evaluation.
//
// In instructor mode, also surfaces:
//   • Cross-plate precision:     CV of corrected absorbance for each standard level, computed
//                                ACROSS plates (not within). This is plate-to-plate
//                                reproducibility — distinct from the within-plate replicate CV
//                                which is intra-plate (instrument + pipetting noise).
//
// Pass/fail logic for the overall pill:
//   • PASS:    every plate's back-fit ≥75% in window AND every plate's precision OK (LLOQ exempted properly).
//   • FAIL:    any plate fails outright (≥2 standards out of acceptance, or LLOQ out + CV exceeded).
//   • REVIEW:  borderline (some standards out of band but ≥75% still in spec) — analyst decides.
//
// We deliberately do NOT block reporting on SST failure (the analyst tab persona may still need
// to see the data); the panel is informational and prominent.
// ─────────────────────────────────────────────────────────────────────────────
// Compute the de-facto LLOQ per plate. The de-facto LLOQ is the lowest standard concentration
// that PASSES back-fit accuracy (within ±20%). Standards below it are unreliable, so any sample
// whose reported concentration falls below this threshold should be flagged BLOQ.
// Returns {plateIdx: lloqValue_in_base_unit | null}. null means: no failures, or no passing standards
// (in which case there's no meaningful de-facto LLOQ to enforce).
function computeDeFactoLLOQ(res) {
  var out = {};
  if (!res || !res.length) return out;
  res.forEach(function(p, pi){
    if (!p.iFn || !p.dbS) { out[pi] = null; return; }
    // Build per-standard accuracy
    var stds = p.dbS.map(function(d){
      if (d.conc === 0 || d.avg == null || d.conc == null) return null;
      var bf = p.iFn(d.avg);
      if (bf == null || !isFinite(bf) || bf <= 0) return {conc: d.conc, pass: null};
      var acc = (bf / d.conc) * 100;
      return { conc: d.conc, accuracy: acc, pass: (acc >= 80 && acc <= 120) };
    }).filter(function(s){return s != null;});
    if (stds.length === 0) { out[pi] = null; return; }
    var anyFail = stds.some(function(s){return s.pass === false;});
    if (!anyFail) { out[pi] = null; return; }   // all passing — no de-facto LLOQ shift
    // Among passing standards, the lowest concentration is the de-facto LLOQ.
    var passing = stds.filter(function(s){return s.pass === true;}).sort(function(a,b){return a.conc - b.conc;});
    out[pi] = passing.length > 0 ? passing[0].conc : null;
  });
  return out;
}

// Detect samples whose name suggests they are SST (System Suitability) samples,
// PLUS any samples explicitly flagged by the user via the SST picker (props.sstFlags).
// Pattern matching covers many variants: "SST", "SST-mid", "Sys Suit", "system_suit",
// "System Suitability", "suitability_low", "syssuit", "sst sample", "QC/SST", etc.
// Returns {plateIdx, sampleIdx, name, key, source} where source is "auto" (name match) or "manual" (flag).
function detectSSTSamples(res, sstFlags) {
  var matches = [];
  if (!res || !res.length) return matches;
  var flags = sstFlags || {};
  var patterns = [
    /(^|[^a-z])sst([^a-z]|$)/i,                  // "sst" as a token boundary
    /sys[\s_-]*suit/i,                            // "syssuit", "sys suit", "sys_suit", "sys-suit"
    /system[\s_-]*suit/i,                         // "system suit", "systemsuit", etc.
    /suitab/i                                     // "suitability", "suitable", "suitab" prefix
  ];
  res.forEach(function(p, pi){
    (p.samps || []).forEach(function(s, si){
      var nm = s.name || "";
      var key = pi+"-"+si;
      var nameHit = patterns.some(function(pat){return pat.test(nm);});
      var flagHit = flags[key] === true || flags[key] === "true";
      if (nameHit || flagHit) {
        matches.push({
          plateIdx: pi, sampleIdx: si, name: nm, key: key,
          source: nameHit ? "auto" : "manual"
        });
      }
    });
  });
  return matches;
}

function SystemSuitabilityCard(props) {
  // sstAcknowledgement: null = user hasn't responded yet, "has-ssts" = user said "yes I have SSTs",
  // "no-ssts" = user said "no, this run has none". Lets us hide the prompt once dismissed.
  var _ack = useState(null), sstAck = _ack[0], setSstAck = _ack[1];
  var res = props.res;
  if (!res || !res.length) return null;
  var unit = props.unit;
  var displayUnit = props.displayUnit || unit;
  var instructor = !!props.instructor;
  var stdDisplayName = props.stdDisplayName || function(pi){return "Standard (P"+(pi+1)+")";};
  // SST sample inputs: parent (App) passes the parsed sstExpected dict + a setter callback.
  // sstExpected is a {key: value-string-in-unit} map. value is stored as a STRING (raw text input)
  // so the user can type freely; we parseFloat at compute time.
  var sstExpected = props.sstExpected || {};
  var setSSTExpected = props.setSSTExpected || function(){};
  // sstFlags: manual SST designations. Lets the user mark any sample as SST via dropdown picker.
  var sstFlags = props.sstFlags || {};
  var toggleSSTFlag = props.toggleSSTFlag || function(){};
  // Per-sample analyst pick lookup — comes from buildSummaryRows so the card sees what the analyst is reporting.
  // analystPickFor: function(plateIdx, sampleIdx) => {conc, dil, cv} or null
  var analystPickFor = props.analystPickFor || function(){return null;};

  // ── PART A: SST SAMPLES ─────────────────────────────────────────────────
  // Detect samples by name OR manual flag; for each, read the analyst's reported concentration; compare to expected.
  var sstSamples = detectSSTSamples(res, sstFlags);
  var sstRows = sstSamples.map(function(m){
    var pick = analystPickFor(m.plateIdx, m.sampleIdx);
    var observed = pick && pick.conc != null ? pick.conc : null;  // in base `unit`
    // Storage convention (v5bg+): sstExpected[key] holds the RAW USER-TYPED STRING in the
    // displayUnit at the moment they typed it. We do NOT auto-convert on unit toggles, so the
    // input value round-trips exactly with what the user sees (and backspace works normally).
    // For accuracy compute: parse the stored string as a number (assumed to be in displayUnit),
    // convert to base unit, then divide observed/expected.
    var expectedRaw = sstExpected[m.key];
    var expectedDispVal = (expectedRaw!=null && expectedRaw !== "") ? parseFloat(expectedRaw) : null;
    if (expectedDispVal != null && (!isFinite(expectedDispVal) || expectedDispVal <= 0)) expectedDispVal = null;
    // Convert from displayUnit to base unit for accuracy compute
    var expectedBase = expectedDispVal != null ? convertConc(expectedDispVal, displayUnit, unit) : null;
    var accuracy = (observed != null && expectedBase != null) ? (observed / expectedBase) * 100 : null;
    // ICH M10 QC sample acceptance: 80–120% (no special LLOQ window for QCs at this level).
    var pass = accuracy != null ? (accuracy >= 80 && accuracy <= 120) : null;
    return {
      key: m.key,
      plateIdx: m.plateIdx,
      sampleIdx: m.sampleIdx,
      name: m.name,
      source: m.source,    // "auto" (name-matched) or "manual" (flagged via picker)
      observed: observed,
      expectedBase: expectedBase,        // numeric, base unit, used for compute (may be null)
      expectedRaw: expectedRaw || "",    // raw string the user typed, in displayUnit
      accuracy: accuracy,
      pass: pass,
      hasExpected: expectedBase != null,
      dil: pick && pick.dil != null ? pick.dil : null
    };
  });
  // SST overall status for the panel banner
  var sstEvaluable = sstRows.filter(function(r){return r.accuracy!=null;});
  var sstPassing = sstEvaluable.filter(function(r){return r.pass;}).length;
  var sstStatus;
  if (sstSamples.length === 0) sstStatus = "no-data";
  else if (sstEvaluable.length === 0) sstStatus = "missing-expected";
  else if (sstPassing === sstEvaluable.length) sstStatus = "pass";
  else if (sstPassing === 0) sstStatus = "fail";
  else sstStatus = "review";

  // ── PART B: CALIBRATOR QUALITY (standard back-fit) ─────────────────────
  var plateSST = res.map(function(p, pi) {
    var standards = (p.dbS || []).map(function(d, idx) {
      var nominal = d.conc;
      var measured = d.avg;       // already blank-corrected
      var cv = d.cv;               // intra-plate replicate CV (fraction)
      var backFit = null, accuracy = null;
      if (p.iFn && measured != null && nominal != null && nominal > 0) {
        backFit = p.iFn(measured);
        if (backFit != null && isFinite(backFit) && backFit > 0) {
          accuracy = (backFit / nominal) * 100;
        }
      }
      return { idx: idx, nominal: nominal, measured: measured, backFit: backFit, accuracy: accuracy, cv: cv };
    });
    var nonZero = standards.filter(function(s){return s.nominal>0;});
    var lloqIdx = -1;
    if (nonZero.length) {
      var minConc = Math.min.apply(null, nonZero.map(function(s){return s.nominal;}));
      lloqIdx = standards.findIndex(function(s){return s.nominal===minConc;});
    }
    standards.forEach(function(s, idx){
      var isLLOQ = (idx === lloqIdx);
      var accLo = isLLOQ ? 75 : 80;
      var accHi = isLLOQ ? 125 : 120;
      var cvLim = isLLOQ ? 0.20 : 0.15;
      s.isLLOQ = isLLOQ;
      s.accPass = (s.accuracy != null) && (s.accuracy >= accLo && s.accuracy <= accHi);
      s.cvPass = (s.cv != null) && (s.cv <= cvLim);
      s.evaluable = (s.accuracy != null);
      s.overallPass = s.evaluable ? (s.accPass && s.cvPass) : null;
    });
    var evaluable = standards.filter(function(s){return s.evaluable;});
    var passing = evaluable.filter(function(s){return s.overallPass;}).length;
    var total = evaluable.length;
    var passRate = total>0 ? passing/total : null;
    var plateStatus = passRate==null ? "no-data"
      : (passRate >= 0.75 ? "pass"
         : (passRate >= 0.5 ? "review" : "fail"));
    return {
      pi: pi, label: stdDisplayName(pi),
      r2: p.sc.r2, model: p.sc.model,
      standards: standards, lloqIdx: lloqIdx,
      passing: passing, total: total, passRate: passRate, status: plateStatus
    };
  });
  var anyFail = plateSST.some(function(p){return p.status==="fail";});
  var anyReview = plateSST.some(function(p){return p.status==="review";});
  var allPass = plateSST.every(function(p){return p.status==="pass";});
  var calStatus = anyFail ? "fail" : (anyReview ? "review" : (allPass ? "pass" : "no-data"));

  // Cross-plate precision (instructor + multi-plate): for each standard level, CV of corrected absorbance ACROSS plates.
  var crossPlate = null;
  if (instructor && res.length >= 2) {
    var n = (res[0].dbS || []).length;
    crossPlate = [];
    for (var i = 0; i < n; i++) {
      var nominal = (res[0].dbS && res[0].dbS[i]) ? res[0].dbS[i].conc : null;
      var avgs = res.map(function(p){
        var d = p.dbS && p.dbS[i];
        return d ? d.avg : null;
      }).filter(function(v){return v!=null && isFinite(v);});
      if (avgs.length < 2) continue;
      var mean = avgs.reduce(function(a,b){return a+b;},0) / avgs.length;
      var variance = avgs.reduce(function(a,b){return a+(b-mean)*(b-mean);},0) / (avgs.length - 1);
      var sd = Math.sqrt(variance);
      var cv = mean > 0 ? sd/mean : null;
      crossPlate.push({ idx: i, nominal: nominal, n: avgs.length, mean: mean, sd: sd, cv: cv });
    }
  }

  // ── OVERALL STATUS for the top banner ───────────────────────────────────
  // If SST samples exist, they take precedence (they're the primary suitability check).
  // If no SST samples, fall back to calibrator-quality status.
  var overallStatus;
  if (sstStatus === "pass" || sstStatus === "fail" || sstStatus === "review") {
    overallStatus = sstStatus;
  } else if (sstStatus === "missing-expected") {
    overallStatus = "review";
  } else {
    overallStatus = calStatus;
  }

  // Disagreement nuance: SST passes but calibrator fails (or vice versa). Worth surfacing because the
  // SST is the regulatory acceptance criterion (it's the "QC sample" in ICH M10 terms), but calibrator
  // failures still indicate the curve has problem spots — even if your SST happens to land at a clean point.
  var sstVsCalDisagreement = null;
  if (sstStatus === "pass" && (calStatus === "fail" || calStatus === "review")) {
    sstVsCalDisagreement = "sst-pass-cal-fail";
  } else if (sstStatus === "fail" && calStatus === "pass") {
    sstVsCalDisagreement = "sst-fail-cal-pass";
  }
  // Detect whether calibrator failures are clustered at the low end of the curve.
  // If they are, the de facto LLOQ has effectively risen and low-conc sample reports should be flagged.
  // Heuristic: among non-blank standards, sort by nominal concentration ascending; if all failing standards
  // are in the lowest third (and at least one fails), call out the low-end clustering.
  var lowEndCluster = (function(){
    var hits = [];
    plateSST.forEach(function(plate){
      var nonBlank = plate.standards.filter(function(s){return s.nominal>0 && s.evaluable;});
      if (nonBlank.length < 3) return;  // not enough points to assess clustering
      var sorted = nonBlank.slice().sort(function(a,b){return a.nominal - b.nominal;});
      var bottomThirdN = Math.max(1, Math.ceil(sorted.length / 3));
      var bottomThird = sorted.slice(0, bottomThirdN);
      var bottomThirdIds = bottomThird.map(function(s){return s.idx;});
      var failing = nonBlank.filter(function(s){return s.overallPass===false;});
      if (failing.length === 0) return;
      var allFailingInBottom = failing.every(function(s){return bottomThirdIds.indexOf(s.idx) !== -1;});
      if (allFailingInBottom) {
        var lowestPassing = sorted.find(function(s){return s.overallPass===true;});
        hits.push({
          plateLabel: plate.label,
          deFactoLLOQ: lowestPassing ? lowestPassing.nominal : null,
          failingNominals: failing.map(function(s){return s.nominal;}).sort(function(a,b){return a-b;})
        });
      }
    });
    return hits.length > 0 ? hits : null;
  })();

  var statusColor = {
    pass:   { bg: "linear-gradient(180deg,#e8f5ea,#d6eedf)", border: "#8fc4a1", text: "#1b5a4d", iconColor: "#1b7f6a", icon: "✓", label: "PASS" },
    fail:   { bg: "linear-gradient(180deg,#ffeaed,#fcdce0)", border: "#d98a8f", text: "#7a2620", iconColor: "#b4332e", icon: "✗", label: "FAIL" },
    review: { bg: "linear-gradient(180deg,#fff6e8,#fbe9cd)", border: "#d4a76a", text: "#5a3e00", iconColor: "#9a6a00", icon: "⚠", label: "REVIEW" },
    "no-data": { bg: "linear-gradient(180deg,#f4f7fb,#eaeef5)", border: "#c9d3e3", text: "#5a6984", iconColor: "#6e6e73", icon: "○", label: "NO DATA" }
  };
  var sc2 = statusColor[overallStatus];

  // LLOQ tooltip text — explains the term and the wider acceptance windows
  var lloqTooltip = "LLOQ = Lower Limit of Quantitation: the lowest concentration at which the assay can quantitate with acceptable accuracy and precision. ICH M10 allows wider acceptance at LLOQ (accuracy 75–125%, CV ≤20%) because measurement noise is intrinsically larger near the bottom of the curve.";

  // The whole card is wrapped in a <details> so the user can collapse/expand it.
  // Collapsed by default per user preference — opens on click to show full details.
  return <details style={{marginBottom:"1.25rem",padding:0,borderRadius:14,background:sc2.bg,border:"1px solid "+sc2.border,overflow:"hidden"}}>
    <summary style={{cursor:"pointer",userSelect:"none",padding:"16px 18px",listStyle:"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <span style={{fontSize:22,fontWeight:800,color:sc2.iconColor}}>{sc2.icon}</span>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:14,fontWeight:800,color:sc2.text}}>System Suitability & Standard Curve Quality</div>
          {sstSamples.length>0 && <div style={{fontSize:12,color:"#5a6984",marginTop:2}}>
            {sstSamples.length} SST sample{sstSamples.length===1?"":"s"} · {sstStatus==="pass"?"PASS":sstStatus==="fail"?"FAIL":sstStatus==="review"?(sstPassing+"/"+sstEvaluable.length+" pass"):"—"}
          </div>}
        </div>
        <span style={{fontSize:11,color:sc2.text,fontWeight:600,opacity:0.7,marginLeft:"auto"}}>▾ click to expand</span>
      </div>
    </summary>

    <div style={{padding:"0 18px 16px"}}>

    {/* Nuance callouts: SST/calibrator disagreement + low-end calibrator clustering. Instructor-mode only. */}
    {instructor && sstVsCalDisagreement === "sst-pass-cal-fail" && <div style={{marginTop:0,padding:"10px 12px",background:"rgba(99,55,185,0.08)",border:"1px solid #d8c8f5",borderRadius:8,marginBottom:12,fontSize:11,color:"#3a2470",lineHeight:1.55}}>
      <strong>SST passed, but standard curve quality failed.</strong> The SST sample is the regulatory acceptance criterion (ICH M10 treats it as the "QC sample" — an independent known traveling through the workflow), so the run is reportable. <strong>However</strong>, standard back-fit failures mean the curve has problem spots. If your SST happens to sit at a concentration where the curve fits well, you got lucky — sample concentrations near the failing standards' levels should still be reviewed carefully. Position matters: an SST at 1 mg/mL doesn't prove the curve is trustworthy at 0.01 mg/mL.
    </div>}
    {instructor && sstVsCalDisagreement === "sst-fail-cal-pass" && <div style={{marginTop:0,padding:"10px 12px",background:"rgba(180,51,46,0.07)",border:"1px solid rgba(180,51,46,0.25)",borderRadius:8,marginBottom:12,fontSize:11,color:"#7a2620",lineHeight:1.55}}>
      <strong>Standard curve quality passed, but SST failed.</strong> This is the more serious case: the curve <em>looks</em> well-fit, but an independent known concentration didn't recover correctly. That points to a workflow problem — matrix interference, dilution error, stock concentration error, or a parallelism issue between the SST and the standards. Investigate before reporting; the curve being well-fit does not validate the workflow if the SST disagrees.
    </div>}
    {instructor && lowEndCluster && <div style={{marginTop:0,padding:"10px 12px",background:"rgba(154,106,0,0.07)",border:"1px solid #d4a76a",borderRadius:8,marginBottom:12,fontSize:11,color:"#5a3e00",lineHeight:1.55}}>
      <strong>Low-end calibrator failures clustered.</strong> {lowEndCluster.length===1?"On "+lowEndCluster[0].plateLabel+", calibrator":"Calibrator"} failures are concentrated at the lowest standards. The de facto LLOQ has effectively risen{lowEndCluster.length===1 && lowEndCluster[0].deFactoLLOQ!=null?" to roughly "+sig3(convertConc(lowEndCluster[0].deFactoLLOQ, unit, displayUnit))+" "+displayUnit:""}. Sample concentrations reported below the lowest passing standard should be flagged BLOQ (below limit of quantitation) or noted as semi-quantitative. The high end of the curve is still trustworthy.
    </div>}

    {/* ── SST samples panel (PRIMARY) ─────────────────────────────────── */}
    <div style={{marginTop:0,padding:"12px 14px",background:"rgba(255,255,255,0.7)",border:"1px solid "+sc2.border,borderRadius:10,marginBottom:14}}>
      <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:6,flexWrap:"wrap"}}>
        <span style={{fontSize:13,fontWeight:800,color:"#0b2a6f"}}>SST samples</span>
        <span style={{fontSize:11,color:"#5a6984",fontStyle:"italic"}}>Auto-detected by name (SST / Sys Suit / Suitability)</span>
      </div>
      {/* No-SST flow: ask the user first whether this run has SSTs.
          - sstSamples.length > 0 → skip the prompt entirely, go straight to the table.
          - sstSamples.length === 0 AND sstAck === null → show prompt with Yes / No buttons.
          - sstAck === "no-ssts" → show a tiny dismissed state with a "show options" link.
          - sstAck === "has-ssts" → show the picker dropdown so user can flag a sample manually. */}
      {sstSamples.length === 0 && sstAck === null && (function(){
        // Build pickable list to show in count
        var pickable = [];
        res.forEach(function(p, pi){(p.samps||[]).forEach(function(s, si){pickable.push({pi:pi, si:si});});});
        return <div style={{padding:"12px 14px",background:"#f9fafc",border:"1px solid #d8dfeb",borderRadius:8,marginBottom:8}}>
          <div style={{fontSize:12,color:"#30437a",fontWeight:700,marginBottom:6}}>No SST samples detected.</div>
          <div style={{fontSize:11,color:"#5a6984",lineHeight:1.5,marginBottom:10}}>Did this run include a system-suitability sample (a known concentration used to verify the assay)?</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={function(){setSstAck("has-ssts");}} style={{padding:"6px 14px",background:"#0b2a6f",color:"#fff",border:"none",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer"}}>Yes — let me mark one</button>
            <button onClick={function(){setSstAck("no-ssts");}} style={{padding:"6px 14px",background:"#fff",color:"#5a6984",border:"1px solid #d8dfeb",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer"}}>No — skip SST review</button>
          </div>
        </div>;
      })()}
      {sstSamples.length === 0 && sstAck === "no-ssts" && <div style={{padding:"6px 10px",background:"#fafafa",border:"1px dashed #d0d8ea",borderRadius:6,fontSize:11,color:"#5a6984",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <span>SST review skipped for this run.</span>
        <button onClick={function(){setSstAck("has-ssts");}} style={{background:"transparent",border:"none",color:"#0b2a6f",fontSize:11,cursor:"pointer",fontWeight:600,textDecoration:"underline"}}>Mark a sample anyway</button>
      </div>}
      {/* SST picker — shown when (a) user said "has-ssts", or (b) some SSTs are already flagged. */}
      {(sstSamples.length > 0 || sstAck === "has-ssts") && (function(){
        // Build list of all (plateIdx, sampleIdx) pairs that are NOT already in sstSamples.
        var alreadySSTKeys = sstSamples.reduce(function(acc, s){acc[s.key]=true;return acc;}, {});
        var pickable = [];
        res.forEach(function(p, pi){
          (p.samps || []).forEach(function(s, si){
            var key = pi+"-"+si;
            if (!alreadySSTKeys[key]) pickable.push({key:key, pi:pi, si:si, name:s.name});
          });
        });
        if (pickable.length === 0 && sstSamples.length > 0) return null;
        return <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"6px 10px",background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:8,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:700,color:"#30437a"}}>{sstSamples.length>0 ? "Mark another:" : "Mark as SST:"}</span>
          <select onChange={function(e){
            var v = e.target.value;
            if (!v) return;
            toggleSSTFlag(v, true);
            e.target.value = "";  // reset for next pick
          }} value="" style={{padding:"5px 9px",borderRadius:6,border:"1px solid #d8dfeb",fontSize:11,background:"#fff",fontWeight:600,color:"#30437a",cursor:"pointer",minWidth:200}}>
            <option value="">— choose a sample to add —</option>
            {res.length>1
              ? res.map(function(p, pi){
                  var avail = pickable.filter(function(x){return x.pi===pi;});
                  if (avail.length===0) return null;
                  return <optgroup key={pi} label={"Plate "+(pi+1)}>
                    {avail.map(function(x){return <option key={x.key} value={x.key}>{x.name}</option>;})}
                  </optgroup>;
                })
              : pickable.map(function(x){return <option key={x.key} value={x.key}>{x.name}</option>;})
            }
          </select>
          <span style={{flex:1}}></span>
          <span style={{fontSize:10,color:"#8e9bb5",fontStyle:"italic"}}>{pickable.length} sample{pickable.length===1?"":"s"} available</span>
        </div>;
      })()}
      {sstSamples.length > 0 && <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
          <thead><tr>
            {res.length>1 && <th style={{...thS,textAlign:"center",fontSize:10}}>Plate</th>}
            <th style={{...thS,textAlign:"center",fontSize:10}}>Sample</th>
            <th style={{...thS,textAlign:"center",fontSize:10,lineHeight:1.3}}><div>Expected</div><div style={{fontWeight:500,fontSize:9,color:"#8e9bb5"}}>(in {displayUnit})</div></th>
            <th style={{...thS,textAlign:"center",fontSize:10,lineHeight:1.3}}><div>Observed</div><div style={{fontWeight:500,fontSize:9,color:"#8e9bb5"}}>(in {displayUnit})</div></th>
            <th style={{...thS,textAlign:"center",fontSize:10,lineHeight:1.3}}><div>Accuracy</div><div style={{fontWeight:500,fontSize:9,color:"#8e9bb5"}}>(target 80–120%)</div></th>
            <th style={{...thS,textAlign:"center",fontSize:10}}>Pass?</th>
          </tr></thead>
          <tbody>
            {sstRows.map(function(r){
              // Display behavior (v5bg+): show the raw stored string EXACTLY.
              // Storage convention: the stored string is what the user typed, in the displayUnit
              // active when they typed it. We do NOT auto-convert when displayUnit toggles, because:
              //   (a) doing so silently changes a number the user intentionally entered
               //   (b) the previous attempt at auto-conversion broke backspace and round-trip-formatting
               // If the user toggles displayUnit, the input still shows their original number —
               // they can re-type if they want to express it in the new unit.
              var expectedDisp = r.expectedRaw;
              var observedDisp = r.observed != null ? convertConc(r.observed, unit, displayUnit) : null;
              var accColor = r.accuracy==null ? "#aeaeb2" : (r.pass ? "#1b7f6a" : "#b4332e");
              var rowBg = r.pass===false ? "rgba(180,51,46,0.06)" : (r.pass===true ? "rgba(27,127,106,0.05)" : "transparent");
              return <tr key={r.key} style={{background:rowBg}}>
                {res.length>1 && <td style={{...tdS,fontSize:11}}>{r.plateIdx+1}</td>}
                <td style={{...tdS,fontSize:11,fontWeight:700}}>
                  {r.name}
                  {r.source==="manual" && <span title="Manually flagged via the dropdown above. Click × to unflag." style={{fontSize:9,fontWeight:700,color:"#3478F6",marginLeft:6,padding:"1px 5px",background:"#e8f1ff",borderRadius:4,cursor:"help"}}>manual</span>}
                  {r.source==="auto" && <span title="Auto-detected from sample name (matches SST / Sys Suit / Suitability)" style={{fontSize:9,fontWeight:600,color:"#8e9bb5",marginLeft:6,padding:"1px 5px",background:"#f4f7fb",borderRadius:4,cursor:"help"}}>auto</span>}
                  {r.dil!=null && <span style={{fontSize:9,color:"#aeaeb2",fontStyle:"italic",marginLeft:6,fontWeight:500}}>at {r.dil}</span>}
                  {r.source==="manual" && <button onClick={function(){toggleSSTFlag(r.key, false);}} title="Remove this sample from SST list" style={{marginLeft:6,padding:"0 5px",fontSize:11,fontWeight:700,color:"#b4332e",background:"transparent",border:"none",cursor:"pointer",lineHeight:1}}>×</button>}
                </td>
                <td style={{...tdS,textAlign:"center",fontSize:11}}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="—"
                    value={expectedDisp}
                    onChange={function(e){
                      // Store EXACTLY what the user typed, in the current displayUnit. No conversion,
                      // no parse-and-restringify. Backspace, partial input, "0.", "0.5" all work because
                      // the input value round-trips identically with what's in storage.
                      // Compute layer parses + converts at accuracy-compute time, treating the stored
                      // string as a value in displayUnit.
                      setSSTExpected(r.key, e.target.value);
                    }}
                    style={{width:90,padding:"4px 8px",borderRadius:6,border:"1px solid #d8dfeb",fontSize:11,textAlign:"right",fontFamily:"inherit",background:"#fff"}}
                  />
                </td>
                <td style={{...tdS,textAlign:"center",fontSize:11,fontWeight:700}}>{observedDisp!=null?sig3(observedDisp):"—"}</td>
                <td style={{...tdS,textAlign:"center",fontSize:11,fontWeight:700,color:accColor}}>{r.accuracy!=null?r.accuracy.toFixed(1)+"%":(r.observed==null?"no result":"need expected")}</td>
                <td style={{...tdS,textAlign:"center",fontSize:13,fontWeight:800,color:r.pass==null?"#aeaeb2":(r.pass?"#1b7f6a":"#b4332e")}}>{r.pass==null?"—":(r.pass?"✓":"✗")}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
      {sstSamples.length>0 && instructor && <div style={{marginTop:8,padding:"6px 10px",background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:6,fontSize:10,color:"#5a6984",lineHeight:1.5}}>
        <strong>Interpretation.</strong> SST = an independent known. Accuracy = observed/expected × 100. ICH M10 target: 80–120%. Outside that window, the workflow isn't quantitating accurately even if the curve fits well.
      </div>}
    </div>

    {/* ── Calibrator quality (back-fit) — SECONDARY ────────────────────── */}
    <details style={{padding:"10px 14px",background:"rgba(255,255,255,0.5)",border:"1px solid "+sc2.border,borderRadius:10,marginBottom:10}}>
      <summary style={{cursor:"pointer",userSelect:"none",fontSize:13,fontWeight:800,color:"#0b2a6f"}}>
        Standard Curve Quality (back-fit)
        <span style={{fontSize:11,fontWeight:600,color:"#5a6984",marginLeft:10,fontStyle:"italic"}}>— {plateSST.filter(function(p){return p.status==="pass";}).length}/{plateSST.length} plate{plateSST.length===1?"":"s"} pass</span>
      </summary>
      <div style={{marginTop:8}}>
        {instructor && <div style={{fontSize:11,color:"#5a6984",marginBottom:8,lineHeight:1.55,padding:"6px 10px",background:"#f7fbff",border:"1px solid #d7e7fb",borderRadius:6}}>
          <strong>What this checks.</strong> Each standard's blank-corrected response is run back through the inverse fit to recover its concentration. If the curve is well-formed, that back-calculated value should match the standard's nominal (declared) concentration within ±20% (±25% at LLOQ). When standards fail this, it usually means the curve fit is poor at that level — those <em>standards</em> are suspect, not your samples directly. ICH M10 still allows reporting if ≥75% of standards pass. <strong>Tip:</strong> if failures cluster at the lowest standards (e.g. STD 5 and 6 in a 6-point curve), the curve fits poorly at the low end — sample concentrations reported in that range should be flagged BLOQ (below limit of quantitation) or reported with caveats. The de facto LLOQ rises to whatever the next-passing standard is.
        </div>}
        {plateSST.map(function(plate, idx){
          var psc = statusColor[plate.status];
          return <div key={idx} style={{marginTop:idx===0?0:14,padding:"10px 12px",background:"#fff",border:"1px solid "+psc.border,borderRadius:10}}>
            <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:6,flexWrap:"wrap"}}>
              <span style={{fontSize:13,fontWeight:800,color:"#0b2a6f"}}>{plate.label}</span>
              <span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:12,background:psc.iconColor,color:"#fff"}}>{psc.label}</span>
              <span style={{fontSize:11,color:"#5a6984"}}>R²={sig3(plate.r2)} ({plate.model==="linear"?"Linear":plate.model==="loglog"?"Log-log":plate.model==="4pl"?"4PL":"5PL"})</span>
              <span style={{fontSize:11,color:"#5a6984"}}>{plate.passing}/{plate.total} standards in spec</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
                <thead><tr>
                  <th style={{...thS,textAlign:"center",fontSize:10}}>Standard</th>
                  <th style={{...thS,textAlign:"center",fontSize:10,lineHeight:1.3}}><div>Nominal</div><div style={{fontWeight:500,fontSize:9,color:"#8e9bb5"}}>({displayUnit})</div></th>
                  <th style={{...thS,textAlign:"center",fontSize:10,lineHeight:1.3}}><div>Back-fit</div><div style={{fontWeight:500,fontSize:9,color:"#8e9bb5"}}>({displayUnit})</div></th>
                  <th style={{...thS,textAlign:"center",fontSize:10,lineHeight:1.3}}><div>Accuracy</div><div style={{fontWeight:500,fontSize:9,color:"#8e9bb5"}}>(target ±20%)</div></th>
                  <th style={{...thS,textAlign:"center",fontSize:10,lineHeight:1.3}}><div>Replicate CV</div><div style={{fontWeight:500,fontSize:9,color:"#8e9bb5"}}>(target ≤15%)</div></th>
                  <th style={{...thS,textAlign:"center",fontSize:10}}>Pass?</th>
                </tr></thead>
                <tbody>
                  {plate.standards.map(function(s){
                    if (s.nominal===0) {
                      return <tr key={s.idx} style={{opacity:0.55}}>
                        <td style={{...tdS,fontSize:11}}>Blank<span style={{fontSize:9,color:"#8e9bb5",marginLeft:6,fontStyle:"italic"}}>(not evaluated)</span></td>
                        <td style={{...tdS,textAlign:"center",fontSize:11}}>{sig3(s.nominal)}</td>
                        <td style={{...tdS,textAlign:"center",fontSize:11}}>—</td>
                        <td style={{...tdS,textAlign:"center",fontSize:11}}>—</td>
                        <td style={{...tdS,textAlign:"center",fontSize:11}}>{s.cv!=null?(s.cv*100).toFixed(1)+"%":"—"}</td>
                        <td style={{...tdS,textAlign:"center",fontSize:11,color:"#aeaeb2"}}>—</td>
                      </tr>;
                    }
                    var nominalDisp = convertConc(s.nominal, unit, displayUnit);
                    var backFitDisp = s.backFit!=null ? convertConc(s.backFit, unit, displayUnit) : null;
                    var accColor = s.accuracy==null ? "#aeaeb2" : (s.accPass ? "#1b7f6a" : "#b4332e");
                    var cvColor = s.cv==null ? "#aeaeb2" : (s.cvPass ? "#1b7f6a" : "#b4332e");
                    var rowBg = s.overallPass===false ? "rgba(180,51,46,0.06)" : "transparent";
                    return <tr key={s.idx} style={{background:rowBg}}>
                      <td style={{...tdS,fontSize:11}}>STD {s.idx+1}{s.isLLOQ&&<span title={lloqTooltip} style={{fontSize:9,fontWeight:800,color:"#6337b9",marginLeft:6,padding:"1px 6px",background:"#f3edfd",borderRadius:8,cursor:"help",borderBottom:"1px dotted #6337b9"}}>LLOQ</span>}</td>
                      <td style={{...tdS,textAlign:"center",fontSize:11,fontWeight:600}}>{sig3(nominalDisp)}</td>
                      <td style={{...tdS,textAlign:"center",fontSize:11}}>{backFitDisp!=null?sig3(backFitDisp):"—"}</td>
                      <td style={{...tdS,textAlign:"center",fontSize:11,fontWeight:700,color:accColor}}>{s.accuracy!=null?s.accuracy.toFixed(1)+"%":"—"}</td>
                      <td style={{...tdS,textAlign:"center",fontSize:11,fontWeight:600,color:cvColor}}>{s.cv!=null?(s.cv*100).toFixed(1)+"%":"—"}</td>
                      <td style={{...tdS,textAlign:"center",fontSize:13,fontWeight:800,color:s.overallPass==null?"#aeaeb2":(s.overallPass?"#1b7f6a":"#b4332e")}}>{s.overallPass==null?"—":(s.overallPass?"✓":"✗")}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>;
        })}
        {/* Cross-plate precision (instructor + multi-plate) */}
        {crossPlate && crossPlate.length>0 && <div style={{marginTop:14,padding:"10px 12px",background:"rgba(99,55,185,0.06)",border:"1px solid #d8c8f5",borderRadius:10}}>
          <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:800,color:"#6337b9"}}>Cross-plate precision</span>
            <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:12,background:"#6337b9",color:"#fff"}}>INSTRUCTOR</span>
            <span style={{fontSize:11,color:"#5a6984",fontStyle:"italic"}}>How reproducible is each standard's signal across the {res.length} plates?</span>
          </div>
          <div style={{fontSize:11,color:"#5a6984",marginBottom:8,lineHeight:1.5}}>
            <strong>This is plate-to-plate reproducibility</strong> — distinct from the within-plate replicate CV shown above. Within-plate CV reflects pipetting + read noise on a single plate; cross-plate CV reflects day-to-day, operator, and inter-plate effects. Both should be small for a well-controlled assay.
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
              <thead><tr>
                <th style={{...thS,textAlign:"center",fontSize:10}}>Standard</th>
                <th style={{...thS,textAlign:"center",fontSize:10}}>Nominal ({displayUnit})</th>
                <th style={{...thS,textAlign:"center",fontSize:10}}>Plates</th>
                <th style={{...thS,textAlign:"center",fontSize:10}}>Mean response</th>
                <th style={{...thS,textAlign:"center",fontSize:10}}>SD</th>
                <th style={{...thS,textAlign:"center",fontSize:10}}>Cross-plate CV</th>
              </tr></thead>
              <tbody>
                {crossPlate.map(function(cp){
                  var nominalDisp = cp.nominal!=null ? convertConc(cp.nominal, unit, displayUnit) : null;
                  var cvColor = cp.cv==null ? "#aeaeb2" : (cp.cv<=0.15 ? "#1b7f6a" : (cp.cv<=0.25 ? "#9a6a00" : "#b4332e"));
                  return <tr key={cp.idx}>
                    <td style={{...tdS,fontSize:11}}>STD {cp.idx+1}</td>
                    <td style={{...tdS,textAlign:"center",fontSize:11}}>{nominalDisp!=null?sig3(nominalDisp):"—"}</td>
                    <td style={{...tdS,textAlign:"center",fontSize:11}}>{cp.n}</td>
                    <td style={{...tdS,textAlign:"center",fontSize:11}}>{fm4(cp.mean)}</td>
                    <td style={{...tdS,textAlign:"center",fontSize:11}}>{fm4(cp.sd)}</td>
                    <td style={{...tdS,textAlign:"center",fontSize:11,fontWeight:700,color:cvColor}}>{cp.cv!=null?(cp.cv*100).toFixed(1)+"%":"—"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>}
      </div>
    </details>

    {instructor && <div style={{padding:"8px 12px",background:"rgba(255,255,255,0.5)",borderRadius:8,fontSize:10,color:"#5a6984",lineHeight:1.55}}>
      <strong>ICH M10 acceptance criteria.</strong> SST/QC samples must back-calculate within 80–120% of nominal. Calibrator standards must be within 80–120% of nominal (75–125% at LLOQ — <span title={lloqTooltip} style={{cursor:"help",borderBottom:"1px dotted #5a6984"}}>what's LLOQ?</span>) for ≥75% of standards. Replicate CV ≤15% (≤20% at LLOQ). R² is informational and not a defined pass/fail threshold.
    </div>}
    </div>
  </details>;
}


// Robot QC: Replicate Reproducibility card.
// Treats EACH selected sample as its own dilution series. For each sample independently:
//   - Builds (response, 1/DF) points — same form as the standard curve.
//   - Fits a linear regression → R², slope, intercept.
//   - Reports the within-replicate CV at each dilution level (across the 3 reps at that level).
//   - Reports a single mean-within-rep CV summarizing dispense reproducibility.
// Then compares ACROSS samples:
//   - If all samples are aliquots from the same stock, their slopes should match.
//   - CV of slopes across samples = robot prep-step reproducibility.
// This is the analogue of asking "is each sample its own well-behaved standard curve?" and
// "do all the should-be-identical samples actually produce identical curves?"
//
// Per-sample pass thresholds (any one failing = caution; two = fail):
//   R² ≥ 0.99
//   mean within-rep CV ≤ 5%
//   worst within-rep CV ≤ 15%
// Cross-sample slope CV ≤ 5% indicates uniform prep across aliquots.
function RobotQCCard(props) {
  var res = props.res;
  if (!res || !res.length) return null;
  var instructor = !!props.instructor;

  // Flatten across plates
  var multiPlate = res.length > 1;
  var allSamples = [];
  res.forEach(function(pp, pi){
    pp.samps.forEach(function(s, si){
      var displayName = multiPlate ? ("P"+(pi+1)+"·"+s.name) : s.name;
      allSamples.push({key:pi+":"+si, plateIdx:pi, sampleIdx:si, name:displayName, dbD:s.dbD||[]});
    });
  });

  // Selection state — default: all samples selected
  var initialSel = {};
  allSamples.forEach(function(s){initialSel[s.key]=true;});
  var _sel = useState(initialSel), sel = _sel[0], setSel = _sel[1];

  // Gate: this analysis only applies to robot-validation experiments where samples are theoretical
  // replicates from one stock. Default off so the card doesn't auto-run on regular analytical runs
  // (where the slope-CV interpretation would be misleading).
  var _enabled = useState(false), enabled = _enabled[0], setEnabled = _enabled[1];

  // Dropdown picker open state — replaces the wall-of-checkboxes UI for runs with many samples.
  var _pickerOpen = useState(false), pickerOpen = _pickerOpen[0], setPickerOpen = _pickerOpen[1];

  var toggle = function(key){
    setSel(function(prev){
      var n = {};
      for (var k in prev) n[k] = prev[k];
      n[key] = !n[key];
      return n;
    });
  };
  var setAll = function(v){
    var n = {};
    allSamples.forEach(function(s){n[s.key]=v;});
    setSel(n);
  };

  var selectedSamples = allSamples.filter(function(s){return sel[s.key];});

  // ── Per-sample curve fits ────────────────────────────────────────
  // For each sample: build (1/df, avgA) pairs, fit linear, compute R²+slope+intercept.
  // Also collect per-level CV (within-rep CV at each dilution) from dbD entries.
  var sampleAnalyses = selectedSamples.map(function(s){
    // Filter to dilutions with valid avgA AND df > 0 (DF=0 wouldn't be a dilution).
    // The "blank" position is typically encoded with df=null/0 OR it's the last level — we exclude
    // it by requiring avgA > 0 implicitly via the fit's data validity.
    var validPts = s.dbD.filter(function(d){
      return d.df != null && isFinite(d.df) && d.df > 0
          && d.avgA != null && isFinite(d.avgA);
    });
    if (validPts.length < 2) {
      return {key:s.key, name:s.name, n:validPts.length, fit:null, levelCVs:[], meanCV:null, worstCV:null, points:validPts};
    }
    // Fit response (y) vs df (x). In this codebase, df is stored as relative well concentration
    // (e.g., 0.1 for a 1:10 dilution from stock = 1) — same convention as the standard curve uses.
    // So response vs df IS response vs concentration. Slope and R² are directly comparable to the
    // main standard curve. The user's chosen dilution scheme (xdf, xds in General Info) determines
    // the df values automatically, so this honors whatever scheme they entered.
    var xs = validPts.map(function(d){return d.df;});
    var ys = validPts.map(function(d){return d.avgA;});
    var fit = linReg(xs, ys);
    // Within-rep CV per level. d.cv is stored as a fraction in dbD (e.g., 0.019 for 1.9% CV).
    // Convert to percentage at the source so all downstream logic (threshold checks, table
    // display, interpretation text) operates on percentage values consistently.
    var levelCVs = validPts
      .map(function(d){return {di:d.di, df:d.df, cv:(d.cv != null && isFinite(d.cv)) ? d.cv*100 : null, n:(d.cor||[]).length};})
      .filter(function(L){return L.cv != null && isFinite(L.cv);});
    var cvVals = levelCVs.map(function(L){return L.cv;});
    var meanCV = cvVals.length ? avg(cvVals) : null;
    var worstCV = cvVals.length ? Math.max.apply(null, cvVals) : null;
    return {key:s.key, name:s.name, n:validPts.length, fit:fit, levelCVs:levelCVs, meanCV:meanCV, worstCV:worstCV, points:validPts, xs:xs, ys:ys};
  });

  // ── Per-sample flag ──────────────────────────────────────────────
  // pass: R² ≥ 0.99 AND meanCV ≤ 5% AND worstCV ≤ 15%
  // fail: any of {R² < 0.95, meanCV > 15%, worstCV > 25%}
  // caution: in between
  sampleAnalyses.forEach(function(sa){
    if (!sa.fit) { sa.flag = "n/a"; return; }
    var r2 = sa.fit.r2;
    var mC = sa.meanCV;
    var wC = sa.worstCV;
    var failR2 = r2 < 0.95;
    var failMean = mC != null && mC > 15;
    var failWorst = wC != null && wC > 25;
    if (failR2 || failMean || failWorst) { sa.flag = "fail"; return; }
    var passR2 = r2 >= 0.99;
    var passMean = mC == null || mC <= 5;
    var passWorst = wC == null || wC <= 15;
    if (passR2 && passMean && passWorst) { sa.flag = "pass"; return; }
    sa.flag = "caution";
  });

  // ── Cross-sample slope comparison ────────────────────────────────
  var validFits = sampleAnalyses.filter(function(sa){return sa.fit != null;});
  var slopes = validFits.map(function(sa){return sa.fit.slope;});
  var slopeMean = slopes.length ? avg(slopes) : null;
  var slopeSD = slopes.length >= 2 ? sdc(slopes) : null;
  var slopeCV = (slopeSD != null && slopeMean != null && slopeMean > 0) ? (slopeSD/slopeMean)*100 : null;
  var r2s = validFits.map(function(sa){return sa.fit.r2;});
  var r2Min = r2s.length ? Math.min.apply(null, r2s) : null;
  var r2Max = r2s.length ? Math.max.apply(null, r2s) : null;

  // ── Color helpers ────────────────────────────────────────────────
  var cvColor = function(cv){
    if (cv == null) return "#aeaeb2";
    if (cv <= 5) return "#1b7f6a";
    if (cv <= 15) return "#bf7a1a";
    return "#b4332e";
  };
  var r2Color = function(r2){
    if (r2 == null) return "#aeaeb2";
    if (r2 >= 0.99) return "#1b7f6a";
    if (r2 >= 0.95) return "#bf7a1a";
    return "#b4332e";
  };
  var flagColor = function(f){
    if (f === "pass") return "#1b7f6a";
    if (f === "caution") return "#bf7a1a";
    if (f === "fail") return "#b4332e";
    return "#aeaeb2";
  };
  var flagLabel = function(f){
    if (f === "pass") return "✓ pass";
    if (f === "caution") return "⚠ caution";
    if (f === "fail") return "✗ fail";
    return "—";
  };
  var sampleColors = ["#3478F6","#1b7f6a","#bf7a1a","#6337b9","#a05a00","#0f8aa2","#b4332e","#5fa0d0","#d88060","#80b0c0","#a880d0","#5fb0a0"];

  // ── Overlaid line plot ───────────────────────────────────────────
  // X = df on linear scale. In this codebase, df is the relative well concentration (e.g., 0.1
  // for 1:10), so plotting response vs df IS response vs concentration. The dilution scheme entered
  // in General Information of the Data Entry tab drives the df values automatically — the plot
  // honors whatever scheme the user defined.
  // Y = blank-corrected response. Each sample = one polyline through its dilution points, with a
  // dashed fit line drawn through the points using its slope+intercept. A high R² in the table
  // visually maps to points sitting on the fit line.
  var allDfs = [];
  var allAs = [];
  selectedSamples.forEach(function(s){
    s.dbD.forEach(function(d){
      if (d.df != null && isFinite(d.df) && d.df > 0 && d.avgA != null && isFinite(d.avgA)) {
        allDfs.push(d.df);
        allAs.push(d.avgA);
      }
    });
  });
  var hasPlotData = allDfs.length >= 2;

  var plotW = 540, plotH = 280;
  var padL = 60, padR = 16, padT = 14, padB = 50;
  var innerW = plotW - padL - padR;
  var innerH = plotH - padT - padB;
  var renderPlot = null;
  if (hasPlotData) {
    var dfMax = Math.max.apply(null, allDfs);
    // X always starts at 0 so the y-intercept is visible (this is where conc=0 → blank-corrected
    // response should be ~0 for a proper fit). Adds a bit of right padding so points don't sit
    // on the plot edge.
    var xMin = 0;
    var xMax = dfMax * 1.05;
    var aMin = Math.min.apply(null, allAs);
    var aMax = Math.max.apply(null, allAs);
    var aPad = (aMax - aMin) * 0.08 || 0.01;
    aMin = Math.min(0, aMin - aPad); // include 0 if all values are positive — shows the intercept context
    aMax = aMax + aPad;
    var xScale = function(df){ return padL + ((df - xMin) / (xMax - xMin || 1)) * innerW; };
    var yScale = function(a){ return padT + (1 - (a - aMin) / (aMax - aMin || 1)) * innerH; };

    // X ticks: pick ~5 evenly-spaced "nice" values from 0 to xMax. Compute step from xMax/5 then
    // round to a 1-2-5 multiple of the appropriate power of 10.
    var rawStep = xMax / 5;
    var pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var normalized = rawStep / pow10;
    var niceStep;
    if (normalized < 1.5) niceStep = pow10;
    else if (normalized < 3) niceStep = 2 * pow10;
    else if (normalized < 7) niceStep = 5 * pow10;
    else niceStep = 10 * pow10;
    var xTicks = [];
    for (var t=0; t <= xMax + niceStep*0.0001; t += niceStep) xTicks.push(t);
    // Format X tick labels: avoid floating-point junk like "0.10000000004"
    var fmtX = function(v){
      if (v === 0) return "0";
      if (niceStep >= 1) return v.toFixed(0);
      var decimals = Math.max(0, -Math.floor(Math.log10(niceStep)));
      return v.toFixed(decimals);
    };

    var yTicks = [aMin, aMin + (aMax-aMin)/3, aMin + 2*(aMax-aMin)/3, aMax];

    var lines = selectedSamples.map(function(s, sIdx){
      var pts = s.dbD
        .filter(function(d){return d.df!=null && isFinite(d.df) && d.df>0 && d.avgA!=null && isFinite(d.avgA);})
        .sort(function(a,b){return a.df - b.df;})  // ascending df = lowest concentration → highest
        .map(function(d){return {x:xScale(d.df), y:yScale(d.avgA), df:d.df, avgA:d.avgA};});
      if (pts.length === 0) return null;
      var pathD = pts.map(function(p,i){return (i===0?"M":"L")+p.x.toFixed(1)+" "+p.y.toFixed(1);}).join(" ");
      var col = sampleColors[sIdx % sampleColors.length];
      // Fit line: y = slope*x + intercept, drawn from x=0 to x=xMax
      var sa = sampleAnalyses[sIdx];
      var fitLine = null;
      if (sa && sa.fit) {
        var y0 = sa.fit.slope * 0 + sa.fit.intercept;
        var y1 = sa.fit.slope * xMax + sa.fit.intercept;
        fitLine = {x0:xScale(0), y0:yScale(y0), x1:xScale(xMax), y1:yScale(y1)};
      }
      return {pts:pts, path:pathD, color:col, name:s.name, key:s.key, fitLine:fitLine};
    }).filter(function(L){return L!=null;});

    renderPlot = <svg viewBox={"0 0 "+plotW+" "+plotH} style={{width:"100%",height:"auto",maxWidth:plotW,display:"block",background:"#fafbfd",border:"1px solid #e5e9f0",borderRadius:8}}>
      {/* Y gridlines + labels */}
      {yTicks.map(function(t,i){
        var y = yScale(t);
        return <g key={"y"+i}>
          <line x1={padL} y1={y} x2={plotW-padR} y2={y} stroke="#e5e9f0" strokeWidth="1" strokeDasharray={i===0||i===yTicks.length-1?"":"2,3"} />
          <text x={padL-6} y={y+3} fontSize="9" fill="#6e6e73" textAnchor="end" fontFamily="system-ui">{t.toFixed(Math.abs(t)<1?3:2)}</text>
        </g>;
      })}
      {/* X gridlines + labels */}
      {xTicks.map(function(t,i){
        var x = xScale(t);
        return <g key={"x"+i}>
          <line x1={x} y1={padT} x2={x} y2={plotH-padB} stroke="#e5e9f0" strokeWidth="1" strokeDasharray="2,3" />
          <text x={x} y={plotH-padB+12} fontSize="9" fill="#6e6e73" textAnchor="middle" fontFamily="system-ui">{fmtX(t)}</text>
        </g>;
      })}
      {/* Axis labels */}
      <text x={plotW/2} y={plotH-22} fontSize="10" fill="#30437a" textAnchor="middle" fontFamily="system-ui" fontWeight="600">Relative well concentration (stock = 1)</text>
      <text x={plotW/2} y={plotH-7} fontSize="9" fill="#8e9bb5" textAnchor="middle" fontFamily="system-ui" fontStyle="italic">From your dilution scheme · multiply x by stock conc for absolute concentration</text>
      <text x={14} y={plotH/2} fontSize="10" fill="#30437a" textAnchor="middle" fontFamily="system-ui" fontWeight="600" transform={"rotate(-90, 14, "+(plotH/2)+")"}>Response (blank-corrected)</text>
      {/* Per-sample: solid fit line + data point dots. No connect-the-dots polyline — the fit line
          is the meaningful trend, and for clean serial-dilution data the two would overlap anyway. */}
      {lines.map(function(L){
        return <g key={L.key}>
          {L.fitLine && <line x1={L.fitLine.x0} y1={L.fitLine.y0} x2={L.fitLine.x1} y2={L.fitLine.y1} stroke={L.color} strokeWidth="1.5" opacity="0.85" />}
          {L.pts.map(function(p,pi){return <circle key={pi} cx={p.x} cy={p.y} r="3.5" fill={L.color} stroke="#fff" strokeWidth="1.2" />;})}
        </g>;
      })}
    </svg>;
  }

  // ── Plain-English interpretation ─────────────────────────────────
  var interpretation = (function(){
    if (selectedSamples.length === 0) return "Select at least one sample to view its dilution curve and fit metrics.";
    if (validFits.length === 0) return "No sample has enough valid dilution points (≥2) for a fit.";
    var nPass = sampleAnalyses.filter(function(sa){return sa.flag==="pass";}).length;
    var nFail = sampleAnalyses.filter(function(sa){return sa.flag==="fail";}).length;
    var nCaution = sampleAnalyses.filter(function(sa){return sa.flag==="caution";}).length;
    var pieces = [];
    pieces.push(nPass + " of " + sampleAnalyses.length + " sample" + (sampleAnalyses.length===1?"":"s") + " pass all criteria");
    if (nCaution > 0) pieces.push(nCaution + " in caution zone");
    if (nFail > 0) pieces.push(nFail + " fail");
    var line1 = pieces.join(", ") + ".";
    var line2 = "";
    if (validFits.length >= 2 && slopeCV != null) {
      if (slopeCV <= 5) {
        line2 = " Slope CV across samples = " + slopeCV.toFixed(1) + "% — uniform across aliquots, suggesting consistent robot prep.";
      } else if (slopeCV <= 15) {
        line2 = " Slope CV across samples = " + slopeCV.toFixed(1) + "% — moderate spread; some prep variability between aliquots (assuming samples are theoretical replicates).";
      } else if (slopeCV <= 50) {
        line2 = " Slope CV across samples = " + slopeCV.toFixed(1) + "% — high variability between sample slopes. If samples are theoretical replicates from one stock, this suggests inconsistent prep at the aliquoting step.";
      } else {
        line2 = " Slope CV across samples = " + slopeCV.toFixed(1) + "% — slopes differ widely. Likely the selected samples are NOT theoretical replicates (different concentrations or different analytes). Slope-CV metric only meaningful when samples are aliquots of one stock.";
      }
    } else if (validFits.length === 1) {
      line2 = " (Slope comparison requires 2+ samples.)";
    }
    return line1 + line2;
  })();

  // ── Styling primitives ───────────────────────────────────────────
  var thS = {padding:"6px 10px",fontSize:10,fontWeight:700,color:"#30437a",textTransform:"uppercase",letterSpacing:0.4,textAlign:"left",borderBottom:"2px solid #d8dfeb",background:"#fafafa",whiteSpace:"nowrap"};
  var tdS = {padding:"6px 10px",fontSize:11,color:"#1d1d1f",borderBottom:"1px solid #f0f0f3"};

  return <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1.25rem",marginBottom:"1.25rem"}}>
    <div style={{marginBottom:enabled?"0.75rem":0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <h4 style={{fontSize:14,fontWeight:700,margin:0,color:"#30437a"}}>🤖 Robot QC: Per-Sample Curve Quality</h4>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:11,color:"#6e6e73",fontStyle:"italic",marginRight:4}}>Robot validation run?</span>
          <button onClick={function(){setEnabled(true);}} style={{fontSize:11,padding:"4px 12px",border:"1px solid "+(enabled?"#1b7f6a":"#c6d3e8"),borderRadius:6,background:enabled?"#e8f5ea":"#fff",color:enabled?"#1b5a4d":"#30437a",cursor:"pointer",fontWeight:enabled?700:600}}>Yes</button>
          <button onClick={function(){setEnabled(false);}} style={{fontSize:11,padding:"4px 12px",border:"1px solid "+(!enabled?"#6f7fa0":"#c6d3e8"),borderRadius:6,background:!enabled?"#f4f4f6":"#fff",color:!enabled?"#1d1d1f":"#30437a",cursor:"pointer",fontWeight:!enabled?700:600}}>No</button>
        </div>
      </div>
      {enabled && <p style={{fontSize:11,color:"#6e6e73",margin:"6px 0 0 0",lineHeight:1.55}}>Each sample is treated as its own mini standard curve: response vs concentration is fit linearly, R²/slope/intercept reported. Per-sample within-replicate CV checks dispense reproducibility; cross-sample slope CV checks aliquoting reproducibility. <strong>Most useful when selected samples are theoretical replicates (e.g., aliquots of one stock), but also works for any single sample.</strong></p>}
      {!enabled && <p style={{fontSize:11,color:"#8e9bb5",margin:"6px 0 0 0",lineHeight:1.55,fontStyle:"italic"}}>Click "Yes" if your samples are theoretical replicates from a shared stock (e.g., a robot pipetting validation run). Otherwise this analysis isn't meaningful for your data.</p>}
    </div>

    {enabled && <div>

    {/* Sample picker — dropdown style for runs with many samples */}
    <div style={{marginBottom:"0.85rem",position:"relative"}}>
      <button onClick={function(){setPickerOpen(!pickerOpen);}} style={{width:"100%",padding:"8px 12px",background:"#f7faff",border:"1px solid #e5e9f0",borderRadius:8,fontSize:12,color:"#30437a",cursor:"pointer",fontWeight:600,textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>Samples in replicate group: <strong>{selectedSamples.length} of {allSamples.length}</strong> selected</span>
        <span style={{fontSize:10,color:"#6e6e73"}}>{pickerOpen ? "▲ close" : "▼ change"}</span>
      </button>
      {pickerOpen && <div style={{marginTop:6,padding:"10px 12px",background:"#fff",border:"1px solid #c6d3e8",borderRadius:8,boxShadow:"0 8px 20px rgba(11,42,111,0.10)",maxHeight:280,overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"flex-end",gap:6,marginBottom:8,paddingBottom:8,borderBottom:"1px solid #f0f0f3"}}>
          <button onClick={function(){setAll(true);}} style={{fontSize:10,padding:"3px 8px",border:"1px solid #c6d3e8",borderRadius:6,background:"#fff",color:"#30437a",cursor:"pointer",fontWeight:600}}>Select all</button>
          <button onClick={function(){setAll(false);}} style={{fontSize:10,padding:"3px 8px",border:"1px solid #c6d3e8",borderRadius:6,background:"#fff",color:"#30437a",cursor:"pointer",fontWeight:600}}>Clear</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {allSamples.map(function(s, idx){
            var isSel = !!sel[s.key];
            var idxInSel = selectedSamples.findIndex(function(ss){return ss.key===s.key;});
            var col = isSel && idxInSel>=0 ? sampleColors[idxInSel % sampleColors.length] : "#aeaeb2";
            return <label key={s.key} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 8px",borderRadius:6,fontSize:12,cursor:"pointer",userSelect:"none",background:isSel?"#f7faff":"transparent",border:"1px solid "+(isSel?col:"transparent")}}>
              <input type="checkbox" checked={isSel} onChange={function(){toggle(s.key);}} style={{margin:0,cursor:"pointer"}} />
              <span style={{display:"inline-block",width:10,height:10,background:isSel?col:"#d8dfeb",borderRadius:2}}></span>
              <span style={{fontWeight:isSel?700:500,color:isSel?col:"#6e6e73"}}>{s.name}</span>
            </label>;
          })}
        </div>
      </div>}
    </div>

    {/* Plot — works with even 1 sample selected */}
    {selectedSamples.length >= 1 && hasPlotData && <div style={{marginBottom:10}}>
      <div style={{fontSize:11,fontWeight:700,color:"#30437a",marginBottom:4}}>Per-sample dilution curves (overlaid)</div>
      {renderPlot}
    </div>}

    {/* Per-sample fit table */}
    {selectedSamples.length >= 1 && <div style={{overflowX:"auto",marginBottom:10}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
        <thead><tr>
          <th style={thS}>Sample</th>
          <th style={thS}>n levels</th>
          <th style={thS}>R²</th>
          <th style={thS}>Slope</th>
          <th style={thS}>Intercept</th>
          <th style={thS}>Mean rep CV</th>
          <th style={thS}>Worst rep CV</th>
          <th style={thS}>Verdict</th>
        </tr></thead>
        <tbody>
          {sampleAnalyses.map(function(sa, idx){
            var col = sampleColors[idx % sampleColors.length];
            var bgFlag = sa.flag === "fail" ? "#fdecec" : (sa.flag === "caution" ? "#fff7e8" : "transparent");
            return <tr key={sa.key} style={{background:bgFlag}}>
              <td style={Object.assign({},tdS,{fontWeight:700})}>
                <span style={{display:"inline-block",width:10,height:10,background:col,borderRadius:2,marginRight:6,verticalAlign:"middle"}}></span>
                {sa.name}
              </td>
              <td style={tdS}>{sa.n}</td>
              <td style={Object.assign({},tdS,{color:r2Color(sa.fit?sa.fit.r2:null),fontWeight:700})}>{sa.fit ? sa.fit.r2.toFixed(4) : "—"}</td>
              <td style={tdS}>{sa.fit ? sig3(sa.fit.slope) : "—"}</td>
              <td style={tdS}>{sa.fit ? sig3(sa.fit.intercept) : "—"}</td>
              <td style={Object.assign({},tdS,{color:cvColor(sa.meanCV),fontWeight:600})}>{sa.meanCV != null ? sa.meanCV.toFixed(1)+"%" : "—"}</td>
              <td style={Object.assign({},tdS,{color:cvColor(sa.worstCV),fontWeight:600})}>{sa.worstCV != null ? sa.worstCV.toFixed(1)+"%" : "—"}</td>
              <td style={Object.assign({},tdS,{color:flagColor(sa.flag),fontWeight:700,fontSize:10})}>{flagLabel(sa.flag)}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}

    {/* Cross-sample summary — only shown with 2+ samples */}
    {validFits.length >= 2 && <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:8,marginBottom:10}}>
      <div style={{padding:"8px 10px",background:"#f4f7fb",border:"1px solid #d8dfeb",borderRadius:6}}>
        <div style={{fontSize:9,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}}>Slope CV across samples</div>
        <div style={{fontSize:18,fontWeight:800,color:cvColor(slopeCV)}}>{slopeCV != null ? slopeCV.toFixed(1)+"%" : "—"}</div>
        <div style={{fontSize:9,color:"#8e9bb5",marginTop:1}}>uniform prep if ≤5%</div>
      </div>
      <div style={{padding:"8px 10px",background:"#f4f7fb",border:"1px solid #d8dfeb",borderRadius:6}}>
        <div style={{fontSize:9,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}}>R² range</div>
        <div style={{fontSize:14,fontWeight:800,color:r2Color(r2Min)}}>{r2Min != null ? r2Min.toFixed(4) : "—"} – {r2Max != null ? r2Max.toFixed(4) : "—"}</div>
        <div style={{fontSize:9,color:"#8e9bb5",marginTop:1}}>linearity per sample</div>
      </div>
      <div style={{padding:"8px 10px",background:"#f4f7fb",border:"1px solid #d8dfeb",borderRadius:6}}>
        <div style={{fontSize:9,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}}>Mean slope</div>
        <div style={{fontSize:14,fontWeight:800,color:"#30437a"}}>{slopeMean != null ? sig3(slopeMean) : "—"}</div>
        <div style={{fontSize:9,color:"#8e9bb5",marginTop:1}}>signal per unit relative conc</div>
      </div>
    </div>}

    {/* Plain-English interpretation */}
    <div style={{padding:"8px 12px",background:"#f7f1ff",border:"1px solid #e2d7fb",borderRadius:8,fontSize:11,color:"#30437a",lineHeight:1.55,marginBottom:instructor?10:0}}>
      <strong style={{color:"#6337b9"}}>Interpretation:</strong> {interpretation}
    </div>

    {/* Instructor-mode ICH/ISO context */}
    {instructor && <div style={{padding:"8px 12px",background:"#fffaf0",border:"1px solid #f0d6a0",borderRadius:8,fontSize:10,color:"#8a6420",lineHeight:1.55}}>
      <strong>For reference:</strong> Per-sample R² ≥ 0.99 is the conventional acceptance for a calibration curve (ICH Q2(R2)). Within-replicate CV ≤ 5% is tighter than ICH M10's bioanalytical limit (15%, or 20% at LLOQ) — the rationale is to flag robot dispense issues before they consume your validation budget. ISO 8655 specifies pipettor imprecision (CV) ≤ 1–3% for fixed-volume pipettes. Cross-sample slope CV ≤ 5% indicates that aliquots from a shared stock produce similar calibration curves — the canonical robot-prep reproducibility check.
    </div>}

    </div>}
  </div>;
}

// ICH Q2(R2) Method Validation Parameters card.
// Computes what's available from a single run: linearity, range, accuracy (from SST), precision
// (within-run CV), and approximate LOD/LOQ from blank + low standard signal noise.
// Specificity is explicitly marked as out-of-scope (requires designed interferent experiments).
// Reference: ICH Q2(R2) "Validation of Analytical Procedures" (2023 revision).
function MethodValidationCard(props) {
  var res = props.res;
  if (!res || !res.length) return null;
  var unit = props.unit;
  var displayUnit = props.displayUnit || unit;
  var instructor = !!props.instructor;
  var sstSamples = props.sstSamples || [];
  var sstExpected = props.sstExpected || {};

  // Linearity: report R² across plates (the value is the same as what's shown on the curve).
  var r2Values = res.map(function(p){return p.sc && p.sc.r2 != null ? p.sc.r2 : null;}).filter(function(v){return v!=null;});
  var avgR2 = r2Values.length ? r2Values.reduce(function(s,v){return s+v;},0) / r2Values.length : null;
  var minR2 = r2Values.length ? Math.min.apply(null, r2Values) : null;

  // Range: per ICH Q2(R2), the interval where linearity, accuracy, AND precision are all
  // demonstrated simultaneously at every concentration. We compute per-plate the LONGEST
  // CONTIGUOUS run of standards where all three criteria pass:
  //   - Linearity: back-calculated residual reasonable (we use the same accuracy check as proxy)
  //   - Accuracy: back-fit within 80-120% of nominal (75-125% at the lowest passing level / LLOQ)
  //   - Precision: replicate CV ≤15% (≤20% at LLOQ)
  // Then take the most conservative range across plates (highest LLOQ, lowest ULOQ).
  var rangePerPlate = res.map(function(p){
    if (!p.sc || !p.sc.pts || !p.sc.pts.length) return null;
    if (!p.iFn) return null;
    // Sort standards low → high
    var sorted = p.sc.pts.slice().sort(function(a,b){return a.conc - b.conc;});
    // Per-level evaluation: does this standard pass linearity + accuracy + precision?
    var perLevel = sorted.map(function(pt, idx){
      var measured = p.iFn(pt.avg);
      if (measured == null || !isFinite(measured) || pt.conc <= 0) return {pt:pt, pass:false};
      var pctNom = (measured / pt.conc) * 100;
      var cvPct = pt.cv != null ? pt.cv * 100 : null;
      // First (lowest) passing level gets LLOQ thresholds (75-125% acc, 20% CV).
      // Other levels use 80-120% acc, 15% CV.
      var isLLOQish = idx === 0;
      var accThresh = isLLOQish ? [75, 125] : [80, 120];
      var cvThresh = isLLOQish ? 20 : 15;
      var accPass = pctNom >= accThresh[0] && pctNom <= accThresh[1];
      var cvPass = cvPct == null || cvPct <= cvThresh;
      return {pt:pt, pass:accPass && cvPass, accPct:pctNom, cv:cvPct};
    });
    // Find the longest contiguous block where pass=true
    var bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (var i = 0; i < perLevel.length; i++) {
      if (perLevel[i].pass) {
        if (curStart < 0) curStart = i;
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else {
        curStart = -1; curLen = 0;
      }
    }
    if (bestLen < 2) return null;  // need at least 2 levels for a range
    return {
      lloq: perLevel[bestStart].pt.conc,
      uloq: perLevel[bestStart + bestLen - 1].pt.conc,
      nLevels: bestLen
    };
  });
  var validRanges = rangePerPlate.filter(function(r){return r!=null;});
  var rangeLLOQ = validRanges.length ? Math.max.apply(null, validRanges.map(function(r){return r.lloq;})) : null;
  var rangeULOQ = validRanges.length ? Math.min.apply(null, validRanges.map(function(r){return r.uloq;})) : null;
  var rangeNLevels = validRanges.length ? Math.min.apply(null, validRanges.map(function(r){return r.nLevels;})) : null;

  // Spike recovery (additional accuracy source per ICH Q2). Pulls from the parent's runQC()
  // results passed through props.spikeRecovery. Format: {meanR, minR, maxR, nWithRec, status}.
  var spikeRec = props.spikeRecovery || null;
  var spikeRecValues = spikeRec && spikeRec.nWithRec > 0 ? spikeRec : null;

  // Accuracy: from SST samples — observed/expected × 100. Average across samples that have
  // expected concentrations declared.
  var accuracyValues = sstSamples.map(function(m){
    var pick = props.analystPickFor ? props.analystPickFor(m.plateIdx, m.sampleIdx) : null;
    var observed = pick && pick.conc != null ? pick.conc : null;
    var expectedRaw = sstExpected[m.key];
    if (expectedRaw == null || expectedRaw === "") return null;
    var expectedDisplay = parseFloat(expectedRaw);
    if (!isFinite(expectedDisplay) || expectedDisplay <= 0) return null;
    // Convert expected (typed in displayUnit) to base unit
    var convF = convertConc(1, displayUnit, unit);
    if (convF == null || !isFinite(convF) || convF <= 0) return null;
    var expected = expectedDisplay * convF;
    if (observed == null) return null;
    return (observed / expected) * 100;
  }).filter(function(v){return v != null && isFinite(v);});
  var avgAccuracy = accuracyValues.length ? accuracyValues.reduce(function(s,v){return s+v;},0) / accuracyValues.length : null;
  // ICH M10 / Q2 accuracy (validation): ±15% (85-115%); ±20% at LLOQ (80-120%).
  // This is STRICTER than the calibration-standard back-fit tolerance (±20% / ±25% at LLOQ),
  // because validation accuracy uses QC samples to assess method performance, not calibration
  // standards used to build the curve.
  var accuracyPass = accuracyValues.length ? accuracyValues.every(function(v){return v >= 85 && v <= 115;}) : null;

  // Precision (within-run, repeatability): aggregate replicate CV across all standards. Take the
  // mean. ICH Q2 guidance: ≤15% CV (≤20% at LLOQ).
  var allCVs = [];
  res.forEach(function(p){
    (p.sc && p.sc.pts || []).forEach(function(pt){
      if (pt.cv != null && isFinite(pt.cv)) allCVs.push(pt.cv);
    });
    (p.samps || []).forEach(function(s){
      (s.dils || []).forEach(function(d){
        if (d.cv != null && isFinite(d.cv)) allCVs.push(d.cv);
      });
    });
  });
  var avgCV = allCVs.length ? allCVs.reduce(function(s,v){return s+v;},0) / allCVs.length : null;
  var maxCV = allCVs.length ? Math.max.apply(null, allCVs) : null;
  var precisionPass = avgCV != null ? avgCV <= 0.15 : null;

  // LOD/LOQ (Q2 method 4): use SD of blank or lowest standards, divided by slope.
  // LOD = 3.3 × σ / slope; LOQ = 10 × σ / slope.
  // For linear fits, slope is direct. For log-log/4PL/5PL, this approximation is rough — we'll
  // skip the panel's LOD/LOQ for non-linear fits and label as "linear-only".
  var lodLoqPerPlate = res.map(function(p){
    if (!p.sc || p.sc.model !== "linear") return null;
    if (p.sc.slope == null || p.sc.slope === 0) return null;
    // SD of the lowest concentration's replicates (best proxy for noise floor)
    var lowestPt = (p.sc.pts || []).slice().sort(function(a,b){return a.conc - b.conc;})[0];
    if (!lowestPt || lowestPt.sd == null) return null;
    var sigma = lowestPt.sd;
    return {
      lod: 3.3 * sigma / p.sc.slope,
      loq: 10 * sigma / p.sc.slope
    };
  });
  var validLodLoq = lodLoqPerPlate.filter(function(v){return v != null;});
  var lod = validLodLoq.length ? Math.max.apply(null, validLodLoq.map(function(v){return v.lod;})) : null;
  var loq = validLodLoq.length ? Math.max.apply(null, validLodLoq.map(function(v){return v.loq;})) : null;

  var fmtConc = function(c){
    if (c == null || !isFinite(c)) return "—";
    var dispV = convertConc(c, unit, displayUnit);
    return sig3(dispV) + " " + displayUnit;
  };

  var rowS = {borderBottom:"1px solid #f0f0f3"};
  var labelS = {padding:"10px 12px",fontSize:12,fontWeight:600,color:"#30437a",textAlign:"left",verticalAlign:"top",width:"30%"};
  var valueS = {padding:"10px 12px",fontSize:12,color:"#1d1d1f",textAlign:"left",verticalAlign:"top"};
  var noteS = {padding:"10px 12px",fontSize:11,color:"#6e6e73",textAlign:"left",verticalAlign:"top",fontStyle:"italic"};
  // Pass/fail badge — visible in both analyst and instructor mode
  var badge = function(pass, threshText){
    if (pass === null || pass === undefined) return null;
    return <span style={{marginLeft:8,fontSize:10,fontWeight:700,color:pass?"#1b7f6a":"#b4332e",padding:"2px 6px",border:"1px solid "+(pass?"#a8d4b8":"#e0a8a8"),borderRadius:4,background:pass?"#eaf5ec":"#fdedec",whiteSpace:"nowrap"}}>{pass?"✓ Pass":"✗ Fail"}{threshText?" ("+threshText+")":""}</span>;
  };
  var outOfScope = function(){
    return <span style={{fontSize:10,fontWeight:700,color:"#8e9bb5",padding:"2px 6px",border:"1px solid #d8dfeb",borderRadius:4,background:"#f9fafc",whiteSpace:"nowrap"}}>Out of scope</span>;
  };
  // R² doesn't have a hard ICH threshold but R² > 0.99 is convention for bioanalytical methods
  var linearityPass = avgR2 != null ? avgR2 >= 0.99 : null;
  // Accuracy (validation): ICH M10 / Q2 require ±15% (85-115%); ±20% at LLOQ (80-120%).
  var sstAccPass = accuracyValues.length ? accuracyValues.every(function(v){return v >= 85 && v <= 115;}) : null;
  var spikeAccPass = spikeRecValues ? (spikeRecValues.minR >= 85 && spikeRecValues.maxR <= 115) : null;
  // Combined accuracy: must pass on whichever sources are available
  var anyAccChecked = sstAccPass !== null || spikeAccPass !== null;
  var combinedAccPass = anyAccChecked ? (sstAccPass !== false && spikeAccPass !== false) : null;
  var maxCVPct = maxCV != null ? maxCV * 100 : null;
  // Precision pass: max CV ≤ 15% (a tighter check than mean — flags any single bad replicate)
  var precisionPass = maxCVPct != null ? maxCVPct <= 15 : null;
  // LOD/LOQ — these are reported, not pass/fail; LOQ should be ≤ lowest standard
  var lowestStandard = null;
  res.forEach(function(p){
    (p.sc && p.sc.pts || []).forEach(function(pt){
      if (pt.conc > 0 && (lowestStandard == null || pt.conc < lowestStandard)) lowestStandard = pt.conc;
    });
  });
  var loqPass = (loq != null && lowestStandard != null) ? loq <= lowestStandard : null;

  return <details style={{marginBottom:"1.25rem",padding:0,borderRadius:14,background:"#fff",border:"1px solid #e0e8f0",overflow:"hidden"}}>
    <summary style={{cursor:"pointer",userSelect:"none",padding:"14px 18px",listStyle:"none",background:"linear-gradient(180deg,#f8fafd,#f0f5fb)",borderBottom:"1px solid #e0e8f0"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200}}>
          <div style={{fontSize:14,fontWeight:800,color:"#0b2a6f"}}>Method Validation Parameters (ICH Q2(R2))</div>
          <div style={{fontSize:11,color:"#6e6e73",marginTop:2}}>Computed from this run's data. Some parameters require additional experiments — marked accordingly.</div>
        </div>
        <span style={{fontSize:11,color:"#6e6e73",fontWeight:600,opacity:0.7}}>▾ click to expand</span>
      </div>
    </summary>
    <div style={{padding:"14px 18px"}}>
      <table style={{borderCollapse:"collapse",width:"100%"}}>
        <tbody>
          {/* Linearity */}
          <tr style={rowS}>
            <td style={labelS}>Linearity</td>
            <td style={valueS}>
              {avgR2 != null ? <span>R² = <strong>{avgR2.toFixed(4)}</strong>{r2Values.length>1?" (avg across "+r2Values.length+" plates, min "+minR2.toFixed(4)+")":""}{badge(linearityPass, "≥0.99")}</span> : <span style={{color:"#aeaeb2"}}>not computed</span>}
            </td>
            {instructor && <td style={noteS}>R² of the standard curve fit. ICH Q2 expects appropriate linearity demonstrated; R² &gt; 0.99 typical for bioanalytical methods.</td>}
          </tr>
          {/* Range */}
          <tr style={rowS}>
            <td style={labelS}>Range (LLOQ → ULOQ)</td>
            <td style={valueS}>
              {rangeLLOQ != null && rangeULOQ != null ? <span><strong>{fmtConc(rangeLLOQ)}</strong> to <strong>{fmtConc(rangeULOQ)}</strong> ({rangeNLevels} levels)</span> : <span style={{color:"#aeaeb2"}}>insufficient passing standards</span>}
            </td>
            {instructor && <td style={noteS}>Per ICH Q2/M10: longest contiguous block where linearity, accuracy (±15% / ±20% at LLOQ), AND precision (≤15% CV / ≤20% at LLOQ) all pass simultaneously. Most conservative across plates.</td>}
          </tr>
          {/* Accuracy from SST */}
          <tr style={rowS}>
            <td style={labelS}>Accuracy (from SST)</td>
            <td style={valueS}>
              {avgAccuracy != null ? <span><strong>{avgAccuracy.toFixed(1)}%</strong> (mean of {accuracyValues.length} SST sample{accuracyValues.length===1?"":"s"}){badge(sstAccPass, "85-115%")}</span> : <span style={{color:"#aeaeb2"}}>requires SST samples with expected concentrations</span>}
            </td>
            {instructor && <td style={noteS}>SST observed/expected × 100. ICH M10 acceptance for accuracy validation: each value within ±15% of nominal (i.e. 85–115%); ±20% at LLOQ (80–120%). Stricter than the calibration-standard back-fit tolerance, because validation accuracy uses QC-style samples.</td>}
          </tr>
          {/* Accuracy from spike recovery */}
          <tr style={rowS}>
            <td style={labelS}>Accuracy (from spike recovery)</td>
            <td style={valueS}>
              {spikeRecValues ? <span>Mean <strong>{spikeRecValues.meanR.toFixed(1)}%</strong>, range {spikeRecValues.minR.toFixed(1)}–{spikeRecValues.maxR.toFixed(1)}% ({spikeRecValues.nWithRec} spike set{spikeRecValues.nWithRec===1?"":"s"}){badge(spikeAccPass, "85-115%")}</span> : <span style={{color:"#aeaeb2"}}>requires spike-recovery experiment with measured spiked + unspiked samples</span>}
            </td>
            {instructor && <td style={noteS}>Recovery = (spiked − unspiked) / nominal × 100. ICH M10 acceptance: each spike set within ±15% of nominal (85–115%).</td>}
          </tr>
          {/* Precision: Repeatability (computed) */}
          <tr style={rowS}>
            <td style={labelS}>Precision: Repeatability</td>
            <td style={valueS}>
              {avgCV != null ? <span>Mean CV <strong>{(avgCV*100).toFixed(1)}%</strong>{maxCV!=null?", max "+(maxCV*100).toFixed(1)+"%":""}{badge(precisionPass, "max ≤15%")}</span> : <span style={{color:"#aeaeb2"}}>not computed</span>}
            </td>
            {instructor && <td style={noteS}>Within-run, within-day, same analyst/instrument. CV across replicates of standards + samples. Q2 acceptance: ≤15% (≤20% at LLOQ).</td>}
          </tr>
          {/* Precision: Intermediate (out of scope for single run) */}
          <tr style={rowS}>
            <td style={labelS}>Precision: Intermediate</td>
            <td style={valueS}>
              <span style={{color:"#8e9bb5",fontStyle:"italic"}}>Requires multiple runs (different days, analysts, or instruments)</span>
              {outOfScope()}
            </td>
            {instructor && <td style={noteS}>Q2 intermediate precision: variability within the same lab across operating conditions. Cannot be computed from a single run.</td>}
          </tr>
          {/* Precision: Reproducibility (out of scope for single run) */}
          <tr style={rowS}>
            <td style={labelS}>Precision: Reproducibility</td>
            <td style={valueS}>
              <span style={{color:"#8e9bb5",fontStyle:"italic"}}>Requires inter-laboratory study</span>
              {outOfScope()}
            </td>
            {instructor && <td style={noteS}>Q2 reproducibility: variability across laboratories. Demonstrated via collaborative or transfer studies.</td>}
          </tr>
          {/* LOD */}
          <tr style={rowS}>
            <td style={labelS}>LOD (3.3σ/slope)</td>
            <td style={valueS}>
              {lod != null ? <strong>{fmtConc(lod)}</strong> : <span style={{color:"#aeaeb2"}}>linear fit only{res.some(function(p){return p.sc && p.sc.model !== "linear";})?" (current fit is "+(res[0].sc?res[0].sc.model:"non-linear")+")":""}</span>}
            </td>
            {instructor && <td style={noteS}>Q2 method 4: σ from lowest standard's replicate SD divided by slope. Approximate; rigorous LOD requires designed blank/spike experiments.</td>}
          </tr>
          {/* LOQ */}
          <tr style={rowS}>
            <td style={labelS}>LOQ (10σ/slope)</td>
            <td style={valueS}>
              {loq != null ? <span><strong>{fmtConc(loq)}</strong>{lowestStandard != null && badge(loqPass, "≤ lowest standard")}</span> : <span style={{color:"#aeaeb2"}}>linear fit only</span>}
            </td>
            {instructor && <td style={noteS}>Q2 method 4: same σ as LOD, ×10. Should be ≤ lowest standard concentration. If LOQ exceeds your lowest standard, that standard is below your method's quantitation limit.</td>}
          </tr>
          {/* Specificity */}
          <tr style={rowS}>
            <td style={labelS}>Specificity</td>
            <td style={valueS}>
              <span style={{color:"#8e9bb5",fontStyle:"italic"}}>Requires interferent / matrix experiments</span>
              {outOfScope()}
            </td>
            {instructor && <td style={noteS}>Q2 specificity must be assessed by running blanks, related substances, degradation products, and matrix samples. This is a designed validation experiment, not computable from a single quantitation run.</td>}
          </tr>
          {/* Robustness */}
          <tr>
            <td style={labelS}>Robustness</td>
            <td style={valueS}>
              <span style={{color:"#8e9bb5",fontStyle:"italic"}}>Requires deliberate variation experiments</span>
              {outOfScope()}
            </td>
            {instructor && <td style={noteS}>Q2 robustness: capacity to remain unaffected by small but deliberate variations in method parameters (incubation time, buffer pH, plate lot, temperature, reagent stability). A separate designed study, not computable from a single run.</td>}
          </tr>
        </tbody>
      </table>
      {!instructor && <div style={{marginTop:10,fontSize:10,color:"#8e9bb5",fontStyle:"italic"}}>Toggle Instructor mode for parameter explanations.</div>}
    </div>
  </details>;
}


// ────────────────────────────────────────────────────────────────────────────
// VALIDATION DESIGNER — wizard for technician-friendly validation experiment design
// ────────────────────────────────────────────────────────────────────────────
//
// The validationTemplates object below is intentionally LAID OUT FOR EDITING.
// Each entry defines one validation test type. To tweak wording or add fields,
// edit the object directly — no other changes needed.
//
// Schema:
//   id              — slug used for save/load
//   label           — display name on Step 1 picker
//   blurb           — one-line description shown on the picker tile
//   fields          — array of input definitions for Step 2
//     {key, label, type ("number"|"select"|"text"|"yesno"), default, helper, options?}
//   wording(values) — fn returning the Step 3 sentence (technician-readable)
//   outputRows(values) — fn returning [{label, value}] rows for Step 4 output table
//   rationale       — instructor-mode "why is the design this way?" explanation
//
// To extend: add a new entry; everything else (wizard flow, Excel export,
// download/upload) automatically picks it up.
// ────────────────────────────────────────────────────────────────────────────
var validationTemplates = {
  rangeFinding: {
    id: "rangeFinding",
    label: "Range-finding / Scouting",
    blurb: "Use first when LLOQ and ULOQ are not known yet",
    fields: [
      {key:"topConc", label:"Highest planned concentration", type:"text", default:"", helper:"Use the highest safe/plausible standard or sample level you can prepare."},
      {key:"nLevels", label:"Number of scouting levels", type:"number", default:10, helper:"8–10 levels gives enough spread to see blank separation and saturation."},
      {key:"dilutionFactor", label:"Serial dilution factor", type:"number", default:3, helper:"3-fold is a good first scout; 2-fold is tighter, 10-fold is broader."},
      {key:"reps", label:"Replicates per level", type:"number", default:2, helper:"Duplicate is enough for scouting; formal validation uses more replicates."}
    ],
    wording: function(v){
      var n = v.nLevels || 10;
      var df = v.dilutionFactor || 3;
      var r = v.reps || 2;
      var top = v.topConc ? " starting at "+v.topConc : "";
      var repWord = r===2?"duplicate":r===3?"triplicate":(r+" replicates");
      return "Prepare a broad "+n+"-point "+df+"-fold serial dilution"+top+" and run each level in "+repWord+". Use the results to estimate provisional LLOQ, ULOQ, and the working calibration range.";
    },
    outputRows: function(v){
      return [
        {label:"What to run", value:(v.nLevels||10)+"-point "+(v.dilutionFactor||3)+"-fold serial dilution series"},
        {label:"Replicates", value:(v.reps||2)+" per level"},
        {label:"What it's for", value:"Find the usable signal window before formal validation"},
        {label:"Statistics needed", value:"Blank separation, saturation check, provisional LLOQ/ULOQ, candidate range"}
      ];
    },
    rationale: "Range-finding is not the formal ICH validation claim. It is the scouting experiment you run first when LLOQ and ULOQ are unknown. The goal is to locate the usable assay window: where signal is separated from blank/noise at the low end and not saturated or nonlinear at the high end. After this, the analyst can set provisional LLOQ/ULOQ and design the formal ICH validation."
  },

  linearity: {
    id: "linearity",
    label: "Linearity",
    blurb: "Confirms response changes predictably with concentration",
    fields: [
      {key:"nLevels", label:"Number of concentration levels", type:"number", default:6, helper:"5–8 is typical. Spread evenly across the assay range."},
      {key:"reps", label:"Replicates per level", type:"number", default:2, helper:"Duplicate is the standard minimum."},
      {key:"rangeLow", label:"Lowest concentration", type:"text", default:"", helper:"In your working units (e.g. 0.1 mg/mL)"},
      {key:"rangeHigh", label:"Highest concentration", type:"text", default:"", helper:"In your working units (e.g. 10 mg/mL)"}
    ],
    wording: function(v){
      var n = v.nLevels || 6;
      var r = v.reps || 2;
      var range = (v.rangeLow && v.rangeHigh) ? " from "+v.rangeLow+" to "+v.rangeHigh : " across the assay range";
      var repWord = r===2?"duplicate":r===3?"triplicate":(r+" replicates");
      return "Prepare a "+n+"-point dilution series"+range+" and run each level in "+repWord+" to assess linearity.";
    },
    outputRows: function(v){
      return [
        {label:"What to run", value:(v.nLevels||6)+" concentration levels covering the assay range"},
        {label:"Replicates", value:(v.reps||2)+" per level"},
        {label:"What it's for", value:"Confirms response changes predictably with concentration"},
        {label:"Statistics needed", value:"Slope, intercept, R², residuals (lack-of-fit if available)"}
      ];
    },
    rationale: "Linearity demonstrates that signal scales proportionally with concentration over the validated range. ICH Q2 recommends a minimum of 5 levels; 6–8 is more robust. Spread levels evenly (or log-spaced for wide-range methods like LC-MS) to avoid leveraging from clumped points."
  },

  accuracy: {
    id: "accuracy",
    label: "Accuracy",
    blurb: "Shows how close results are to the true value",
    fields: [
      {key:"qcLevels", label:"Number of QC levels", type:"select", default:"3", options:["1","2","3","4","5"], helper:"3 (low, mid, high) is the ICH Q2 recommendation."},
      {key:"reps", label:"Replicates per QC", type:"number", default:3, helper:"Triplicate is typical."},
      {key:"matrix", label:"Matrix", type:"text", default:"", helper:"Buffer, plasma, etc. Use the same matrix as your real samples."}
    ],
    wording: function(v){
      var qc = v.qcLevels || "3";
      var r = v.reps || 3;
      var qcDesc = qc==="3"?"low, mid, and high":qc+" levels spanning the assay range";
      var repWord = r===2?"duplicate":r===3?"triplicate":(r+" replicates");
      var matrixPart = v.matrix ? " in "+v.matrix+" matrix" : "";
      return "Prepare QC samples at "+qcDesc+matrixPart+" and run each in "+repWord+". Compare measured vs. nominal concentrations.";
    },
    outputRows: function(v){
      return [
        {label:"What to run", value:(v.qcLevels||"3")+" QC levels at known concentrations"},
        {label:"Replicates", value:(v.reps||3)+" per QC"},
        {label:"What it's for", value:"Shows how close measured results are to true (nominal) values"},
        {label:"Statistics needed", value:"% recovery (measured/nominal × 100) and % bias per QC level"}
      ];
    },
    rationale: "Accuracy is demonstrated by recovering known concentrations within ICH Q2/M10 acceptance: ±15% of nominal (85–115%), or ±20% at LLOQ (80–120%) for bioanalytical methods. Three QC levels (low, mid, high) is the minimum to show accuracy across the range; more levels strengthen the case but add work."
  },

  repeatability: {
    id: "repeatability",
    label: "Repeatability",
    blurb: "Measures same-day, same-analyst precision",
    fields: [
      {key:"qcLevel", label:"QC level concentration", type:"text", default:"", helper:"E.g. mid-level QC. Run a single concentration."},
      {key:"reps", label:"Number of replicates", type:"number", default:5, helper:"5–6 replicates is the ICH Q2 minimum."},
      {key:"independentPreps", label:"Use independent preparations?", type:"yesno", default:"yes", helper:"Yes = each replicate is prepared from scratch (preferred). No = aliquots from one tube."}
    ],
    wording: function(v){
      var conc = v.qcLevel || "the chosen QC level";
      var r = v.reps || 5;
      var prepNote = v.independentPreps==="yes" ? " from independent preparations" : " from the same prepared sample";
      return "Run "+r+" replicates of "+conc+" "+prepNote+" on the same day, same analyst, same instrument.";
    },
    outputRows: function(v){
      return [
        {label:"What to run", value:"Same QC level, "+(v.reps||5)+" replicates"+(v.independentPreps==="yes"?" (independent preps)":" (single prep)")},
        {label:"Replicates", value:(v.reps||5)},
        {label:"What it's for", value:"Measures within-run, within-day precision"},
        {label:"Statistics needed", value:"Mean, standard deviation (SD), %CV"}
      ];
    },
    rationale: "Repeatability is the tightest precision estimate — one analyst, one day, one instrument. Independent preparations capture all sources of within-run variation (pipetting, dilution, signal noise). ICH Q2 acceptance for repeatability CV is typically ≤15% (≤20% at LLOQ)."
  },

  intermediatePrecision: {
    id: "intermediatePrecision",
    label: "Intermediate Precision",
    blurb: "Measures day-to-day or analyst-to-analyst precision",
    fields: [
      {key:"qcLevel", label:"QC level concentration", type:"text", default:"", helper:"E.g. mid-level QC."},
      {key:"reps", label:"Replicates per session", type:"number", default:3, helper:"Triplicate per session is typical."},
      {key:"nDays", label:"Number of days", type:"number", default:3, helper:"Minimum 2; 3–5 is standard."},
      {key:"nAnalysts", label:"Number of analysts", type:"number", default:2, helper:"Minimum 2 to demonstrate inter-analyst variation."}
    ],
    wording: function(v){
      var conc = v.qcLevel || "the QC level";
      var r = v.reps || 3;
      var d = v.nDays || 3;
      var a = v.nAnalysts || 2;
      var repWord = r===2?"duplicate":r===3?"triplicate":(r+" replicates");
      return "Run "+conc+" in "+repWord+" on "+d+" different days using "+a+" different analysts. Combine to assess intermediate precision.";
    },
    outputRows: function(v){
      var totalRuns = (v.reps||3) * (v.nDays||3) * (v.nAnalysts||2);
      return [
        {label:"What to run", value:(v.nDays||3)+" days × "+(v.nAnalysts||2)+" analysts × "+(v.reps||3)+" replicates = "+totalRuns+" total"},
        {label:"Replicates", value:(v.reps||3)+" per session"},
        {label:"What it's for", value:"Measures variability within the same lab across days, analysts, and instruments"},
        {label:"Statistics needed", value:"Within-run CV, between-run CV, total CV (variance components or pooled SD)"}
      ];
    },
    rationale: "Intermediate precision is broader than repeatability — it captures the variation a single lab sees over time. ICH Q2 wants this demonstrated across at least one source of variation (day, analyst, or instrument); covering two or more is stronger. ANOVA-based variance partitioning gives the cleanest read."
  },

  dilutionIntegrity: {
    id: "dilutionIntegrity",
    label: "Dilution Integrity",
    blurb: "Confirms dilution does not bias the result",
    fields: [
      {key:"highConc", label:"High sample concentration", type:"text", default:"", helper:"Above the upper limit of quantitation."},
      {key:"dilutions", label:"Dilution factors to test", type:"text", default:"1:2, 1:5, 1:10", helper:"Comma-separated. Each dilution should land in-range."},
      {key:"reps", label:"Replicates per dilution", type:"number", default:3, helper:"Triplicate."}
    ],
    wording: function(v){
      var conc = v.highConc || "an above-range sample";
      var dils = v.dilutions || "1:2, 1:5, 1:10";
      var r = v.reps || 3;
      var repWord = r===2?"duplicate":r===3?"triplicate":(r+" replicates");
      return "Take "+conc+" and dilute at "+dils+" into the assay range. Run each dilution in "+repWord+" and back-calculate the original concentration.";
    },
    outputRows: function(v){
      return [
        {label:"What to run", value:"High sample diluted at "+(v.dilutions||"1:2, 1:5, 1:10")},
        {label:"Replicates", value:(v.reps||3)+" per dilution"},
        {label:"What it's for", value:"Confirms dilution into range does not introduce bias (parallelism)"},
        {label:"Statistics needed", value:"% recovery after dilution (back-calculated original / known original × 100)"}
      ];
    },
    rationale: "Dilution integrity (also called parallelism) confirms that diluting an above-range sample into range gives the right answer when corrected for dilution. Hook effects, matrix interference, or non-parallelism between sample and standard curve all show up here. ICH M10 acceptance: ±15% recovery (85–115%) at each tested dilution."
  },

  lloq: {
    id: "lloq",
    label: "LLOQ (Lower Limit of Quantitation)",
    blurb: "Confirms the lowest concentration can be measured reliably",
    fields: [
      {key:"lloqConc", label:"Proposed LLOQ concentration", type:"text", default:"", helper:"The lowest concentration you want to validate as quantifiable."},
      {key:"reps", label:"Replicates", type:"number", default:5, helper:"5+ for robust precision/accuracy at LLOQ."},
      {key:"nRuns", label:"Number of runs / days", type:"number", default:3, helper:"Multiple runs strengthen the LLOQ claim."}
    ],
    wording: function(v){
      var conc = v.lloqConc || "the proposed LLOQ";
      var r = v.reps || 5;
      var d = v.nRuns || 3;
      return "Run "+r+" replicates of "+conc+" across "+d+" runs. Verify CV ≤ 20% and accuracy 80–120% to qualify as LLOQ.";
    },
    outputRows: function(v){
      return [
        {label:"What to run", value:"Proposed LLOQ "+(v.lloqConc?"("+v.lloqConc+")":"")+" — "+(v.reps||5)+" reps × "+(v.nRuns||3)+" runs"},
        {label:"Replicates", value:(v.reps||5)+" per run"},
        {label:"What it's for", value:"Confirms the lowest concentration can be measured with acceptable precision and accuracy"},
        {label:"Statistics needed", value:"%CV (≤ 20% pass), %recovery (80–120% pass at LLOQ), pass/fail summary"}
      ];
    },
    rationale: "LLOQ is the lowest concentration where you can quantify reliably (not just detect). ICH Q2 / M10 acceptance is relaxed at LLOQ vs. higher concentrations: ±20% accuracy (80–120%) and ≤20% CV at LLOQ, vs. ±15% accuracy (85–115%) and ≤15% CV elsewhere. Multiple runs on different days strengthen the claim because LLOQ is sensitive to noise."
  },

  spikeRecovery: {
    id: "spikeRecovery",
    label: "Spike Recovery",
    blurb: "Checks matrix effects and recovery in real samples",
    fields: [
      {key:"matrix", label:"Sample matrix", type:"text", default:"", helper:"E.g. plasma, cell lysate, formulation buffer."},
      {key:"spikeLevels", label:"Spike levels", type:"text", default:"low, mid, high", helper:"Concentrations of spike (in your working units)."},
      {key:"reps", label:"Replicates per spike level", type:"number", default:3, helper:"Triplicate."},
      {key:"includeUnspiked", label:"Include unspiked control?", type:"yesno", default:"yes", helper:"Yes = subtract endogenous from spiked. No = assume zero endogenous (only valid for analyte-free matrix)."}
    ],
    wording: function(v){
      var matrix = v.matrix || "the sample matrix";
      var levels = v.spikeLevels || "low, mid, high";
      var r = v.reps || 3;
      var repWord = r===2?"duplicate":r===3?"triplicate":(r+" replicates");
      var unspiked = v.includeUnspiked==="yes" ? ", plus an unspiked control" : "";
      return "Spike known analyte into "+matrix+" at "+levels+" levels in "+repWord+unspiked+". Calculate (spiked − unspiked) / nominal × 100 to assess recovery.";
    },
    outputRows: function(v){
      return [
        {label:"What to run", value:"Spiked "+(v.matrix||"matrix")+" samples at "+(v.spikeLevels||"low, mid, high")+(v.includeUnspiked==="yes"?" + unspiked control":"")},
        {label:"Replicates", value:(v.reps||3)+" per spike level"},
        {label:"What it's for", value:"Checks whether matrix effects bias recovery; validates accuracy in a realistic sample"},
        {label:"Statistics needed", value:"% recovery per spike level (ICH M10 acceptance: ±15% of nominal, i.e. 85–115%)"}
      ];
    },
    rationale: "Spike recovery in real matrix is the gold-standard accuracy check for bioanalytical methods. Including an unspiked control is essential when the matrix may contain endogenous analyte; otherwise recovery is inflated. ICH M10 acceptance: each spike level must individually fall within ±15% of nominal (85–115%) — a single bad spike fails the test."
  }
};

function ValidationDesignerCard(props) {
  var instructor = !!props.instructor;
  // Wizard state
  var _step = useState(1), step = _step[0], setStep = _step[1];
  var _testId = useState(null), testId = _testId[0], setTestId = _testId[1];
  var _values = useState({}), values = _values[0], setValues = _values[1];
  var _planName = useState(""), planName = _planName[0], setPlanName = _planName[1];
  var _runFormat = useState("plate"), runFormat = _runFormat[0], setRunFormat = _runFormat[1];
  var _plateFill = useState("classical"), plateFill = _plateFill[0], setPlateFill = _plateFill[1];

  var template = testId ? validationTemplates[testId] : null;

  // When test type is picked, initialize values from defaults
  var pickTest = function(id){
    setTestId(id);
    var defaults = {};
    validationTemplates[id].fields.forEach(function(f){defaults[f.key] = f.default;});
    setValues(defaults);
    setStep(2);
  };

  var resetWizard = function(){
    setStep(1); setTestId(null); setValues({}); setPlanName("");
  };

  // CSV export — opens natively in Excel/Numbers/Sheets. No library dependency.
  // CSV is more portable than .xlsx and lets the user paste into any spreadsheet tool.
  var downloadCSV = function(){
    if (!template) return;
    var rows = template.outputRows(values);
    var sentence = template.wording(values);
    // CSV escape: wrap in quotes if contains comma/quote/newline; double up internal quotes
    var esc = function(v){
      var s = String(v == null ? "" : v);
      if (s.indexOf(",")>=0 || s.indexOf('"')>=0 || s.indexOf("\n")>=0) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    var lines = [];
    lines.push(esc("Validation Plan: " + template.label));
    lines.push(esc("Generated") + "," + esc(new Date().toISOString().slice(0,10)));
    lines.push("");
    lines.push(esc("Instructions"));
    lines.push(esc(sentence));
    lines.push("");
    lines.push(esc("Plan Details"));
    rows.forEach(function(r){
      lines.push(esc(r.label) + "," + esc(r.value));
    });
    lines.push("");
    lines.push(esc("Inputs"));
    template.fields.forEach(function(f){
      lines.push(esc(f.label) + "," + esc(values[f.key] != null ? values[f.key] : ""));
    });
    if (instructor) {
      lines.push("");
      lines.push(esc("Why this design?"));
      lines.push(esc(template.rationale));
    }
    var csv = lines.join("\n");
    var blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (planName || template.label.replace(/\s/g,"_")) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // JSON download — portable plan file the user can re-upload later
  var downloadPlanJSON = function(){
    if (!template) return;
    var plan = {
      version: "1.0",
      app: "eSSF Curve Validation Designer",
      planName: planName || template.label,
      createdAt: new Date().toISOString(),
      testId: testId,
      testLabel: template.label,
      values: values,
      sentence: template.wording(values),
      outputRows: template.outputRows(values)
    };
    var blob = new Blob([JSON.stringify(plan, null, 2)], {type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (planName || template.label.replace(/\s/g,"_")) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Plan file upload — user picks a previously-downloaded .json
  var uploadPlanJSON = function(e){
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try {
        var plan = JSON.parse(ev.target.result);
        if (!plan.testId || !validationTemplates[plan.testId]) {
          alert("Plan file format not recognized — testId missing or unknown.");
          return;
        }
        setTestId(plan.testId);
        setValues(plan.values || {});
        setPlanName(plan.planName || "");
        setStep(4);  // jump to output view
      } catch(err) {
        alert("Could not read plan file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";  // reset so re-uploading the same file works
  };

  // Copy sentence to clipboard
  var copyText = function(text){
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function(){
        alert("Copied to clipboard.");
      }, function(){
        alert("Could not copy — try selecting and copying manually.");
      });
    } else {
      alert("Clipboard not available — try selecting and copying manually.");
    }
  };

  // ── UI styles (match app conventions) ─────────────────────────────
  var stepLabel = {fontSize:11,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:0.5,marginBottom:8};
  var heading = {fontSize:16,fontWeight:800,color:"#0b2a6f",marginBottom:6};
  var hint = {fontSize:12,color:"#6e6e73",marginBottom:14,lineHeight:1.5};

  // ── Step 1: pick a validation test ─────────────────────────────────
  var renderStep1 = function(){
    var testOrder = ["linearity","accuracy","repeatability","intermediatePrecision","dilutionIntegrity","lloq","spikeRecovery"];
    return <div>
      <div style={stepLabel}>Step 1 of 4</div>
      <div style={heading}>Which validation test do you want to design?</div>
      <p style={hint}>Pick one. You can come back and design others — each plan is saved separately.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:10,marginBottom:18}}>
        {testOrder.map(function(id){
          var t = validationTemplates[id];
          return <button key={id} onClick={function(){pickTest(id);}} style={{textAlign:"left",cursor:"pointer",border:"1px solid #d8dfeb",background:"#fff",borderRadius:12,padding:"14px 16px",fontFamily:"inherit",transition:"all 0.15s"}} onMouseEnter={function(e){e.currentTarget.style.borderColor="#6337b9";e.currentTarget.style.transform="translateY(-1px)";}} onMouseLeave={function(e){e.currentTarget.style.borderColor="#d8dfeb";e.currentTarget.style.transform="translateY(0)";}}>
            <div style={{fontSize:13,fontWeight:800,color:"#0b2a6f",marginBottom:4}}>{t.label}</div>
            <div style={{fontSize:11,color:"#6e6e73",lineHeight:1.4}}>{t.blurb}</div>
          </button>;
        })}
      </div>
      <div style={{padding:"12px 14px",background:"#fafafa",border:"1px dashed #d0d8ea",borderRadius:8}}>
        <div style={{fontSize:11,fontWeight:700,color:"#5a6984",marginBottom:6}}>Or load a saved plan:</div>
        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:11,padding:"6px 12px",background:"#fff",border:"1px solid #d8dfeb",borderRadius:6,fontWeight:600,color:"#30437a"}}>
          📂 Choose plan file (.json)
          <input type="file" accept="application/json,.json" onChange={uploadPlanJSON} style={{display:"none"}} />
        </label>
      </div>
    </div>;
  };

  // ── Step 2: fill in test-specific fields ───────────────────────────
  var renderStep2 = function(){
    if (!template) return null;
    return <div>
      <div style={stepLabel}>Step 2 of 4 — {template.label}</div>
      <div style={heading}>Tell us about your experiment</div>
      <p style={hint}>{template.blurb}. Fill in the fields below — defaults are reasonable starting points.</p>
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:18}}>
        {template.fields.map(function(f){
          var val = values[f.key] != null ? values[f.key] : f.default;
          var setVal = function(v){
            var nv = {};
            for (var k in values) nv[k] = values[k];
            nv[f.key] = v;
            setValues(nv);
          };
          var inputEl = null;
          if (f.type === "number") {
            inputEl = <input type="number" value={val} onChange={function(e){setVal(parseInt(e.target.value)||0);}} style={{padding:"8px 12px",border:"1px solid #d8dfeb",borderRadius:6,fontSize:13,width:120,fontFamily:"inherit"}} />;
          } else if (f.type === "text") {
            inputEl = <input type="text" value={val} placeholder={f.helper} onChange={function(e){setVal(e.target.value);}} style={{padding:"8px 12px",border:"1px solid #d8dfeb",borderRadius:6,fontSize:13,minWidth:240,fontFamily:"inherit"}} />;
          } else if (f.type === "select") {
            inputEl = <select value={val} onChange={function(e){setVal(e.target.value);}} style={{padding:"8px 12px",border:"1px solid #d8dfeb",borderRadius:6,fontSize:13,fontFamily:"inherit",background:"#fff"}}>
              {f.options.map(function(o){return <option key={o} value={o}>{o}</option>;})}
            </select>;
          } else if (f.type === "yesno") {
            inputEl = <select value={val} onChange={function(e){setVal(e.target.value);}} style={{padding:"8px 12px",border:"1px solid #d8dfeb",borderRadius:6,fontSize:13,fontFamily:"inherit",background:"#fff"}}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>;
          }
          return <div key={f.key} style={{padding:"12px 14px",background:"#fafcff",border:"1px solid #e5e9f0",borderRadius:10}}>
            <label style={{display:"block",fontSize:13,fontWeight:700,color:"#30437a",marginBottom:6}}>{f.label}</label>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              {inputEl}
              {f.helper && f.type !== "text" && <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic"}}>{f.helper}</span>}
            </div>
          </div>;
        })}
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
        <button onClick={function(){setStep(1);}} style={{background:"#fff",border:"1px solid #d8dfeb",color:"#5a6984",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"}}>← Back</button>
        <button onClick={function(){setStep(3);}} style={{background:"#6337b9",color:"#fff",border:"none",padding:"8px 20px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>Next →</button>
      </div>
    </div>;
  };

  // ── Step 3: wording preview ────────────────────────────────────────
  var renderStep3 = function(){
    if (!template) return null;
    var sentence = template.wording(values);
    return <div>
      <div style={stepLabel}>Step 3 of 4 — {template.label}</div>
      <div style={heading}>Your experiment instruction</div>
      <p style={hint}>This is the one-line instruction your tech can follow. Review it; if it doesn't read right, go back and adjust.</p>
      <div style={{padding:"18px 20px",background:"linear-gradient(180deg,#f5f0ff,#ede5ff)",border:"1px solid #c7b2e8",borderRadius:12,marginBottom:18}}>
        <div style={{fontSize:11,fontWeight:700,color:"#6337b9",textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Instruction</div>
        <p style={{margin:0,fontSize:14,color:"#0b2a6f",lineHeight:1.6,fontWeight:500}}>{sentence}</p>
      </div>
      {instructor && <div style={{padding:"12px 16px",background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:8,marginBottom:18,fontSize:12,color:"#30437a",lineHeight:1.6}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4,color:"#5a6984"}}>Why this design?</div>
        {template.rationale}
      </div>}
      <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
        <button onClick={function(){setStep(2);}} style={{background:"#fff",border:"1px solid #d8dfeb",color:"#5a6984",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"}}>← Back</button>
        <button onClick={function(){setStep(4);}} style={{background:"#6337b9",color:"#fff",border:"none",padding:"8px 20px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>See full plan →</button>
      </div>
    </div>;
  };

  // ── Step 4: full output table + actions ────────────────────────────
  var renderStep4 = function(){
    if (!template) return null;
    var sentence = template.wording(values);
    var rows = template.outputRows(values);
    return <div>
      <div style={stepLabel}>Step 4 of 4 — {template.label}</div>
      <div style={heading}>Your validation plan</div>
      <p style={hint}>Review, name, and download. The plan file (.json) can be re-uploaded later to revisit or edit.</p>
      {/* Plan name input */}
      <div style={{padding:"12px 14px",background:"#fafcff",border:"1px solid #e5e9f0",borderRadius:10,marginBottom:14}}>
        <label style={{display:"block",fontSize:11,fontWeight:700,color:"#5a6984",textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>Plan name (optional)</label>
        <input type="text" value={planName} placeholder={template.label+" — "+new Date().toISOString().slice(0,10)} onChange={function(e){setPlanName(e.target.value);}} style={{padding:"8px 12px",border:"1px solid #d8dfeb",borderRadius:6,fontSize:13,width:"100%",maxWidth:480,fontFamily:"inherit",boxSizing:"border-box"}} />
      </div>
      {/* Instruction */}
      <div style={{padding:"14px 18px",background:"linear-gradient(180deg,#f5f0ff,#ede5ff)",border:"1px solid #c7b2e8",borderRadius:12,marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:6,flexWrap:"wrap"}}>
          <div style={{fontSize:10,fontWeight:700,color:"#6337b9",textTransform:"uppercase",letterSpacing:0.5}}>Instruction</div>
          <button onClick={function(){copyText(sentence);}} style={{background:"#fff",border:"1px solid #c7b2e8",color:"#6337b9",padding:"4px 10px",borderRadius:6,fontSize:10,fontWeight:600,cursor:"pointer"}}>📋 Copy</button>
        </div>
        <p style={{margin:0,fontSize:14,color:"#0b2a6f",lineHeight:1.6,fontWeight:500}}>{sentence}</p>
      </div>
      {/* Plan details table */}
      <div style={{background:"#fff",border:"1px solid #e5e5ea",borderRadius:12,overflow:"hidden",marginBottom:14}}>
        <div style={{padding:"10px 16px",background:"#fafafa",borderBottom:"1px solid #e5e5ea",fontSize:11,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:0.5}}>Plan details</div>
        <table style={{borderCollapse:"collapse",width:"100%"}}>
          <tbody>
            {rows.map(function(r,i){
              return <tr key={i} style={{borderBottom:i<rows.length-1?"1px solid #f0f0f3":"none"}}>
                <td style={{padding:"10px 16px",fontSize:12,fontWeight:600,color:"#30437a",width:"30%",verticalAlign:"top"}}>{r.label}</td>
                <td style={{padding:"10px 16px",fontSize:12,color:"#1d1d1f",lineHeight:1.5}}>{r.value}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {instructor && <div style={{padding:"12px 16px",background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:8,marginBottom:14,fontSize:12,color:"#30437a",lineHeight:1.6}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4,color:"#5a6984"}}>Why this design?</div>
        {template.rationale}
      </div>}
      {/* Actions */}
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:8}}>
        <button onClick={downloadCSV} style={{background:"#1b7f6a",color:"#fff",border:"none",padding:"10px 16px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>📊 Download as CSV (opens in Excel)</button>
        <button onClick={downloadPlanJSON} style={{background:"#0b2a6f",color:"#fff",border:"none",padding:"10px 16px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>💾 Download plan file (.json)</button>
        <button onClick={resetWizard} style={{background:"#fff",border:"1px solid #d8dfeb",color:"#5a6984",padding:"10px 16px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",marginLeft:"auto"}}>+ New plan</button>
      </div>
      <div style={{padding:"8px 12px",background:"#fafafa",borderRadius:6,fontSize:10,color:"#8e9bb5",lineHeight:1.5}}>
        💡 The plan file (.json) keeps everything — settings, sentence, table — and can be re-uploaded later from Step 1 to revisit or edit. The CSV is a printable summary.
      </div>
    </div>;
  };

  return <div style={{background:"#fff",border:"1px solid "+BORDER,borderRadius:14,padding:"1.5rem",boxShadow:"0 4px 12px rgba(11,42,111,0.04)"}}>
    {/* Header */}
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingBottom:14,borderBottom:"1px solid #f0f0f3"}}>
      <div style={{width:40,height:40,borderRadius:10,background:"#6337b9",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>✓</div>
      <div>
        <div style={{fontSize:15,fontWeight:800,color:"#0b2a6f"}}>Validation Designer</div>
        <div style={{fontSize:11,color:"#6e6e73"}}>Design simple, ICH Q2-aligned validation experiments. One decision per screen.</div>
      </div>
    </div>
    {/* Progress dots */}
    <div style={{display:"flex",gap:6,marginBottom:18}}>
      {[1,2,3,4].map(function(s){
        var active = s===step;
        var done = s<step;
        return <div key={s} style={{flex:1,height:4,borderRadius:2,background:done?"#6337b9":active?"#a989d8":"#e5e9f0",transition:"all 0.15s"}}></div>;
      })}
    </div>
    {/* Step content */}
    {step===1 && renderStep1()}
    {step===2 && renderStep2()}
    {step===3 && renderStep3()}
    {step===4 && renderStep4()}
  </div>;
}


// ────────────────────────────────────────────────────────────────────────────
// FULL VALIDATION PLAN — multi-test wizard with SEL naming + Treatment Groups
// ────────────────────────────────────────────────────────────────────────────
//
// SEL (Standardized Experiment Label) format: [TestPrefix][LevelToken]_[Rep]
//   L  = Linearity         L1_1, L1_2, ..., L6_3
//   AL/AM/AH = Accuracy    AL_1, AM_1, AH_1, ...
//   P  = Repeatability     P_1, P_2, ..., P_5  (single QC level, no level token)
//   IP = Intermediate Prec IP1_1, IP1_2, ..., IPn_r  (n = session = day×analyst index)
//   D  = Dilution Integ    D2_1, D5_1, D10_1  (level token = dilution factor as int)
//   Q  = LLOQ              Q1_1, Q1_5, Q3_5   (level token = run index)
//   SL/SM/SH = Spike Rec   SL_1, SM_1, SH_1, S0_1 (S0 = unspiked control)
//
// Each test's row generator is pure: takes params, returns array of treatment-row
// objects with deterministic SEL values. Future stats engine can match by SEL prefix.
// ────────────────────────────────────────────────────────────────────────────

// Helper: parse a comma-separated list of dilution factors like "1:2, 1:5, 1:10"
// into integer factors [2, 5, 10]. Skips invalid/non-integer entries.
function parseDilutionFactors(s) {
  if (!s) return [];
  var out = [];
  String(s).split(",").forEach(function(part){
    var t = part.trim();
    var m = t.match(/^1\s*[:\/]\s*(\d+)$/);
    if (m) {
      var df = parseInt(m[1]);
      if (df >= 2) out.push(df);
    } else {
      var n = parseInt(t);
      if (!isNaN(n) && n >= 2) out.push(n);
    }
  });
  return out;
}

// Format a number as a concentration string with units (uses sig figs, not exponent).
// Used in Treatment Groups "Nominal concentration" column.
function fmtConcWithUnit(val, unit) {
  if (val == null || !isFinite(val)) return "—";
  var u = unit || "";
  return sig3(val) + (u ? " " + u : "");
}

// Parse a comma- or space-separated rep mix like "3,3,2" or "3 3 2" into [3,3,2].
// Returns {parts: number[], sum: number, valid: boolean, error: string|null}.
// `valid` means: at least one positive integer was parsed and all parsed values are positive integers.
function parseRepMix(s) {
  if (s == null) return {parts:[], sum:0, valid:false, error:"Empty rep mix"};
  var raw = String(s).trim();
  if (raw === "") return {parts:[], sum:0, valid:false, error:"Empty rep mix"};
  var tokens = raw.split(/[,\s]+/).filter(function(t){return t.length>0;});
  if (tokens.length === 0) return {parts:[], sum:0, valid:false, error:"No values"};
  var parts = [];
  for (var i=0; i<tokens.length; i++) {
    var n = parseInt(tokens[i], 10);
    if (!isFinite(n) || n <= 0 || String(n) !== tokens[i]) {
      return {parts:[], sum:0, valid:false, error:"\"" + tokens[i] + "\" is not a positive integer"};
    }
    parts.push(n);
  }
  var sum = parts.reduce(function(a,b){return a+b;}, 0);
  return {parts:parts, sum:sum, valid:true, error:null};
}

function testColor(test) {
  var m = {
    "Range-finding":"#8E6BE8",
    "Linearity":"#139CB6",
    "Accuracy":"#2E7D32",
    "Repeatability":"#0B63CE",
    "Intermediate Precision":"#6337B9",
    "Dilution Integrity":"#BF7A20",
    "LLOQ":"#C44569",
    "Spike Recovery":"#0F8AA2"
  };
  return m[test] || "#6f7fa0";
}

// Per-test row generators. Each returns an array of treatment rows:
//   {sel, humanLabel, test, level, nominal, replicate, prepType, purpose}
// Each row = one prepared sample (one tube/well in the bench setup).
var validationTreatmentGenerators = {
  rangeFinding: function(params, unit) {
    var rows = [];
    var n = parseInt(params.nLevels) || 10;
    var reps = parseInt(params.reps) || 2;
    var df = parseFloat(params.dilutionFactor) || 3;
    var top = parseFloat(params.topConc);
    if (!isFinite(df) || df <= 1) df = 3;
    for (var i = 0; i < n; i++) {
      var levelNum = i + 1;
      var c = isFinite(top) && top > 0 ? top / Math.pow(df, i) : null;
      var concStr = c != null ? fmtConcWithUnit(c, unit) : (levelNum===1 ? "(highest planned)" : "Level "+levelNum+" from "+df+"-fold series");
      for (var r = 1; r <= reps; r++) {
        rows.push({
          sel: "F" + levelNum + "_" + r,
          humanLabel: "Range-finding Level " + levelNum + " replicate " + r,
          test: "Range-finding",
          level: "Scout level " + levelNum,
          nominal: concStr,
          replicate: r,
          prepType: levelNum===1 ? "Prepare highest level" : df + "-fold serial dilution",
          purpose: "Find usable range"
        });
      }
    }
    return rows;
  },

  linearity: function(params, unit) {
    var rows = [];
    var n = parseInt(params.nLevels) || 6;
    var reps = parseInt(params.reps) || 2;
    var lo = parseFloat(params.rangeLow);
    var hi = parseFloat(params.rangeHigh);
    if (!isFinite(lo) || !isFinite(hi) || lo<=0 || hi<=lo) return rows;
    // Log-spaced if range spans >1 decade, otherwise linear-spaced
    var spanLog = Math.log10(hi/lo) > 1;
    var concs = [];
    for (var i = 0; i < n; i++) {
      var frac = n>1 ? i/(n-1) : 0;
      var c = spanLog
        ? lo * Math.pow(hi/lo, frac)
        : lo + (hi-lo) * frac;
      concs.push(c);
    }
    var prepStyle = params.prepStyle || "discrete";
    var prepLabel = prepStyle==="discrete" ? "Independent discrete prep from stock" : (prepStyle==="oneStep" ? "One-step dilution from stock" : "Serial dilution from prior level");
    concs.forEach(function(c, idx){
      var levelNum = idx + 1;
      for (var r = 1; r <= reps; r++) {
        rows.push({
          sel: "L" + levelNum + "_" + r,
          humanLabel: "Linearity Level " + levelNum + " (" + fmtConcWithUnit(c, unit) + ") replicate " + r,
          test: "Linearity",
          level: "Level " + levelNum,
          nominal: fmtConcWithUnit(c, unit),
          replicate: r,
          prepType: prepStyle==="serial" && idx===0 ? "Prepare from stock" : prepLabel,
          purpose: "Curve level"
        });
      }
    });
    return rows;
  },

  accuracy: function(params, unit) {
    var rows = [];
    var levels = (params.qcLevels || "L,M,H").split(",").map(function(s){return s.trim();}).filter(Boolean);
    var reps = parseInt(params.reps) || 3;
    // Try to parse user-typed concentrations for L/M/H if provided
    var concMap = {
      L: parseFloat(params.qcLow),
      M: parseFloat(params.qcMid),
      H: parseFloat(params.qcHigh)
    };
    levels.forEach(function(lv){
      var conc = concMap[lv];
      var concStr = isFinite(conc) ? fmtConcWithUnit(conc, unit) : "(set by user)";
      for (var r = 1; r <= reps; r++) {
        rows.push({
          sel: "A" + lv + "_" + r,
          humanLabel: "Accuracy QC " + (lv==="L"?"Low":lv==="M"?"Mid":"High") + " replicate " + r,
          test: "Accuracy",
          level: lv==="L"?"Low":lv==="M"?"Mid":"High",
          nominal: concStr,
          replicate: r,
          prepType: "Independent preparation from stock",
          purpose: "Bias / recovery"
        });
      }
    });
    return rows;
  },

  repeatability: function(params, unit) {
    var rows = [];
    var reps = parseInt(params.reps) || 5;
    var conc = parseFloat(params.qcLevel);
    var concStr = isFinite(conc) ? fmtConcWithUnit(conc, unit) : (params.qcLevel || "(set by user)");
    var indep = params.independentPreps !== "no";
    for (var r = 1; r <= reps; r++) {
      rows.push({
        sel: "P_" + r,
        humanLabel: "Repeatability replicate " + r,
        test: "Repeatability",
        level: "Single QC",
        nominal: concStr,
        replicate: r,
        prepType: indep ? "Independent preparation" : "Aliquot from one prep",
        purpose: "Within-run CV"
      });
    }
    return rows;
  },

  intermediatePrecision: function(params, unit) {
    var rows = [];
    var reps = parseInt(params.reps) || 3;
    var nDays = parseInt(params.nDays) || 3;
    var nAnalysts = parseInt(params.nAnalysts) || 2;
    var conc = parseFloat(params.qcLevel);
    var concStr = isFinite(conc) ? fmtConcWithUnit(conc, unit) : (params.qcLevel || "(set by user)");
    // Sessions = day × analyst combinations, indexed 1..N
    var sessionIdx = 0;
    for (var d = 1; d <= nDays; d++) {
      for (var a = 1; a <= nAnalysts; a++) {
        sessionIdx++;
        for (var r = 1; r <= reps; r++) {
          rows.push({
            sel: "IP" + sessionIdx + "_" + r,
            humanLabel: "Intermediate Precision Day "+d+" Analyst "+a+" replicate " + r,
            test: "Intermediate Precision",
            level: "Session "+sessionIdx+" (D"+d+" A"+a+")",
            nominal: concStr,
            replicate: r,
            prepType: "Independent preparation per session",
            purpose: "Between-run CV"
          });
        }
      }
    }
    return rows;
  },

  dilutionIntegrity: function(params, unit) {
    var rows = [];
    var dfs = parseDilutionFactors(params.dilutions);
    if (dfs.length === 0) dfs = [2, 5, 10];
    var reps = parseInt(params.reps) || 3;
    var hi = parseFloat(params.highConc);
    var hiStr = isFinite(hi) ? fmtConcWithUnit(hi, unit) : (params.highConc || "(above-range sample)");
    dfs.forEach(function(df){
      var diluted = isFinite(hi) ? fmtConcWithUnit(hi/df, unit) : "—";
      for (var r = 1; r <= reps; r++) {
        rows.push({
          sel: "D" + df + "_" + r,
          humanLabel: "Dilution 1:" + df + " replicate " + r,
          test: "Dilution Integrity",
          level: "1:" + df + " of " + hiStr,
          nominal: diluted,
          replicate: r,
          prepType: "Dilute from high sample",
          purpose: "Dilution bias"
        });
      }
    });
    return rows;
  },

  lloq: function(params, unit) {
    var rows = [];
    var reps = parseInt(params.reps) || 5;
    var nRuns = parseInt(params.nRuns) || 3;
    var conc = parseFloat(params.lloqConc);
    var concStr = isFinite(conc) ? fmtConcWithUnit(conc, unit) : (params.lloqConc || "(set by user)");
    for (var run = 1; run <= nRuns; run++) {
      for (var r = 1; r <= reps; r++) {
        rows.push({
          sel: "Q" + run + "_" + r,
          humanLabel: "LLOQ Run " + run + " replicate " + r,
          test: "LLOQ",
          level: "Run " + run,
          nominal: concStr,
          replicate: r,
          prepType: "Independent preparation per run",
          purpose: "LLOQ confirmation"
        });
      }
    }
    return rows;
  },

  spikeRecovery: function(params, unit) {
    var rows = [];
    var levels = (params.spikeLevels || "L,M,H").split(",").map(function(s){return s.trim();}).filter(Boolean);
    var reps = parseInt(params.reps) || 3;
    var includeUnspiked = params.includeUnspiked !== "no";
    var matrix = params.matrix || "matrix";
    var concMap = {
      L: parseFloat(params.spikeLow),
      M: parseFloat(params.spikeMid),
      H: parseFloat(params.spikeHigh)
    };
    if (includeUnspiked) {
      for (var r0 = 1; r0 <= reps; r0++) {
        rows.push({
          sel: "S0_" + r0,
          humanLabel: "Unspiked " + matrix + " control replicate " + r0,
          test: "Spike Recovery",
          level: "Unspiked",
          nominal: "0",
          replicate: r0,
          prepType: matrix + " (no spike)",
          purpose: "Unspiked baseline"
        });
      }
    }
    levels.forEach(function(lv){
      var conc = concMap[lv];
      var concStr = isFinite(conc) ? fmtConcWithUnit(conc, unit) : "(set by user)";
      for (var r = 1; r <= reps; r++) {
        rows.push({
          sel: "S" + lv + "_" + r,
          humanLabel: "Spiked " + matrix + " " + (lv==="L"?"Low":lv==="M"?"Mid":"High") + " replicate " + r,
          test: "Spike Recovery",
          level: "Spike " + (lv==="L"?"Low":lv==="M"?"Mid":"High"),
          nominal: concStr,
          replicate: r,
          prepType: matrix + " + analyte spike",
          purpose: "Spike recovery"
        });
      }
    });
    return rows;
  }
};

// Stats Map — what the future analyzer will compute from each test's data, keyed by SEL prefix.
// This is forward-looking: declares the analytical contract for the import-and-auto-analyze
// pipeline that doesn't exist yet. Edit this object to extend the contract.
var validationStatsMap = {
  rangeFinding:          { prefix: "F",  stats: "blank separation, saturation/nonlinearity check, provisional LLOQ, provisional ULOQ, candidate calibration range" },
  linearity:             { prefix: "L",  stats: "slope, intercept, R², residuals, back-calculated concentration, % bias per level" },
  accuracy:              { prefix: "AL/AM/AH", stats: "% recovery and % bias per QC level (mean across replicates)" },
  repeatability:         { prefix: "P",  stats: "mean, SD, %CV across replicates" },
  intermediatePrecision: { prefix: "IP", stats: "within-session CV, between-session CV, total CV (variance components)" },
  dilutionIntegrity:     { prefix: "D",  stats: "% recovery after dilution per dilution factor; %CV across replicates" },
  lloq:                  { prefix: "Q",  stats: "mean, SD, %CV per run; pooled accuracy and precision; pass/fail vs LLOQ acceptance (80–120%, ≤20% CV)" },
  spikeRecovery:         { prefix: "SL/SM/SH (S0 = unspiked)", stats: "% recovery per spike level after subtracting unspiked baseline; pass/fail vs ±15% (85–115%) per ICH M10" }
};

// ICH-aligned recommended prep style per test. Per ICH M10:
//   - Calibration standards (linearity) MAY use serial dilution
//   - QC samples (accuracy, repeatability, IP, LLOQ) SHOULD use independent preparations
//   - Dilution integrity REQUIRES independent dilution series
//   - Spike recovery: spike from independent stock into matrix
var ICH_PREP_GUIDANCE = {
  rangeFinding:          {recommended:"serial",     note:"Serial dilution is fine for scouting (this is not formal validation)."},
  linearity:             {recommended:"discrete",   note:"Independent preparations are stronger evidence for validation; serial dilution is acceptable for routine calibration. ICH Q2(R2) does not mandate either."},
  accuracy:              {recommended:"discrete",   note:"ICH M10 requires QC samples to be prepared INDEPENDENTLY from calibration standards — confirms calibration prep errors don't propagate to QCs."},
  repeatability:         {recommended:"discrete",   note:"Independent preparations of the same QC level — multiple preps are required to capture between-prep variability, not just instrument noise."},
  intermediatePrecision: {recommended:"discrete",   note:"Independent preparations across days/analysts; reusing one stock across sessions defeats the purpose."},
  dilutionIntegrity:     {recommended:"discrete",   note:"ICH M10 §4.3 requires INDEPENDENT dilution series — diluting from a serial chain would couple all dilution factors."},
  lloq:                  {recommended:"discrete",   note:"LLOQ samples are QC-style — prepare independently from calibration standards. Multiple runs strengthen the claim."},
  spikeRecovery:         {recommended:"discrete",   note:"Spike from a separate stock into independent matrix aliquots. Include unspiked controls to subtract endogenous analyte."}
};

// Pure helper: compute dilution recipe for a set of treatment-group rows.
//   rows: [{level, nominal, sel}] from a generator
//   prepStyle: "serial" | "discrete" | "oneStep"
//   stockNum: stock concentration (number, in same unit as nominals)
//   Vf_uL: final volume per replicate, in µL
// Returns null if inputs invalid; otherwise {mode, steps, levels, suggestedStock, hasPrecisionWarn}.
// Always includes 10% pipetting waste (floor 50 µL). Both DilutionRecipeCard's UI
// render and the CSV exporter call this so the two stay synchronized.
function computeDilutionRecipe(rows, prepStyle, stockNum, Vf_uL) {
  // Collect distinct (level, nominal) pairs
  var levels = [];
  var seen = {};
  rows.forEach(function(r){
    var num = parseFloat(r.nominal);
    if (!isFinite(num) || num <= 0) return;
    if (seen[r.level]) return;
    seen[r.level] = true;
    levels.push({level:r.level, nominal:num});
  });
  if (levels.length === 0) return null;
  // Reps per level
  var repsPerLevel = {};
  rows.forEach(function(r){
    var num = parseFloat(r.nominal);
    if (!isFinite(num) || num <= 0) return;
    repsPerLevel[r.level] = (repsPerLevel[r.level] || 0) + 1;
  });
  var sortedDesc = levels.slice().sort(function(a,b){return b.nominal - a.nominal;});
  var maxConc = sortedDesc[0].nominal;
  var suggestedStock = (2 * maxConc).toPrecision(3);

  if (!isFinite(stockNum) || stockNum <= 0 || !isFinite(Vf_uL) || Vf_uL <= 0) {
    return {mode:null, steps:[], levels:sortedDesc, suggestedStock:suggestedStock, hasPrecisionWarn:false};
  }

  var hasPrecisionWarn = false;
  var classify = function(aliquot, total){
    var pct = (aliquot / total) * 100;
    if (pct < 5) { hasPrecisionWarn = true; return "low (aliquot <5%)"; }
    if (pct > 50) { hasPrecisionWarn = true; return "low (aliquot >50%)"; }
    return "ok";
  };

  if (prepStyle === "serial") {
    var carrySteps = [];
    var nLvl = sortedDesc.length;
    for (var i = 0; i < nLvl; i++) {
      var thisLvl = sortedDesc[i];
      var nReps = repsPerLevel[thisLvl.level] || 1;
      var Vneed = Vf_uL * nReps;
      var carryToNext = 0;
      // Carry forward enough for ALL downstream steps (overestimate but safe)
      for (var j = i; j < nLvl - 1; j++) {
        var lvlJ = sortedDesc[j];
        var lvlJp1 = sortedDesc[j+1];
        var carryAtJ = lvlJp1.nominal * Vf_uL * (repsPerLevel[lvlJp1.level] || 1) / lvlJ.nominal;
        carryToNext += carryAtJ;
      }
      var Vtotal = Vneed + carryToNext + Math.max(50, 0.1 * Vneed);
      var sourceConc = i === 0 ? stockNum : sortedDesc[i-1].nominal;
      var sourceLabel = i === 0 ? "Stock (" + stockNum + ")" : "Level " + i + " (" + sortedDesc[i-1].level + ")";
      var aliquot = thisLvl.nominal * Vtotal / sourceConc;
      var diluent = Vtotal - aliquot;
      var precision = classify(aliquot, Vtotal);
      carrySteps.push({
        step: i+1, level: thisLvl.level, targetC: thisLvl.nominal,
        source: sourceLabel,
        aliquot_uL: aliquot, diluent_uL: diluent, total_uL: Vtotal,
        aliquotPct: (aliquot / Vtotal) * 100, precision: precision
      });
    }
    return {mode:"serial", steps:carrySteps, levels:sortedDesc, suggestedStock:suggestedStock, hasPrecisionWarn:hasPrecisionWarn};
  } else {
    // Independent / one-step
    var indSteps = sortedDesc.map(function(lvl){
      var nReps = repsPerLevel[lvl.level] || 1;
      var Vtot = Vf_uL * nReps + Math.max(50, 0.1 * Vf_uL * nReps);
      var aliquot = lvl.nominal * Vtot / stockNum;
      var diluent = Vtot - aliquot;
      var precision = classify(aliquot, Vtot);
      return {
        level: lvl.level, targetC: lvl.nominal,
        source: "Stock",
        aliquot_uL: aliquot, diluent_uL: diluent, total_uL: Vtot,
        aliquotPct: (aliquot / Vtot) * 100, precision: precision
      };
    });
    return {mode:"independent", steps:indSteps, levels:sortedDesc, suggestedStock:suggestedStock, hasPrecisionWarn:hasPrecisionWarn};
  }
}

// Format a volume in µL into a readable string with appropriate units.
function fmtVolUL(uL) {
  if (uL == null || !isFinite(uL)) return "—";
  if (uL >= 1000) return (uL/1000).toFixed(2) + " mL";
  if (uL >= 100) return uL.toFixed(0) + " µL";
  if (uL >= 10) return uL.toFixed(1) + " µL";
  return uL.toFixed(2) + " µL";
}

// Component: per-test inline collapsible recipe card.
// Renders ICH guidance + recipe table (aliquot + diluent per level) given user-provided stock conc and final volume.
function DilutionRecipeCard(props) {
  var testId = props.testId;
  var rows = props.rows || [];
  var unit = props.unit || "";
  var prepStyle = props.prepStyle || "discrete";
  var instructor = !!props.instructor;

  var _open = useState(false), open = _open[0], setOpen = _open[1];

  // Find max conc for the suggested-stock pre-fill
  var maxConcForSuggestion = 0;
  rows.forEach(function(r){
    var num = parseFloat(r.nominal);
    if (isFinite(num) && num > maxConcForSuggestion) maxConcForSuggestion = num;
  });
  var suggestedStock = maxConcForSuggestion > 0 ? (2 * maxConcForSuggestion).toPrecision(3) : "";

  // Pre-fill stock with the suggested value so the recipe just works on first open.
  // User can override if they have a different stock on hand. Stock unit is always the
  // assay unit (no unit conversion in this card — keep it dead simple).
  var _stock = useState(suggestedStock), stock = _stock[0], setStock = _stock[1];
  var _finalVol = useState("1.0"), finalVol = _finalVol[0], setFinalVol = _finalVol[1];
  var _finalVolUnit = useState("mL"), finalVolUnit = _finalVolUnit[0], setFinalVolUnit = _finalVolUnit[1];

  // Convert final volume to µL for arithmetic
  var Vf_uL = (function(){
    var vf = parseFloat(finalVol);
    if (!isFinite(vf) || vf <= 0) return null;
    return finalVolUnit === "mL" ? vf * 1000 : vf;
  })();

  var stockNum = parseFloat(stock);

  // Compute the recipe using the shared helper (kept in sync with CSV export).
  var computed = computeDilutionRecipe(rows, prepStyle, stockNum, Vf_uL);
  // computed is null if rows have no valid concentrations; otherwise has {mode, steps, levels, ...}.
  // mode is null if stock or Vf_uL invalid (in that case steps is empty).
  var levels = (computed && computed.levels) || [];
  var recipe = (computed && computed.mode) ? computed : null;

  var fmtVol = fmtVolUL;

  var guidance = ICH_PREP_GUIDANCE[testId] || {};
  var inputS = {padding:"6px 9px",borderRadius:6,border:"1px solid #d8dfeb",fontSize:12,fontFamily:"inherit"};
  var thS = {padding:"6px 8px",fontSize:10,fontWeight:700,color:"#30437a",textTransform:"uppercase",letterSpacing:0.4,textAlign:"left",borderBottom:"2px solid #d8dfeb",background:"#fafafa",whiteSpace:"nowrap"};
  var tdS = {padding:"6px 8px",fontSize:11,color:"#1d1d1f",borderBottom:"1px solid #f0f0f3",verticalAlign:"top"};

  return <div style={{background:"#fff",border:"1px solid #e5e5ea",borderRadius:10,overflow:"hidden",marginBottom:10}}>
    <button type="button" onClick={function(){setOpen(!open);}} style={{width:"100%",padding:"9px 14px",background:open?"#f5f9fd":"#fff",border:"none",borderBottom:open?"1px solid #e5e9f0":"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,textAlign:"left",fontFamily:"inherit"}}>
      <span style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:13}}>{open?"▾":"▸"}</span>
        <span style={{fontSize:12,fontWeight:700,color:"#0b2a6f"}}>Dilution recipe — {props.testLabel}</span>
        <span style={{fontSize:10,color:"#8e9bb5",fontStyle:"italic"}}>{levels.length} level{levels.length===1?"":"s"}</span>
      </span>
      <span style={{fontSize:10,color:"#5a6984"}}>{open?"hide":"show"}</span>
    </button>
    {open && <div style={{padding:"12px 14px"}}>
      {/* ICH guidance line */}
      <div style={{padding:"8px 11px",background: prepStyle===guidance.recommended ? "#eff7ee" : "#fff7e8",border:"1px solid "+(prepStyle===guidance.recommended ? "#cfe5cf" : "#f0d6a0"),borderRadius:6,fontSize:11,color: prepStyle===guidance.recommended ? "#1b5e20" : "#8a6420",marginBottom:11,lineHeight:1.5}}>
        <strong>{prepStyle===guidance.recommended ? "✓ Matches ICH recommendation." : "⚠ ICH recommends a different prep style."}</strong>{" "}
        {guidance.note}
      </div>

      {/* Inputs: stock conc + final volume (simplified: stock pre-filled with suggested, no unit choice, no waste toggle) */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:11}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#5a6984",marginBottom:4}}>Stock concentration</div>
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            <input type="text" value={stock} onChange={function(e){setStock(e.target.value);}} style={Object.assign({},inputS,{width:"100%"})} />
            <span style={{fontSize:11,color:"#5a6984",fontWeight:600,whiteSpace:"nowrap"}}>{unit}</span>
          </div>
          <div style={{fontSize:10,color:"#6337b9",marginTop:3,fontStyle:"italic"}}>{(parseFloat(stock) === parseFloat(suggestedStock)) ? "suggested: 2× highest level" : "custom (suggested: "+suggestedStock+" "+unit+")"}</div>
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#5a6984",marginBottom:4}}>Final volume per replicate</div>
          <div style={{display:"flex",gap:4}}>
            <input type="text" value={finalVol} onChange={function(e){setFinalVol(e.target.value);}} placeholder="1.0" style={Object.assign({},inputS,{width:"100%"})} />
            <select value={finalVolUnit} onChange={function(e){setFinalVolUnit(e.target.value);}} style={Object.assign({},inputS,{width:60,background:"#fff"})}>
              <option value="mL">mL</option>
              <option value="uL">µL</option>
            </select>
          </div>
          <div style={{fontSize:10,color:"#8e9bb5",marginTop:3,fontStyle:"italic"}}>Includes 10% pipetting waste.</div>
        </div>
      </div>

      {/* Recipe table */}
      {recipe && <div>
        {recipe.mode === "serial" ? (
          <div>
            <div style={{fontSize:11,color:"#5a6984",marginBottom:7,lineHeight:1.5}}>
              <strong>Serial dilution chain.</strong> Prepare highest level first by diluting stock; then carry forward into each successive level.
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%",minWidth:640}}>
                <thead><tr>
                  <th style={thS}>Step</th>
                  <th style={thS}>Level</th>
                  <th style={thS}>Target conc</th>
                  <th style={thS}>Source</th>
                  <th style={thS}>Aliquot from source</th>
                  <th style={thS}>Diluent</th>
                  <th style={thS}>Total volume</th>
                </tr></thead>
                <tbody>
                  {recipe.steps.map(function(s,i){
                    var rowBg = s.precision !== "ok" ? "#fff7e8" : "transparent";
                    var srcWithUnit = s.source.replace(/^Stock \(([^)]+)\)$/, "Stock ($1 "+unit+")");
                    return <tr key={i} style={{background:rowBg}}>
                      <td style={Object.assign({},tdS,{fontWeight:700})}>{s.step}</td>
                      <td style={tdS}>{s.level}</td>
                      <td style={tdS}>{s.targetC.toPrecision(3)} {unit}</td>
                      <td style={Object.assign({},tdS,{fontSize:10,color:"#5a6984"})}>{srcWithUnit}</td>
                      <td style={Object.assign({},tdS,{fontWeight:700,color:"#0b2a6f"})}>{fmtVol(s.aliquot_uL)}</td>
                      <td style={Object.assign({},tdS,{fontWeight:700,color:"#0b2a6f"})}>{fmtVol(s.diluent_uL)}</td>
                      <td style={tdS}>{fmtVol(s.total_uL)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div>
            <div style={{fontSize:11,color:"#5a6984",marginBottom:7,lineHeight:1.5}}>
              <strong>Independent preparations.</strong> Prepare each level directly from the stock — no shared dilution chain.
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%",minWidth:560}}>
                <thead><tr>
                  <th style={thS}>Level</th>
                  <th style={thS}>Target conc</th>
                  <th style={thS}>Aliquot from stock</th>
                  <th style={thS}>Diluent</th>
                  <th style={thS}>Total to prepare</th>
                </tr></thead>
                <tbody>
                  {recipe.steps.map(function(s,i){
                    var rowBg = s.precision !== "ok" ? "#fff7e8" : "transparent";
                    return <tr key={i} style={{background:rowBg}}>
                      <td style={tdS}>{s.level}</td>
                      <td style={tdS}>{s.targetC.toPrecision(3)} {unit}</td>
                      <td style={Object.assign({},tdS,{fontWeight:700,color:"#0b2a6f"})}>{fmtVol(s.aliquot_uL)}</td>
                      <td style={Object.assign({},tdS,{fontWeight:700,color:"#0b2a6f"})}>{fmtVol(s.diluent_uL)}</td>
                      <td style={tdS}>{fmtVol(s.total_uL)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Precision warnings */}
        {recipe.steps.some(function(s){return s.precision !== "ok";}) && <div style={{marginTop:9,padding:"8px 11px",background:"#fff7e8",border:"1px solid #f0d6a0",borderRadius:6,fontSize:10,color:"#8a6420",lineHeight:1.5}}>
          <strong>Pipetting precision warning.</strong> One or more aliquots are below 5% or above 50% of total volume — outside the typical accurate-pipetting range. {recipe.steps.some(function(s){return s.aliquotPct < 5;}) && "Try a more concentrated stock to increase low-end aliquots. "}{recipe.steps.some(function(s){return s.aliquotPct > 50;}) && "Try a less concentrated stock for the highest level."}
        </div>}

        {instructor && <div style={{marginTop:11,padding:"9px 12px",background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:6,fontSize:11,color:"#30437a",lineHeight:1.6}}>
          <strong>Math.</strong> Aliquot = (target conc × total volume) / stock conc. Diluent = total volume − aliquot. For independent preps, each level is computed separately from stock. For serial preps, level 1 dilutes stock → C₁; level i (i≥2) carries forward from level i−1 with carryVol = C<sub>i</sub> × V<sub>total</sub> / C<sub>i−1</sub>.
        </div>}
      </div>}

      {!recipe && <div style={{padding:"10px 12px",background:"#f4f7fb",border:"1px solid #e5e9f0",borderRadius:6,fontSize:11,color:"#5a6984",fontStyle:"italic"}}>
        Enter both a stock concentration and a final volume to compute the recipe.
      </div>}
    </div>}
  </div>;
}

function FullValidationPlanCard(props) {
  var instructor = !!props.instructor;
  var unit = props.unit || "ng/mL";

  // ── Wizard state ──────────────────────────────────────────────────
  // step: 1 = pick tests, 2 = configure each test (looped), 3 = output
  var _step = useState(1), step = _step[0], setStep = _step[1];
  var _selected = useState({}), selected = _selected[0], setSelected = _selected[1];  // {testId: true/false}
  var _testParams = useState({}), testParams = _testParams[0], setTestParams = _testParams[1];  // {testId: {field: value}}
  var _testIdx = useState(0), testIdx = _testIdx[0], setTestIdx = _testIdx[1];  // which test we're configuring in step 2
  var _planName = useState(""), planName = _planName[0], setPlanName = _planName[1];
  // Tracks which fields have been explicitly unlocked for editing. Keyed "testId:fieldKey".
  var _unlockedFields = useState({}), unlockedFields = _unlockedFields[0], setUnlockedFields = _unlockedFields[1];
  // Treatment Groups table view filter: "all" or one of the test ids
  var _tableView = useState("all"), tableView = _tableView[0], setTableView = _tableView[1];
  var _runFormat = useState("plate"), runFormat = _runFormat[0], setRunFormat = _runFormat[1];
  var _plateFill = useState("rows"), plateFill = _plateFill[0], setPlateFill = _plateFill[1];
  // Outer Dilution Recipes panel — collapsed by default (it's a secondary deliverable)
  var _recipesOpen = useState(false), recipesOpen = _recipesOpen[0], setRecipesOpen = _recipesOpen[1];

  var TEST_ORDER = ["rangeFinding","linearity","accuracy","repeatability","intermediatePrecision","dilutionIntegrity","lloq","spikeRecovery"];
  var TEST_LABELS = {
    rangeFinding:"Range-finding",
    linearity:"Linearity", accuracy:"Accuracy", repeatability:"Repeatability",
    intermediatePrecision:"Intermediate Precision", dilutionIntegrity:"Dilution Integrity",
    lloq:"LLOQ", spikeRecovery:"Spike Recovery"
  };

  var selectedIds = TEST_ORDER.filter(function(id){return selected[id];});

  // Auto-derive linearity range from a target concentration (80% to 120% of target)
  // when user hasn't explicitly typed low/high. Implemented as a helper called from Step 2.
  var deriveLinearityRange = function(target){
    var t = parseFloat(target);
    if (!isFinite(t) || t <= 0) return null;
    return {low: (0.8 * t).toFixed(3), high: (1.2 * t).toFixed(3)};
  };

  // Auto-derive Accuracy QC concentrations.
  // If a proposed LLOQ/ULOQ-style range is known, use the ICH M10 QC-placement convention:
  //   Low (LQC)  = 3× LLOQ (range low)
  //   Mid (MQC)  = midpoint of range
  //   High (HQC) = ~80% of ULOQ (range high)
  // If only a target concentration is known, propose a fit-for-purpose pre-validation range:
  //   Low = target / sqrt(10), Mid = target, High = target * sqrt(10).
  // This is a log-symmetric 10-fold window centered on the target.
  // That is not a formal LLOQ/ULOQ claim; it is a qualification starting point.
  // Returns {low, mid, high} as formatted strings, or null if cannot derive.
  var deriveAccuracyQCs = function(){
    var linP = testParams.linearity;
    var accP = testParams.accuracy;
    var lo = null, hi = null;
    var fromKnownRange = false;
    var targetDerivedLinearity = false;
    if (accP && accP.knowsRange === "yes" && accP.lloq && accP.uloq) {
      lo = parseFloat(accP.lloq);
      hi = parseFloat(accP.uloq);
      fromKnownRange = true;
    } else if (linP && linP.rangeLow && linP.rangeHigh) {
      lo = parseFloat(linP.rangeLow);
      hi = parseFloat(linP.rangeHigh);
      fromKnownRange = true;
      if (linP.target) {
        var autoLin = deriveLinearityRange(linP.target);
        var autoLo = autoLin ? parseFloat(autoLin.low) : NaN;
        var autoHi = autoLin ? parseFloat(autoLin.high) : NaN;
        targetDerivedLinearity = isFinite(autoLo) && isFinite(autoHi) &&
          Math.abs(lo-autoLo) <= Math.max(1e-9, Math.abs(autoLo)*1e-6) &&
          Math.abs(hi-autoHi) <= Math.max(1e-9, Math.abs(autoHi)*1e-6) &&
          !isUnlocked("linearity","rangeLow") &&
          !isUnlocked("linearity","rangeHigh");
      }
    } else if (linP && linP.target) {
      var linD = deriveLinearityRange(linP.target);
      if (linD) {
        lo = parseFloat(linD.low);
        hi = parseFloat(linD.high);
        targetDerivedLinearity = true;
      }
    }
    if (targetDerivedLinearity && linP && linP.target) {
      var targetT = parseFloat(linP.target);
      if (isFinite(targetT) && targetT > 0) {
      var spreadT = accSpreadFactor(accP && accP.qcSpread);
        return {low: (targetT / spreadT).toPrecision(3), mid: targetT.toPrecision(3), high: (targetT * spreadT).toPrecision(3), mode:"target"};
      }
    }
    if (!isFinite(lo) || !isFinite(hi) || lo<=0 || hi<=lo) {
      // Fall back to accuracy's own target field if linearity range is unavailable.
      // This is a fit-for-purpose qualification proposal: a 10-fold window around target.
      var t = accP ? parseFloat(accP.target) : NaN;
      if (!isFinite(t) || t <= 0) return null;
      var spread = accSpreadFactor(accP && accP.qcSpread);
      return {low: (t / spread).toPrecision(3), mid: t.toPrecision(3), high: (t * spread).toPrecision(3), mode:"target"};
    }
    if (!fromKnownRange && linP && linP.target) {
      var lt = parseFloat(linP.target);
      if (isFinite(lt) && lt > 0) {
        var spreadL = accSpreadFactor(accP && accP.qcSpread);
        return {low: (lt / spreadL).toPrecision(3), mid: lt.toPrecision(3), high: (lt * spreadL).toPrecision(3), mode:"target"};
      }
    }
    // Per ICH M10 / FDA bioanalytical guidance:
    //   LQC ≈ 3× LLOQ (often the lower-end QC closest to LLOQ but above its noise floor)
    //   MQC ≈ midpoint (geometric mean if range >1 decade, arithmetic otherwise)
    //   HQC ≈ 75–85% of ULOQ
    var spanLog = Math.log10(hi/lo) > 1;
    var lq = Math.min(3 * lo, 0.5 * (lo + hi));    // don't let LQC exceed midpoint
    var mq = spanLog ? Math.sqrt(lo * hi) : 0.5 * (lo + hi);
    var hq = 0.8 * hi;
    return {low: lq.toPrecision(3), mid: mq.toPrecision(3), high: hq.toPrecision(3), mode:"range"};
  };

  var accSpreadFactor = function(mode){
    if (mode === "tight") return 1.2;       // symmetric ±20% around target: 0.833x, 1x, 1.2x
    if (mode === "broad") return Math.sqrt(10);
    return 2;                               // default: moderate 0.5x, 1x, 2x
  };

  // Locked-style field renderer: shows value as a read-only-looking pill with a small
  // "🔓 unlock to edit" / "🔒 lock" toggle. When unlocked, behaves as a normal input.
  // Used to reduce decision fatigue — defaults look authoritative and stable.
  // unlocked state is stored in `unlockedFields` keyed by `${testId}:${fieldKey}`.
  var isUnlocked = function(testId, key){
    return !!(unlockedFields[testId+":"+key]);
  };
  var setUnlocked = function(testId, key, val){
    setUnlockedFields(function(prev){
      var nu = {};
      for (var k in prev) nu[k] = prev[k];
      if (val) nu[testId+":"+key] = true;
      else delete nu[testId+":"+key];
      return nu;
    });
  };

  var resetWizard = function(){
    setStep(1); setSelected({}); setTestParams({}); setTestIdx(0); setPlanName("");
  };

  var toggleTest = function(id){
    setSelected(function(prev){
      var ns = {};
      for (var k in prev) ns[k] = prev[k];
      ns[id] = !ns[id];
      return ns;
    });
  };

  var updateTestParam = function(testId, key, value){
    setTestParams(function(prev){
      var nt = {};
      for (var t in prev) {
        var inner = {};
        for (var k in prev[t]) inner[k] = prev[t][k];
        nt[t] = inner;
      }
      if (!nt[testId]) nt[testId] = {};
      nt[testId][key] = value;
      return nt;
    });
  };

  // Initialize default params for selected tests when entering Step 2
  var initParamsForSelected = function(){
    setTestParams(function(prev){
      var nt = {};
      for (var t in prev) nt[t] = prev[t];
      selectedIds.forEach(function(id){
        if (!nt[id]) nt[id] = getDefaultsForTest(id);
      });
      return nt;
    });
  };

  // Defaults per test (mirrors the v5ck wizard's defaults but flattened for direct param dict).
  // Defaults aim at ICH Q2/M10 minimum requirements: linearity 6 levels × 3 reps = 18 (≥5 levels);
  // accuracy 3 QC × 3 reps = 9 determinations (ICH min); repeatability 5 reps; LLOQ 5 × 3 runs.
  function getDefaultsForTest(id) {
    var d = {};
    if (id === "rangeFinding") {
      d.topConc = ""; d.nLevels = 10; d.dilutionFactor = 3; d.reps = 2;
    } else if (id === "linearity") {
      d.target = ""; d.nLevels = 6; d.reps = 3; d.rangeLow = ""; d.rangeHigh = ""; d.prepStyle = "discrete";
    } else if (id === "accuracy") {
      // ICH Q2: at least 9 determinations across at least 3 concentration levels (e.g., 3×3).
      d.target = ""; d.knowsRange = "no"; d.qcSpread = "moderate"; d.lloq = ""; d.uloq = ""; d.qcLevels = "L,M,H"; d.reps = 3; d.qcLow = ""; d.qcMid = ""; d.qcHigh = "";
    } else if (id === "repeatability") {
      d.qcLevel = ""; d.reps = 5; d.independentPreps = "yes";
    } else if (id === "intermediatePrecision") {
      d.qcLevel = ""; d.reps = 3; d.nDays = 3; d.nAnalysts = 2;
    } else if (id === "dilutionIntegrity") {
      d.highConc = ""; d.dilutions = "1:2, 1:5, 1:10"; d.reps = 3;
    } else if (id === "lloq") {
      d.lloqConc = ""; d.reps = 5; d.nRuns = 3;
    } else if (id === "spikeRecovery") {
      d.matrix = ""; d.spikeLevels = "L,M,H"; d.reps = 3; d.includeUnspiked = "yes";
      d.spikeLow = ""; d.spikeMid = ""; d.spikeHigh = "";
    }
    return d;
  }

  // Resolve effective params for a given test, applying auto-derivation rules so that downstream
  // row generation always has values to work with. Mirrors the visual auto-fill in Step 2.
  function getEffectiveParams(testId) {
    var raw = testParams[testId] || getDefaultsForTest(testId);
    var eff = {};
    for (var k in raw) eff[k] = raw[k];
    if (testId === "rangeFinding") {
      if (!eff.nLevels) eff.nLevels = 10;
      if (!eff.dilutionFactor) eff.dilutionFactor = 3;
      if (!eff.reps) eff.reps = 2;
    } else if (testId === "linearity") {
      var d = deriveLinearityRange(eff.target);
      if (!eff.rangeLow && d) eff.rangeLow = d.low;
      if (!eff.rangeHigh && d) eff.rangeHigh = d.high;
      if (!eff.nLevels) eff.nLevels = 6;
      if (!eff.reps) eff.reps = 3;
      if (!eff.prepStyle) eff.prepStyle = "discrete";
    } else if (testId === "accuracy") {
      var qc = deriveAccuracyQCs();
      if (!eff.qcLow && qc) eff.qcLow = qc.low;
      if (!eff.qcMid && qc) eff.qcMid = qc.mid;
      if (!eff.qcHigh && qc) eff.qcHigh = qc.high;
      if (!eff.reps) eff.reps = 3;
      if (!eff.qcLevels) eff.qcLevels = "L,M,H";
      if (!eff.qcSpread) eff.qcSpread = "moderate";
    } else if (testId === "repeatability") {
      if (!eff.qcLevel) {
        if (testParams.accuracy && testParams.accuracy.qcMid) eff.qcLevel = testParams.accuracy.qcMid;
        else { var qcsR = deriveAccuracyQCs(); if (qcsR) eff.qcLevel = qcsR.mid; }
      }
      if (!eff.reps) eff.reps = 5;
      if (!eff.independentPreps) eff.independentPreps = "yes";
    } else if (testId === "intermediatePrecision") {
      if (!eff.qcLevel) {
        if (testParams.accuracy && testParams.accuracy.qcMid) eff.qcLevel = testParams.accuracy.qcMid;
        else if (testParams.repeatability && testParams.repeatability.qcLevel) eff.qcLevel = testParams.repeatability.qcLevel;
        else { var qcsIP = deriveAccuracyQCs(); if (qcsIP) eff.qcLevel = qcsIP.mid; }
      }
      if (!eff.reps) eff.reps = 3;
      if (!eff.nDays) eff.nDays = 3;
      if (!eff.nAnalysts) eff.nAnalysts = 2;
    } else if (testId === "dilutionIntegrity") {
      if (!eff.highConc && testParams.linearity && testParams.linearity.rangeHigh) {
        var uloq = parseFloat(testParams.linearity.rangeHigh);
        if (isFinite(uloq) && uloq > 0) eff.highConc = (5 * uloq).toPrecision(3);
      }
      if (!eff.dilutions) eff.dilutions = "1:2, 1:5, 1:10";
      if (!eff.reps) eff.reps = 3;
    } else if (testId === "lloq") {
      if (!eff.lloqConc && testParams.linearity && testParams.linearity.rangeLow) eff.lloqConc = testParams.linearity.rangeLow;
      if (!eff.reps) eff.reps = 5;
      if (!eff.nRuns) eff.nRuns = 3;
    } else if (testId === "spikeRecovery") {
      var sLow = "", sMid = "", sHi = "";
      if (testParams.accuracy) {
        sLow = testParams.accuracy.qcLow || "";
        sMid = testParams.accuracy.qcMid || "";
        sHi = testParams.accuracy.qcHigh || "";
      }
      if (!sLow || !sMid || !sHi) {
        var qcsS = deriveAccuracyQCs();
        if (qcsS) {
          if (!sLow) sLow = qcsS.low;
          if (!sMid) sMid = qcsS.mid;
          if (!sHi) sHi = qcsS.high;
        }
      }
      if (!eff.spikeLow) eff.spikeLow = sLow;
      if (!eff.spikeMid) eff.spikeMid = sMid;
      if (!eff.spikeHigh) eff.spikeHigh = sHi;
      if (!eff.reps) eff.reps = 3;
      if (!eff.spikeLevels) eff.spikeLevels = "L,M,H";
      if (!eff.includeUnspiked) eff.includeUnspiked = "yes";
    }
    return eff;
  }

  // ── Compute Treatment Groups (master + per-test) ──────────────────
  var allRows = [];
  var perTestRows = {};
  selectedIds.forEach(function(id){
    var p = getEffectiveParams(id);
    var generator = validationTreatmentGenerators[id];
    var rows = generator ? generator(p, unit) : [];
    perTestRows[id] = rows;
    rows.forEach(function(r){allRows.push(r);});
  });

  // ── Run Summary numbers ───────────────────────────────────────────
  var totalSamples = allRows.length;
  var totalReps = allRows.reduce(function(s,r){return s+1;}, 0);  // 1 sample = 1 prep = 1 well
  var prepTypes = {};
  allRows.forEach(function(r){ if (r.prepType) prepTypes[r.prepType] = true; });
  var prepKeys = Object.keys(prepTypes);
  var hasSerialPrep = prepKeys.some(function(k){return /serial/i.test(k);});
  var hasOneStepPrep = prepKeys.some(function(k){return /one-step/i.test(k);});
  var hasDilutionPrep = prepKeys.some(function(k){return /dilute/i.test(k);});
  var dilutionType = hasSerialPrep
    ? "Serial dilution + independent preps"
    : (hasOneStepPrep ? "One-step dilutions + independent preps" : (hasDilutionPrep ? "Dilutions + independent preps" : "Independent preparations"));

  // ── CSV export ────────────────────────────────────────────────────
  var downloadCSV = function(){
    var esc = function(v){
      var s = String(v == null ? "" : v);
      if (s.indexOf(",")>=0 || s.indexOf('"')>=0 || s.indexOf("\n")>=0) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    var lines = [];
    lines.push(esc("Validation Plan: " + (planName || "Full validation plan")));
    lines.push(esc("Generated") + "," + esc(new Date().toISOString().slice(0,10)));
    lines.push(esc("Tests included") + "," + esc(selectedIds.map(function(id){return TEST_LABELS[id];}).join("; ")));
    lines.push("");
    lines.push(esc("RUN SUMMARY"));
    lines.push(esc("Total samples") + "," + totalSamples);
    lines.push(esc("Total run positions") + "," + totalReps);
    lines.push(esc("Run format") + "," + esc(runFormat));
    lines.push(esc("Dilution type") + "," + esc(dilutionType));
    lines.push("");

    // Master Treatment Groups table
    lines.push(esc("TREATMENT GROUPS — MASTER TABLE"));
    var headers = ["Sample ID","Level / Condition","Replicate","Nominal Concentration","Test","Prep Type","Purpose"];
    lines.push(headers.map(esc).join(","));
    allRows.forEach(function(r){
      lines.push([r.sel, r.level, r.replicate, r.nominal, r.test, r.prepType, r.purpose].map(esc).join(","));
    });
    lines.push("");

    // Per-test breakdowns
    lines.push(esc("PER-TEST BREAKDOWNS"));
    selectedIds.forEach(function(id){
      lines.push("");
      lines.push(esc("--- " + TEST_LABELS[id] + " ---"));
      lines.push(headers.map(esc).join(","));
      (perTestRows[id]||[]).forEach(function(r){
        lines.push([r.sel, r.level, r.replicate, r.nominal, r.test, r.prepType, r.purpose].map(esc).join(","));
      });
    });
    lines.push("");

    // Stats Map
    lines.push(esc("STATISTICS MAP (what the analyzer will calculate when results are imported)"));
    lines.push([esc("Test"), esc("Sample ID Prefix"), esc("Statistics computed")].join(","));
    selectedIds.forEach(function(id){
      var sm = validationStatsMap[id];
      if (sm) lines.push([esc(TEST_LABELS[id]), esc(sm.prefix), esc(sm.stats)].join(","));
    });

    if (instructor) {
      lines.push("");
      lines.push(esc("RATIONALE (instructor mode)"));
      selectedIds.forEach(function(id){
        var t = validationTemplates[id];
        if (t) {
          lines.push("");
          lines.push(esc(TEST_LABELS[id]) + "," + esc(t.rationale));
        }
      });
    }

    // Dilution Recipes — deterministic recipe per test using suggested stock (2× max level)
    // and 1 mL final volume per replicate + 10% pipetting waste. Matches the defaults the
    // UI pre-fills, so CSV recipes equal what the user sees if they open the panel without changes.
    lines.push("");
    lines.push(esc("DILUTION RECIPES"));
    lines.push(esc("Defaults: stock = 2× highest level, final volume = 1.0 mL/replicate, +10% pipetting waste."));
    selectedIds.forEach(function(id){
      var rowsForTest = perTestRows[id] || [];
      if (rowsForTest.length === 0) return;
      var prepStyleForTest = (testParams[id] && testParams[id].prepStyle) ||
        (id === "rangeFinding" ? "serial" : "discrete");
      // First, compute with stock=null/Vf=null to get suggestedStock
      var probe = computeDilutionRecipe(rowsForTest, prepStyleForTest, NaN, NaN);
      if (!probe || !probe.suggestedStock) return;
      var stockNum = parseFloat(probe.suggestedStock);
      var Vf_uL = 1000;  // 1 mL = 1000 µL
      var rec = computeDilutionRecipe(rowsForTest, prepStyleForTest, stockNum, Vf_uL);
      if (!rec || !rec.mode) return;
      var guidance = ICH_PREP_GUIDANCE[id] || {};
      var matches = prepStyleForTest === guidance.recommended;
      lines.push("");
      lines.push(esc("--- " + TEST_LABELS[id] + " ---"));
      lines.push(esc("Prep style") + "," + esc(prepStyleForTest) + "," + esc(matches ? "matches ICH" : "differs from ICH"));
      lines.push(esc("Suggested stock") + "," + esc(probe.suggestedStock + " " + unit));
      lines.push(esc("Final volume per replicate") + "," + esc("1.0 mL"));
      lines.push(esc("ICH note") + "," + esc(guidance.note || ""));
      lines.push("");
      if (rec.mode === "serial") {
        lines.push([esc("Step"), esc("Level"), esc("Target conc"), esc("Source"), esc("Aliquot from source"), esc("Diluent"), esc("Total volume"), esc("Aliquot %"), esc("Precision flag")].join(","));
        rec.steps.forEach(function(s){
          var srcWithUnit = s.source.replace(/^Stock \(([^)]+)\)$/, "Stock ($1 " + unit + ")");
          lines.push([
            esc(s.step),
            esc(s.level),
            esc(s.targetC.toPrecision(3) + " " + unit),
            esc(srcWithUnit),
            esc(fmtVolUL(s.aliquot_uL)),
            esc(fmtVolUL(s.diluent_uL)),
            esc(fmtVolUL(s.total_uL)),
            esc(s.aliquotPct.toFixed(1) + "%"),
            esc(s.precision)
          ].join(","));
        });
      } else {
        lines.push([esc("Level"), esc("Target conc"), esc("Aliquot from stock"), esc("Diluent"), esc("Total to prepare"), esc("Aliquot %"), esc("Precision flag")].join(","));
        rec.steps.forEach(function(s){
          lines.push([
            esc(s.level),
            esc(s.targetC.toPrecision(3) + " " + unit),
            esc(fmtVolUL(s.aliquot_uL)),
            esc(fmtVolUL(s.diluent_uL)),
            esc(fmtVolUL(s.total_uL)),
            esc(s.aliquotPct.toFixed(1) + "%"),
            esc(s.precision)
          ].join(","));
        });
      }
      if (rec.hasPrecisionWarn) {
        lines.push(esc("WARNING") + "," + esc("One or more aliquots are <5% or >50% of total volume — pipetting precision may suffer. Consider adjusting stock concentration."));
      }
    });

    var csv = lines.join("\n");
    var blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (planName || "validation_plan") + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── JSON download (version 2.0 schema) ────────────────────────────
  var downloadPlanJSON = function(){
    var plan = {
      version: "2.0",
      app: "eSSF Curve Validation Designer — Full Plan",
      mode: "multi",
      planName: planName || "Full validation plan",
      createdAt: new Date().toISOString(),
      unit: unit,
      tests: selectedIds.map(function(id){
        return {
          id: id,
          label: TEST_LABELS[id],
          params: testParams[id] || {},
          rows: perTestRows[id] || []
        };
      }),
      summary: {
        totalSamples: totalSamples,
        totalWells: totalReps,
        runFormat: runFormat,
        plateFill: plateFill,
        dilutionType: dilutionType
      }
    };
    var blob = new Blob([JSON.stringify(plan, null, 2)], {type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (planName || "validation_plan") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── JSON upload ───────────────────────────────────────────────────
  var uploadPlanJSON = function(e){
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try {
        var plan = JSON.parse(ev.target.result);
        if (plan.version === "2.0" && plan.mode === "multi") {
          // New format
          var ns = {}, np = {};
          (plan.tests || []).forEach(function(t){
            ns[t.id] = true;
            np[t.id] = t.params || {};
          });
          setSelected(ns);
          setTestParams(np);
          setPlanName(plan.planName || "");
          if (plan.summary && plan.summary.runFormat) setRunFormat(plan.summary.runFormat);
          if (plan.summary && plan.summary.plateFill) setPlateFill(plan.summary.plateFill);
          setStep(3);
        } else if (plan.testId && validationTemplates[plan.testId]) {
          // v5ck single-test format — convert on the fly
          var ns2 = {}; ns2[plan.testId] = true;
          var np2 = {}; np2[plan.testId] = plan.values || {};
          setSelected(ns2);
          setTestParams(np2);
          setPlanName(plan.planName || "");
          setStep(3);
        } else {
          alert("Plan file format not recognized.");
        }
      } catch(err) {
        alert("Could not read plan file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── UI styles ─────────────────────────────────────────────────────
  var stepLabel = {fontSize:11,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:0.5,marginBottom:8};
  var heading = {fontSize:16,fontWeight:800,color:"#0b2a6f",marginBottom:6};
  var hint = {fontSize:12,color:"#6e6e73",marginBottom:14,lineHeight:1.5};
  var btnPrimary = {background:"#6337b9",color:"#fff",border:"none",padding:"8px 20px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"};
  var btnSecondary = {background:"#fff",border:"1px solid #d8dfeb",color:"#5a6984",padding:"8px 16px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"};
  var inputS = {padding:"8px 12px",border:"1px solid #d8dfeb",borderRadius:6,fontSize:13,fontFamily:"inherit"};
  var fieldCard = {padding:"12px 14px",background:"#fafcff",border:"1px solid #e5e9f0",borderRadius:10};

  // ── Step 1: pick tests ────────────────────────────────────────────
  var renderStep1 = function(){
    var nSel = selectedIds.length;
    return <div>
      <div style={stepLabel}>Step 1 — Select tests</div>
      <div style={heading}>Which validation tests do you want to include?</div>
      <p style={hint}>Pick one or more. The wizard will generate a single Treatment Groups plan with deterministic <strong>Sample IDs</strong> so future imported data can be auto-analyzed.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))",gap:10,marginBottom:18}}>
        {TEST_ORDER.map(function(id){
          var t = validationTemplates[id];
          var sm = validationStatsMap[id];
          var isSel = !!selected[id];
          return <button key={id} onClick={function(){toggleTest(id);}} style={{textAlign:"left",cursor:"pointer",border:"2px solid "+(isSel?"#6337b9":"#d8dfeb"),background:isSel?"#f5f0ff":"#fff",borderRadius:12,padding:"14px 16px",fontFamily:"inherit",transition:"all 0.15s",position:"relative"}}>
            {isSel && <div style={{position:"absolute",top:10,right:10,width:20,height:20,borderRadius:10,background:"#6337b9",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>✓</div>}
            <div style={{fontSize:13,fontWeight:800,color:"#0b2a6f",marginBottom:4,paddingRight:24}}>{t.label}</div>
            <div style={{fontSize:11,color:"#6e6e73",lineHeight:1.4,marginBottom:6}}>{t.blurb}</div>
            <div style={{fontSize:10,color:"#8e9bb5",fontFamily:"monospace"}}>Sample ID prefix: <strong>{sm.prefix}</strong></div>
          </button>;
        })}
      </div>
      <div style={{padding:"12px 14px",background:"#fafafa",border:"1px dashed #d0d8ea",borderRadius:8,marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:"#5a6984",marginBottom:6}}>Or load a saved plan:</div>
        <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:11,padding:"6px 12px",background:"#fff",border:"1px solid #d8dfeb",borderRadius:6,fontWeight:600,color:"#30437a"}}>
          📂 Choose plan file (.json)
          <input type="file" accept="application/json,.json" onChange={uploadPlanJSON} style={{display:"none"}} />
        </label>
        <span style={{fontSize:10,color:"#8e9bb5",marginLeft:8,fontStyle:"italic"}}>Supports v5ck single-test plans and v2.0 multi-test plans</span>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div style={{fontSize:12,color:"#5a6984"}}>{nSel===0?"Select at least one test to continue.":nSel+" test"+(nSel===1?"":"s")+" selected"}</div>
        <button onClick={function(){if(nSel>0){initParamsForSelected();setTestIdx(0);setStep(2);}}} disabled={nSel===0} style={Object.assign({},btnPrimary,{opacity:nSel===0?0.4:1,cursor:nSel===0?"not-allowed":"pointer"})}>Configure tests →</button>
      </div>
    </div>;
  };

  // ── Step 2: configure each test (one screen per test) ─────────────
  var renderStep2 = function(){
    if (selectedIds.length === 0) return null;
    var curId = selectedIds[testIdx];
    if (!curId) { setStep(3); return null; }
    var p = testParams[curId] || getDefaultsForTest(curId);
    var t = validationTemplates[curId];
    var nTotal = selectedIds.length;

    var setVal = function(key, value){updateTestParam(curId, key, value);};

    // Locked-field UI: shows the value as a read-only-looking pill with a subtle edit link.
    // When unlocked, renders a normal input. The "lock" returns it to its computed default.
    // Args: label, key, value, computedDefault, helperText, inputType ("text"|"number"), unitSuffix
    var LockedField = function(opts){
      var unlocked = isUnlocked(curId, opts.key);
      var displayValue = (opts.value !== undefined && opts.value !== null && opts.value !== "")
        ? opts.value
        : (opts.computedDefault !== undefined && opts.computedDefault !== null ? opts.computedDefault : "");
      var hasComputed = opts.computedDefault !== undefined && opts.computedDefault !== null && opts.computedDefault !== "";
      var fieldStyle = {padding:"8px 12px",border:"1px solid #d8dfeb",borderRadius:6,fontSize:13,fontFamily:"inherit"};
      var lockedStyle = {padding:"8px 12px",borderRadius:6,fontSize:13,fontFamily:"inherit",background:"#f4f7fb",border:"1px solid #e5e9f0",color:"#30437a",fontWeight:600,display:"inline-block",minHeight:"15px",cursor:"text",textAlign:"left"};
      var width = opts.width || (opts.inputType === "number" ? 80 : 140);
      var finishEdit = function(){
        setUnlocked(curId, opts.key, false);
        if (hasComputed && (opts.value === "" || opts.value === undefined || opts.value === null)) {
          setVal(opts.key, opts.computedDefault);
        }
      };
      return <div style={fieldCard}>
        <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>
          {opts.label}{opts.unitSuffix && <span style={{fontWeight:400,color:"#8e9bb5",marginLeft:4}}>({opts.unitSuffix})</span>}
        </label>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          {unlocked ? (
            <input
              type={opts.inputType||"text"}
              value={opts.value !== null && opts.value !== undefined ? opts.value : ""}
              onChange={function(e){
                var raw = e.target.value;
                setVal(opts.key, opts.inputType==="number" ? (raw === "" ? "" : (parseInt(raw)||0)) : raw);
              }}
              placeholder={opts.placeholder || (hasComputed ? String(opts.computedDefault) : "")}
              style={Object.assign({},fieldStyle,{width:width,background:"#fffbe8",borderColor:"#e0c87a"})}
              onBlur={finishEdit}
              onKeyDown={function(e){if(e.key==="Enter") e.currentTarget.blur();}}
              autoFocus
            />
          ) : (
            <button type="button" onClick={function(){setUnlocked(curId, opts.key, true);}} style={Object.assign({},lockedStyle,{minWidth:width,boxSizing:"border-box"})} title="Click to edit">
              {displayValue || <span style={{color:"#aeaeb2",fontStyle:"italic",fontWeight:400}}>not set</span>}
            </button>
          )}
          {instructor && opts.helper && <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic"}}>{opts.helper}</span>}
        </div>
      </div>;
    };

    // Build the per-test field UI based on test id
    var fieldElements = null;
    if (curId === "rangeFinding") {
      fieldElements = <div>
        <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Highest planned concentration <span style={{fontWeight:400,color:"#8e9bb5"}}>({unit})</span></label>
          <input type="text" value={p.topConc||""} onChange={function(e){setVal("topConc", e.target.value);}} placeholder="optional, e.g. 100" style={Object.assign({},inputS,{width:160})} />
          {instructor && <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic",marginLeft:10}}>If unknown, leave blank and use the sample IDs to label relative dilution levels.</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          {LockedField({label:"Scouting levels",key:"nLevels",value:p.nLevels,computedDefault:10,inputType:"number",helper:"8–10 levels is typical for first-pass range finding."})}
          {LockedField({label:"Serial dilution factor",key:"dilutionFactor",value:p.dilutionFactor,computedDefault:3,inputType:"number",helper:"3-fold balances broad coverage with usable spacing."})}
          {LockedField({label:"Replicates per level",key:"reps",value:p.reps,computedDefault:2,inputType:"number",helper:"Duplicate is enough for scouting; formal validation uses more."})}
        </div>
        {instructor && <div style={{fontSize:11,color:"#5a6984",fontStyle:"italic",marginTop:10,lineHeight:1.5}}>
          Use this before formal validation when LLOQ/ULOQ are not known. These data help identify blank separation at the low end and saturation/nonlinearity at the high end.
        </div>}
      </div>;
    } else if (curId === "linearity") {
      // Auto-derive low/high from target whenever target changes (visible fill)
      var targetVal = p.target || "";
      var derived = deriveLinearityRange(targetVal);
      // The user can override by unlocking. Otherwise the fields display the auto-fill.
      fieldElements = <div>
        <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Target / test concentration <span style={{fontWeight:400,color:"#8e9bb5"}}>({unit})</span></label>
          <input type="text" value={targetVal} onChange={function(e){
            setVal("target", e.target.value);
            var d = deriveLinearityRange(e.target.value);
            if (d) {
              if (!isUnlocked(curId,"rangeLow")) setVal("rangeLow", d.low);
              if (!isUnlocked(curId,"rangeHigh")) setVal("rangeHigh", d.high);
            }
          }} placeholder="e.g. 5" style={Object.assign({},inputS,{width:140})} />
          {instructor && <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic",marginLeft:10}}>Range auto-fills at 80%–120% of this value (ICH Q2 minimum)</span>}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          {LockedField({label:"Range low",key:"rangeLow",value:p.rangeLow,computedDefault:derived?derived.low:"",unitSuffix:unit,helper:"= 80% of target"})}
          {LockedField({label:"Range high",key:"rangeHigh",value:p.rangeHigh,computedDefault:derived?derived.high:"",unitSuffix:unit,helper:"= 120% of target"})}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {LockedField({label:"Number of levels",key:"nLevels",value:p.nLevels,computedDefault:6,inputType:"number",helper:"ICH Q2 ≥5; default 6"})}
          {LockedField({label:"Replicates per level",key:"reps",value:p.reps,computedDefault:3,inputType:"number",helper:"ICH Q2: 2–3"})}
        </div>
        <div style={Object.assign({},fieldCard,{marginTop:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Preparation style</label>
          <select value={p.prepStyle||"discrete"} onChange={function(e){setVal("prepStyle", e.target.value);}} style={Object.assign({},inputS,{background:"#fff",minWidth:250})}>
            <option value="discrete">Independent discrete preparations</option>
            <option value="serial">Serial dilution from stock</option>
            <option value="oneStep">One-step dilutions from stock</option>
          </select>
          {instructor && <div style={{fontSize:10,color:"#8e9bb5",marginTop:6,lineHeight:1.4}}>ICH Q2 requires justified concentration levels across the range; it does not mandate one universal prep style. For formal validation, independent/discrete preparations are stronger evidence than a single serial chain. Serial dilution is efficient for scouting and routine calibration.</div>}
        </div>
      </div>;
    } else if (curId === "accuracy") {
      // Auto-derive QC concentrations from linearity range (or accuracy's own target if linearity not selected)
      var qcs = deriveAccuracyQCs();
      // Detect source of derivation for hint
      var derivationSrc = null;
      if (qcs && qcs.mode === "target") {
        derivationSrc = "target concentration";
      } else if (p.knowsRange === "yes" && p.lloq && p.uloq) {
        derivationSrc = "known LLOQ/ULOQ";
      } else if (testParams.linearity && testParams.linearity.rangeLow && testParams.linearity.rangeHigh) {
        derivationSrc = "linearity range";
      } else if (p.target) {
        derivationSrc = "your target";
      }
      var hasLinearityRange = testParams.linearity && testParams.linearity.rangeLow && testParams.linearity.rangeHigh;
      var hasKnownRange = p.knowsRange === "yes" && p.lloq && p.uloq;
      var showTargetInput = !hasLinearityRange && !hasKnownRange;
      fieldElements = <div>
        {showTargetInput && <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Target / test concentration <span style={{fontWeight:400,color:"#8e9bb5"}}>({unit})</span></label>
          <input type="text" value={p.target||""} onChange={function(e){setVal("target",e.target.value);}} placeholder="e.g. 5" style={Object.assign({},inputS,{width:140})} />
          {instructor && <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic",marginLeft:10}}>QC levels will derive from this. (Or add Linearity to share its range, or click "Add known range" below.)</span>}
        </div>}
        <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          {p.knowsRange==="yes" ? <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
              <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a"}}>Known LLOQ / ULOQ</label>
              <button type="button" onClick={function(){setVal("knowsRange","no");}} style={{background:"transparent",border:"none",color:"#8e9bb5",fontSize:10,cursor:"pointer",padding:0,textDecoration:"underline",textDecorationStyle:"dotted"}}>use target estimate</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:"#5a6984",marginBottom:4}}>LLOQ / low end <span style={{fontWeight:400,color:"#8e9bb5"}}>({unit})</span></div>
              <input type="text" value={p.lloq||""} onChange={function(e){setVal("lloq", e.target.value);}} placeholder="e.g. 0.1" style={Object.assign({},inputS,{width:"100%",boxSizing:"border-box"})} />
            </div>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:"#5a6984",marginBottom:4}}>ULOQ / high end <span style={{fontWeight:400,color:"#8e9bb5"}}>({unit})</span></div>
              <input type="text" value={p.uloq||""} onChange={function(e){setVal("uloq", e.target.value);}} placeholder="e.g. 10" style={Object.assign({},inputS,{width:"100%",boxSizing:"border-box"})} />
            </div>
          </div>
          </div> : <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#30437a"}}>LLOQ / ULOQ not provided</div>
              {instructor && <div style={{fontSize:11,color:"#8e9bb5",marginTop:2}}>QC levels will be estimated from target.</div>}
            </div>
            <button type="button" onClick={function(){setVal("knowsRange","yes");}} style={{background:"#fff",border:"1px solid #d8dfeb",color:"#30437a",fontSize:11,fontWeight:700,cursor:"pointer",padding:"6px 10px",borderRadius:8}}>Add known range</button>
          </div>}
          {instructor && <div style={{fontSize:10,color:"#8e9bb5",marginTop:6,lineHeight:1.4}}>{p.knowsRange==="yes" ? "Known LLOQ/ULOQ will drive formal QC placement." : "Without LLOQ/ULOQ, the app estimates provisional L/M/H levels from the target concentration."}</div>}
        </div>
        {qcs && qcs.mode==="target" && <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>How wide should the target estimate be?</label>
          <select value={p.qcSpread||"moderate"} onChange={function(e){setVal("qcSpread", e.target.value);}} style={Object.assign({},inputS,{background:"#fff",minWidth:230})}>
            <option value="tight">Tight: ~0.83× / 1× / 1.2× (near target)</option>
            <option value="moderate">Moderate: 0.5× / 1× / 2×</option>
            <option value="broad">Broad: log-symmetric 10-fold (0.316× / 1× / 3.16×)</option>
          </select>
          {instructor && <div style={{fontSize:10,color:"#8e9bb5",marginTop:6,lineHeight:1.4}}>Default is moderate. Use broad when you have little confidence in the working range; use tight only when the assay is intended to report near a narrow target.</div>}
        </div>}
        <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>QC level concentrations <span style={{fontWeight:400,color:"#8e9bb5"}}>({unit})</span></label>
          {instructor && qcs && qcs.mode==="target" && <div style={{fontSize:11,color:"#5a6984",background:"#f8fbff",border:"1px solid #dfe7f2",borderRadius:6,padding:"7px 9px",marginBottom:8,lineHeight:1.45}}>
            Estimated from target because LLOQ/ULOQ are not known yet. Use these as fit-for-purpose starting levels, then analyze the data to estimate LOQ and refine the formal validation range.
          </div>}
          {instructor && derivationSrc && <div style={{fontSize:11,color:"#6337b9",marginBottom:8,fontStyle:"italic"}}>{qcs && qcs.mode==="target" ? "Target-only estimate uses the selected span. Moderate gives 0.5x / 1x / 2x; broad gives a log-symmetric 10-fold window; tight stays close to target. This avoids pretending LLOQ/ULOQ are known before data exist." : "Derived from "+derivationSrc+" (ICH M10 convention: LQC approx 3x LLOQ, MQC midpoint, HQC approx 80% ULOQ)."}</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {LockedField({label:"Low (LQC)",key:"qcLow",value:p.qcLow,computedDefault:qcs?qcs.low:"",unitSuffix:unit,width:100})}
            {LockedField({label:"Mid (MQC)",key:"qcMid",value:p.qcMid,computedDefault:qcs?qcs.mid:"",unitSuffix:unit,width:100})}
            {LockedField({label:"High (HQC)",key:"qcHigh",value:p.qcHigh,computedDefault:qcs?qcs.high:"",unitSuffix:unit,width:100})}
          </div>
        </div>
        {LockedField({label:"Replicates per QC",key:"reps",value:p.reps,computedDefault:3,inputType:"number",helper:"ICH Q2: ≥9 determinations total. 3 reps × 3 QC = 9 minimum."})}
      </div>;
    } else if (curId === "repeatability") {
      // QC concentration: prefer mid-QC from accuracy if available, else from linearity midpoint
      var midDefault = "";
      if (testParams.accuracy && testParams.accuracy.qcMid) midDefault = testParams.accuracy.qcMid;
      else {
        var qcsR = deriveAccuracyQCs();
        if (qcsR) midDefault = qcsR.mid;
      }
      fieldElements = <div>
        {LockedField({label:"QC concentration",key:"qcLevel",value:p.qcLevel,computedDefault:midDefault,unitSuffix:unit,helper:midDefault?"= mid-QC (typical choice)":"set manually"})}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
          {LockedField({label:"Replicates",key:"reps",value:p.reps,computedDefault:5,inputType:"number",helper:"ICH Q2: ≥5"})}
          <div style={fieldCard}>
            <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Independent preparations?</label>
            <select value={p.independentPreps||"yes"} onChange={function(e){setVal("independentPreps", e.target.value);}} style={Object.assign({},inputS,{background:"#fff"})}>
              <option value="yes">Yes (preferred)</option>
              <option value="no">No (single prep)</option>
            </select>
          </div>
        </div>
      </div>;
    } else if (curId === "intermediatePrecision") {
      var midDefault2 = "";
      if (testParams.accuracy && testParams.accuracy.qcMid) midDefault2 = testParams.accuracy.qcMid;
      else if (testParams.repeatability && testParams.repeatability.qcLevel) midDefault2 = testParams.repeatability.qcLevel;
      else {
        var qcsIP = deriveAccuracyQCs();
        if (qcsIP) midDefault2 = qcsIP.mid;
      }
      fieldElements = <div>
        {LockedField({label:"QC concentration",key:"qcLevel",value:p.qcLevel,computedDefault:midDefault2,unitSuffix:unit,helper:"= mid-QC (typical)"})}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:10}}>
          {LockedField({label:"Days",key:"nDays",value:p.nDays,computedDefault:3,inputType:"number",helper:"ICH min 2"})}
          {LockedField({label:"Analysts",key:"nAnalysts",value:p.nAnalysts,computedDefault:2,inputType:"number",helper:"ICH min 2"})}
          {LockedField({label:"Reps per session",key:"reps",value:p.reps,computedDefault:3,inputType:"number",helper:"3 typical"})}
        </div>
      </div>;
    } else if (curId === "dilutionIntegrity") {
      // High sample default: 5× ULOQ (well above the upper limit)
      var hiDefault = "";
      if (testParams.linearity && testParams.linearity.rangeHigh) {
        var uloq = parseFloat(testParams.linearity.rangeHigh);
        if (isFinite(uloq) && uloq > 0) hiDefault = (5 * uloq).toPrecision(3);
      }
      fieldElements = <div>
        {LockedField({label:"High sample concentration",key:"highConc",value:p.highConc,computedDefault:hiDefault,unitSuffix:unit,helper:hiDefault?"= 5× ULOQ":"above upper range"})}
        <div style={{marginTop:10}}>
          {LockedField({label:"Dilution factors",key:"dilutions",value:p.dilutions,computedDefault:"1:2, 1:5, 1:10",helper:"comma-separated, integer",width:240})}
        </div>
        <div style={{marginTop:10}}>
          {LockedField({label:"Replicates per dilution",key:"reps",value:p.reps,computedDefault:3,inputType:"number",helper:"3 typical"})}
        </div>
      </div>;
    } else if (curId === "lloq") {
      // LLOQ default: range low (= LLOQ from linearity)
      var lloqDefault = "";
      if (testParams.linearity && testParams.linearity.rangeLow) lloqDefault = testParams.linearity.rangeLow;
      fieldElements = <div>
        {LockedField({label:"Proposed LLOQ concentration",key:"lloqConc",value:p.lloqConc,computedDefault:lloqDefault,unitSuffix:unit,helper:lloqDefault?"= linearity range low":"set manually"})}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
          {LockedField({label:"Replicates per run",key:"reps",value:p.reps,computedDefault:5,inputType:"number",helper:"ICH M10: ≥5"})}
          {LockedField({label:"Number of runs",key:"nRuns",value:p.nRuns,computedDefault:3,inputType:"number",helper:"3 typical"})}
        </div>
      </div>;
    } else if (curId === "spikeRecovery") {
      // Spike levels: default to accuracy QC concentrations if available
      var sLow = "", sMid = "", sHi = "";
      if (testParams.accuracy) {
        sLow = testParams.accuracy.qcLow || "";
        sMid = testParams.accuracy.qcMid || "";
        sHi = testParams.accuracy.qcHigh || "";
      }
      if (!sLow || !sMid || !sHi) {
        var qcsS = deriveAccuracyQCs();
        if (qcsS) {
          if (!sLow) sLow = qcsS.low;
          if (!sMid) sMid = qcsS.mid;
          if (!sHi) sHi = qcsS.high;
        }
      }
      fieldElements = <div>
        <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Sample matrix</label>
          <input type="text" value={p.matrix||""} onChange={function(e){setVal("matrix", e.target.value);}} placeholder="e.g. plasma, formulation buffer" style={Object.assign({},inputS,{width:240})} />
        </div>
        <div style={Object.assign({},fieldCard,{marginBottom:10})}>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Spike concentrations <span style={{fontWeight:400,color:"#8e9bb5"}}>({unit})</span></label>
          {instructor && <div style={{fontSize:11,color:"#6337b9",marginBottom:8,fontStyle:"italic"}}>Defaults match Accuracy QC levels for direct comparability</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {LockedField({label:"Low",key:"spikeLow",value:p.spikeLow,computedDefault:sLow,unitSuffix:unit,width:100})}
            {LockedField({label:"Mid",key:"spikeMid",value:p.spikeMid,computedDefault:sMid,unitSuffix:unit,width:100})}
            {LockedField({label:"High",key:"spikeHigh",value:p.spikeHigh,computedDefault:sHi,unitSuffix:unit,width:100})}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {LockedField({label:"Replicates per spike level",key:"reps",value:p.reps,computedDefault:3,inputType:"number",helper:"3 typical"})}
          <div style={fieldCard}>
            <label style={{display:"block",fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Include unspiked control?</label>
            <select value={p.includeUnspiked||"yes"} onChange={function(e){setVal("includeUnspiked", e.target.value);}} style={Object.assign({},inputS,{background:"#fff"})}>
              <option value="yes">Yes (preferred)</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
      </div>;
    }

    return <div>
      <div style={stepLabel}>Step 2 — Configure ({testIdx+1} of {nTotal}: {t.label})</div>
      <div style={heading}>{t.label}</div>
      <p style={hint}>{t.blurb}.</p>
      {!instructor && <div style={{fontSize:11,color:"#6e6e73",marginBottom:14,fontStyle:"italic"}}>Tip: click any value to edit it.</div>}
      {instructor && <div style={{padding:"8px 12px",background:"#fff7e8",border:"1px solid #f0d6a0",borderRadius:6,fontSize:11,color:"#8a6420",marginBottom:14,lineHeight:1.5}}>
        <strong>Defaults are ICH-aligned.</strong> Locked values use ICH Q2/M10 conventions and are recommended for most methods. Click a value to override only when needed.
      </div>}
      {fieldElements}
      {instructor && <div style={{marginTop:14,padding:"12px 16px",background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:8,fontSize:12,color:"#30437a",lineHeight:1.6}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4,color:"#5a6984"}}>Why this design?</div>
        {t.rationale}
      </div>}
      <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:18}}>
        <button onClick={function(){
          if (testIdx > 0) setTestIdx(testIdx-1);
          else setStep(1);
        }} style={btnSecondary}>← Back</button>
        <button onClick={function(){
          if (testIdx < nTotal-1) setTestIdx(testIdx+1);
          else setStep(3);
        }} style={btnPrimary}>{testIdx < nTotal-1 ? "Next: "+TEST_LABELS[selectedIds[testIdx+1]]+" →" : "See full plan →"}</button>
      </div>
    </div>;
  };

  // ── Step 3: Output (Run Summary, Master table, Per-test breakdowns, Stats Map) ─
  var renderStep3 = function(){
    var thS = {padding:"8px 10px",fontSize:10,fontWeight:700,color:"#30437a",textTransform:"uppercase",letterSpacing:0.5,textAlign:"left",borderBottom:"2px solid #d8dfeb",background:"#fafafa",whiteSpace:"nowrap"};
    var tdS = {padding:"7px 10px",fontSize:11,color:"#1d1d1f",borderBottom:"1px solid #f0f0f3",verticalAlign:"top"};
    var selS = Object.assign({},tdS,{fontFamily:"monospace",fontWeight:700,color:"#6337b9",whiteSpace:"nowrap"});

    var renderRows = function(rows){
      return rows.map(function(r, i){
        var prev = rows[i-1];
        var newGroup = i===0 || !prev || prev.test!==r.test || prev.level!==r.level;
        var groupBorder = newGroup ? "3px solid #c7d3e8" : "1px solid #f0f0f3";
        return <tr key={i} style={{borderTop:groupBorder}}>
          <td style={selS}>{r.sel}</td>
          <td style={tdS}>{r.level}</td>
          <td style={Object.assign({},tdS,{textAlign:"center"})}>{r.replicate}</td>
          <td style={Object.assign({},tdS,{whiteSpace:"nowrap"})}>{r.nominal}</td>
          <td style={Object.assign({},tdS,{fontSize:10,color:"#5a6984"})}>{r.test}</td>
          <td style={Object.assign({},tdS,{fontSize:10,color:"#5a6984"})}>{r.prepType}</td>
          <td style={Object.assign({},tdS,{fontSize:10,color:"#5a6984"})}>{r.purpose}</td>
        </tr>;
      });
    };

    var renderPlateMap = function(rows){
      var mapRows = rows.slice(0,96);
      var mode = plateFill==="columns" ? "classical" : (plateFill==="rows" ? "transposed" : plateFill);
      var wells = Array.from({length:96}, function(_,i){
        var rowIdx = Math.floor(i/12);
        var colIdx = i%12;
        var pos = mode==="classical" ? colIdx*8 + rowIdx : rowIdx*12 + colIdx;
        return mapRows[pos] || null;
      });
      var legend = [];
      rows.forEach(function(r){
        if(r && !legend.some(function(x){return x.test===r.test;})) legend.push({test:r.test,color:testColor(r.test)});
      });
      var rowLetters = ["A","B","C","D","E","F","G","H"];
      return <div style={{background:"linear-gradient(180deg,#fbfdff,#f5f8fc)",border:"1px solid #d8dfeb",borderRadius:12,padding:"14px 16px",marginBottom:14,boxShadow:"0 8px 22px rgba(15,35,80,0.06)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:11,fontWeight:800,color:"#0b2a6f",textTransform:"uppercase",letterSpacing:0.5}}>Plate map preview</div>
            <div style={{fontSize:10,color:"#6e6e73",marginTop:2}}>
              {mode==="classical" ? "Classical-compatible: fills down columns first (A1 to H1, then A2)." : "Transposed-compatible: fills across rows first (A1 to A12, then B1)."}
            </div>
          </div>
          <select value={mode} onChange={function(e){setPlateFill(e.target.value);}} style={Object.assign({},inputS,{fontSize:11,padding:"5px 8px",background:"#fff",minWidth:220})}>
            <option value="classical">Classical column-wise</option>
            <option value="transposed">Transposed row-wise</option>
          </select>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
          {legend.map(function(l){
            return <div key={l.test} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color:"#5a6984",fontWeight:700,background:"#fff",border:"1px solid #e5e9f0",borderRadius:999,padding:"4px 8px"}}>
              <span style={{width:9,height:9,borderRadius:9,background:l.color,display:"inline-block"}} />
              {l.test}
            </div>;
          })}
        </div>
        <div style={{overflowX:"auto",padding:"10px 10px 12px",background:"#eef3f8",border:"1px solid #cfd8e6",borderRadius:14}}>
          <div style={{display:"grid",gridTemplateColumns:"22px repeat(12, 42px)",gridTemplateRows:"20px repeat(8, 42px)",gap:6,alignItems:"center",justifyContent:"start",minWidth:610}}>
            <div />
            {Array.from({length:12}).map(function(_,c){
              return <div key={"col"+c} style={{fontSize:10,color:"#6f7fa0",fontWeight:800,textAlign:"center"}}>{c+1}</div>;
            })}
            {rowLetters.map(function(letter,rIdx){
              return <div key={"row"+letter} style={{display:"contents"}}>
                <div style={{fontSize:10,color:"#6f7fa0",fontWeight:800,textAlign:"center"}}>{letter}</div>
                {Array.from({length:12}).map(function(_,cIdx){
                  var i = rIdx*12+cIdx;
                  var r = wells[i];
                  var wellId = letter+(cIdx+1);
                  var color = r ? testColor(r.test) : "#ccd6e4";
                  return <div key={wellId} title={r ? (wellId+" · "+r.sel+" · "+r.test+" · "+r.level) : wellId} style={{width:38,height:38,borderRadius:38,background:r?("radial-gradient(circle at 34% 30%, #fff 0%, #fff 12%, "+color+"33 24%, "+color+"66 100%)"):"#f9fbfd",border:"1px solid "+(r?color:"#d7dfec"),boxShadow:r?"inset 0 2px 5px rgba(255,255,255,0.75), inset 0 -4px 8px "+color+"33, 0 1px 2px rgba(20,40,70,0.08)":"inset 0 1px 3px rgba(255,255,255,0.9)",display:"flex",alignItems:"center",justifyContent:"center",boxSizing:"border-box"}}>
                    <span style={{fontSize:8.5,fontFamily:"monospace",fontWeight:800,color:r?color:"#bac5d4",maxWidth:32,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r?r.sel:""}</span>
                  </div>;
                })}
              </div>;
            })}
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"flex-start",marginTop:9,flexWrap:"wrap"}}>
          <div style={{fontSize:10,color:"#6e6e73",lineHeight:1.45,flex:"1 1 280px"}}>
            This is a bench-layout preview. It gives a plate order for the validation plan; formal data import should still use one of the app's normal plate orientations.
          </div>
          <div style={{fontSize:10,color:"#30437a",fontWeight:700,background:"#fff",border:"1px solid #dfe7f2",borderRadius:8,padding:"6px 8px"}}>
            Suggested order: {mode==="classical" ? "column-wise" : "row-wise"}
          </div>
        </div>
        {rows.length>96 && <div style={{marginTop:8,fontSize:10,color:"#bf4800",fontWeight:700}}>This plan has {rows.length} samples, so it exceeds one 96-well plate. Only the first 96 are shown.</div>}
      </div>;
    };

    // Pick which rows to show based on tableView selection
    var visibleRows = tableView === "all" ? allRows : (perTestRows[tableView] || []);
    var visibleLabel = tableView === "all" ? "All tests" : TEST_LABELS[tableView];

    return <div>
      <div style={stepLabel}>Step 3 — Plan output</div>
      <div style={heading}>Your validation plan</div>
      <p style={hint}>Review, name, download. The Treatment Groups table below is what your tech follows at the bench. Each sample gets a unique <strong>Sample ID</strong> so future imported data can be auto-analyzed.</p>

      {/* Plan name input */}
      <div style={Object.assign({},fieldCard,{marginBottom:14})}>
        <label style={{display:"block",fontSize:11,fontWeight:700,color:"#5a6984",textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>Plan name</label>
        <input type="text" value={planName} placeholder={"Validation plan — "+new Date().toISOString().slice(0,10)} onChange={function(e){setPlanName(e.target.value);}} style={Object.assign({},inputS,{width:"100%",maxWidth:480,boxSizing:"border-box"})} />
      </div>

      <div style={Object.assign({},fieldCard,{marginBottom:14})}>
        <label style={{display:"block",fontSize:11,fontWeight:700,color:"#5a6984",textTransform:"uppercase",letterSpacing:0.5,marginBottom:6}}>How will this be run?</label>
        <select value={runFormat} onChange={function(e){setRunFormat(e.target.value);}} style={Object.assign({},inputS,{background:"#fff",minWidth:220})}>
          <option value="plate">Plate / wells</option>
          <option value="vials">Vials / autosampler</option>
          <option value="protocol">Protocol only</option>
        </select>
      </div>

      {/* Run Summary */}
      <div style={{padding:"14px 18px",background:"linear-gradient(180deg,#f5f0ff,#ede5ff)",border:"1px solid #c7b2e8",borderRadius:12,marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:700,color:"#6337b9",textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Run Summary</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:14}}>
          <div>
            <div style={{fontSize:24,fontWeight:800,color:"#0b2a6f",lineHeight:1}}>{totalSamples}</div>
            <div style={{fontSize:11,color:"#6e6e73",marginTop:2}}>Total samples</div>
          </div>
          <div>
            <div style={{fontSize:24,fontWeight:800,color:"#0b2a6f",lineHeight:1}}>{totalReps}</div>
            <div style={{fontSize:11,color:"#6e6e73",marginTop:2}}>{runFormat==="plate"?"Total wells":"Total positions"}</div>
          </div>
          <div>
            <div style={{fontSize:24,fontWeight:800,color:"#0b2a6f",lineHeight:1}}>{selectedIds.length}</div>
            <div style={{fontSize:11,color:"#6e6e73",marginTop:2}}>Tests included</div>
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#0b2a6f",lineHeight:1.3}}>{dilutionType}</div>
            <div style={{fontSize:11,color:"#6e6e73",marginTop:2}}>Dilution type</div>
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:"#0b2a6f",lineHeight:1.3}}>{runFormat==="plate"?"Plate / wells":runFormat==="vials"?"Vials / autosampler":"Protocol only"}</div>
            <div style={{fontSize:11,color:"#6e6e73",marginTop:2}}>Run format</div>
          </div>
        </div>
      </div>

      {runFormat==="plate" && renderPlateMap(visibleRows)}

      {/* Sample ID Key — visible by default, no disclosure */}
      <div style={{padding:"12px 16px",background:"#fafcff",border:"1px solid #e5e9f0",borderRadius:10,marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:"#30437a",textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>📐 Sample ID Key</div>
        <div style={{fontSize:11,color:"#5a6984",marginBottom:10,lineHeight:1.5}}>
          Format: <code style={{fontFamily:"monospace",background:"#f0eaff",padding:"1px 5px",borderRadius:3}}>[Prefix][Level]_[Replicate]</code>. The prefix tells you which test each sample belongs to.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:8}}>
          {selectedIds.map(function(id){
            var sm = validationStatsMap[id];
            var keyExamples = {
              rangeFinding: "F1=highest scout level, F10=lowest scout level",
              linearity: "L1=lowest, L6=highest level",
              accuracy: "AL=Low, AM=Mid, AH=High QC",
              repeatability: "P_1, P_2, ... (single QC × N reps)",
              intermediatePrecision: "IP1, IP2, ... (session×rep)",
              dilutionIntegrity: "D2=1:2, D5=1:5, D10=1:10",
              lloq: "Q1=run 1, Q2=run 2, ...",
              spikeRecovery: "SL/SM/SH=spike levels; S0=unspiked"
            };
            return <div key={id} style={{padding:"8px 10px",background:"#fff",border:"1px solid #e5e9f0",borderRadius:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <code style={{fontFamily:"monospace",fontSize:12,fontWeight:800,color:"#6337b9",background:"#f0eaff",padding:"2px 8px",borderRadius:4}}>{sm.prefix}</code>
                <span style={{fontSize:11,fontWeight:700,color:"#0b2a6f"}}>{TEST_LABELS[id]}</span>
              </div>
              <div style={{fontSize:10,color:"#5a6984",lineHeight:1.4}}>{keyExamples[id]}</div>
            </div>;
          })}
        </div>
      </div>

      {/* Treatment Groups table with Excel-style tab switcher */}
      <div style={{background:"#fff",border:"1px solid #e5e5ea",borderRadius:12,overflow:"hidden",marginBottom:14}}>
        <div style={{padding:"10px 16px",background:"#fafafa",borderBottom:"1px solid #e5e5ea",fontSize:11,fontWeight:700,color:"#0b2a6f",textTransform:"uppercase",letterSpacing:0.5,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <span>Treatment Groups — {visibleLabel} ({visibleRows.length} rows)</span>
        </div>
        {/* Excel-style tab strip */}
        <div style={{display:"flex",gap:0,background:"#f0f3f8",borderBottom:"1px solid #d8dfeb",overflowX:"auto"}}>
          <button onClick={function(){setTableView("all");}} style={{padding:"8px 14px",fontSize:11,fontWeight:tableView==="all"?800:600,color:tableView==="all"?"#6337b9":"#5a6984",background:tableView==="all"?"#fff":"transparent",border:"none",borderRight:"1px solid #d8dfeb",borderTop:tableView==="all"?"2px solid #6337b9":"2px solid transparent",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>All ({allRows.length})</button>
          {selectedIds.map(function(id){
            var rows = perTestRows[id] || [];
            var active = tableView===id;
            return <button key={id} onClick={function(){setTableView(id);}} style={{padding:"8px 14px",fontSize:11,fontWeight:active?800:600,color:active?"#6337b9":"#5a6984",background:active?"#fff":"transparent",border:"none",borderRight:"1px solid #d8dfeb",borderTop:active?"2px solid #6337b9":"2px solid transparent",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{TEST_LABELS[id]} ({rows.length})</button>;
          })}
        </div>
        <div style={{maxHeight:420,overflowY:"auto",overflowX:"auto"}}>
          <table style={{borderCollapse:"collapse",width:"100%",minWidth:900}}>
            <thead><tr>
              <th style={thS}>Sample ID</th>
              <th style={thS}>Level / Condition</th>
              <th style={thS}>Rep</th>
              <th style={thS}>Nominal concentration</th>
              <th style={thS}>Test</th>
              <th style={thS}>Prep Type</th>
              <th style={thS}>Purpose</th>
            </tr></thead>
            <tbody>{renderRows(visibleRows)}</tbody>
          </table>
        </div>
      </div>

      {/* Dilution Recipes — outer collapsible panel containing per-test recipes */}
      <div style={{background:"#fff",border:"1px solid #e5e5ea",borderRadius:12,overflow:"hidden",marginBottom:14}}>
        <button
          type="button"
          onClick={function(){setRecipesOpen(!recipesOpen);}}
          style={{
            width:"100%",
            padding:"10px 16px",
            background:recipesOpen?"#f5f9fd":"#fafafa",
            border:"none",
            borderBottom:recipesOpen?"1px solid #e5e5ea":"none",
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            justifyContent:"space-between",
            gap:10,
            textAlign:"left",
            fontFamily:"inherit"
          }}
        >
          <span style={{fontSize:11,fontWeight:700,color:"#0b2a6f",textTransform:"uppercase",letterSpacing:0.5,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:13}}>{recipesOpen?"▾":"▸"}</span>
            💧 Dilution Recipes
            <span style={{fontSize:9,color:"#6e6e73",fontWeight:600,letterSpacing:0,textTransform:"none",fontStyle:"italic"}}>({selectedIds.length} test{selectedIds.length===1?"":"s"})</span>
          </span>
          <span style={{fontSize:10,color:"#5a6984",textTransform:"none",letterSpacing:0,fontWeight:500}}>{recipesOpen?"hide":"show"}</span>
        </button>
        {recipesOpen && <div style={{padding:"10px 14px"}}>
          <div style={{fontSize:11,color:"#5a6984",marginBottom:9,lineHeight:1.5}}>
            Click any test below to compute aliquot and diluent volumes per level. Recipes use the prep style chosen in Step 2 and flag pipetting concerns. Recipes are also included in the CSV download.
          </div>
          {selectedIds.map(function(id){
            var rowsForTest = perTestRows[id] || [];
            if (rowsForTest.length === 0) return null;
            var prepStyleForTest = (testParams[id] && testParams[id].prepStyle) ||
              (id === "rangeFinding" ? "serial" : "discrete");
            return <DilutionRecipeCard
              key={id}
              testId={id}
              testLabel={TEST_LABELS[id]}
              rows={rowsForTest}
              unit={unit}
              prepStyle={prepStyleForTest}
              instructor={instructor}
            />;
          })}
        </div>}
      </div>

      {/* Stats Map */}
      <div style={{background:"#fff",border:"1px solid #e5e5ea",borderRadius:12,overflow:"hidden",marginBottom:14}}>
        <div style={{padding:"10px 16px",background:"#fafafa",borderBottom:"1px solid #e5e5ea",fontSize:11,fontWeight:700,color:"#0b2a6f",textTransform:"uppercase",letterSpacing:0.5}}>Statistics Map — what gets calculated when results are imported</div>
        <table style={{borderCollapse:"collapse",width:"100%"}}>
          <thead><tr>
            <th style={thS}>Test</th>
            <th style={thS}>Sample ID Prefix</th>
            <th style={thS}>Statistics</th>
          </tr></thead>
          <tbody>
            {selectedIds.map(function(id){
              var sm = validationStatsMap[id];
              return <tr key={id}>
                <td style={Object.assign({},tdS,{fontWeight:700,color:"#0b2a6f"})}>{TEST_LABELS[id]}</td>
                <td style={Object.assign({},tdS,{fontFamily:"monospace",fontWeight:700,color:"#6337b9"})}>{sm.prefix}</td>
                <td style={tdS}>{sm.stats}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      {/* Instructor mode rationale */}
      {instructor && <details style={{marginBottom:14,background:"#f6fbff",border:"1px solid #d7e7fb",borderRadius:10,overflow:"hidden"}}>
        <summary style={{cursor:"pointer",padding:"12px 16px",fontSize:12,fontWeight:700,color:"#30437a",background:"#f6fbff",listStyle:"none"}}>🎓 Instructor mode — rationale per test (click to expand)</summary>
        <div style={{padding:"4px 16px 14px"}}>
          {selectedIds.map(function(id){
            var t = validationTemplates[id];
            return <div key={id} style={{marginTop:12,paddingTop:10,borderTop:"1px dashed #c7b2e8"}}>
              <div style={{fontSize:12,fontWeight:800,color:"#0b2a6f",marginBottom:4}}>{TEST_LABELS[id]}</div>
              <div style={{fontSize:11,color:"#5a6984",lineHeight:1.6}}>{t.rationale}</div>
            </div>;
          })}
        </div>
      </details>}

      {/* Actions */}
      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:8}}>
        <button onClick={downloadCSV} style={{background:"#1b7f6a",color:"#fff",border:"none",padding:"10px 16px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>📊 Download CSV (opens in Excel)</button>
        <button onClick={downloadPlanJSON} style={{background:"#0b2a6f",color:"#fff",border:"none",padding:"10px 16px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>💾 Download plan file (.json)</button>
        <button onClick={function(){setStep(2);setTestIdx(0);}} style={btnSecondary}>← Edit configuration</button>
        <button onClick={resetWizard} style={Object.assign({},btnSecondary,{marginLeft:"auto"})}>+ New plan</button>
      </div>
      <div style={{padding:"8px 12px",background:"#fafafa",borderRadius:6,fontSize:10,color:"#8e9bb5",lineHeight:1.5}}>
        💡 The CSV includes one sheet-section per test plus a master table, run summary, and stats map. The .json plan file is portable and re-uploadable in Step 1.
      </div>
    </div>;
  };

  return <div style={{background:"#fff",border:"1px solid "+BORDER,borderRadius:14,padding:"1.5rem",boxShadow:"0 4px 12px rgba(11,42,111,0.04)"}}>
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingBottom:14,borderBottom:"1px solid #f0f0f3"}}>
      <div style={{width:40,height:40,borderRadius:10,background:"#6337b9",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>📋</div>
      <div style={{flex:1}}>
        <div style={{fontSize:15,fontWeight:800,color:"#0b2a6f"}}>Full Validation Plan</div>
        <div style={{fontSize:11,color:"#6e6e73"}}>Multi-test wizard with deterministic Sample IDs for future auto-analysis.</div>
      </div>
      {props.onBack && <button onClick={props.onBack} style={btnSecondary}>← Choose another mode</button>}
    </div>
    <div style={{display:"flex",gap:6,marginBottom:18}}>
      {[1,2,3].map(function(s){
        var active = s===step;
        var done = s<step;
        return <div key={s} style={{flex:1,height:4,borderRadius:2,background:done?"#6337b9":active?"#a989d8":"#e5e9f0",transition:"all 0.15s"}}></div>;
      })}
    </div>
    {step===1 && renderStep1()}
    {step===2 && renderStep2()}
    {step===3 && renderStep3()}
  </div>;
}


// Entry chooser — presents two paths (Quick experiment vs Full validation plan)
function ValidationDesignerEntry(props) {
  var _mode = useState(null), mode = _mode[0], setMode = _mode[1];
  if (mode === "quick") {
    return <div>
      <button onClick={function(){setMode(null);}} style={{background:"#fff",border:"1px solid #d8dfeb",color:"#5a6984",padding:"6px 12px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",marginBottom:14}}>← Choose another mode</button>
      <ValidationDesignerCard instructor={props.instructor} />
    </div>;
  }
  if (mode === "full") {
    return <FullValidationPlanCard instructor={props.instructor} unit={props.unit} onBack={function(){setMode(null);}} />;
  }
  // Mode picker
  var tile = function(modeId, title, desc, badge, color){
    return <button onClick={function(){setMode(modeId);}} style={{textAlign:"left",cursor:"pointer",border:"1px solid "+BORDER,background:"#fff",borderRadius:14,padding:"20px 22px",fontFamily:"inherit",transition:"all 0.15s",display:"flex",gap:14,alignItems:"flex-start",boxShadow:"0 4px 10px rgba(11,42,111,0.04)"}} onMouseEnter={function(e){e.currentTarget.style.borderColor=color;e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 8px 18px rgba(11,42,111,0.08)";}} onMouseLeave={function(e){e.currentTarget.style.borderColor=BORDER;e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 10px rgba(11,42,111,0.04)";}}>
      <div style={{width:50,height:50,borderRadius:12,background:color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0,fontWeight:700}}>{badge}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:15,fontWeight:800,color:"#0b2a6f",marginBottom:4}}>{title}</div>
        <div style={{fontSize:12,color:"#6e6e73",lineHeight:1.5}}>{desc}</div>
      </div>
    </button>;
  };
  return <div style={{background:"#fff",border:"1px solid "+BORDER,borderRadius:14,padding:"1.5rem",boxShadow:"0 4px 12px rgba(11,42,111,0.04)"}}>
    <div style={{marginBottom:18}}>
      <div style={{fontSize:15,fontWeight:800,color:"#0b2a6f",marginBottom:4}}>Validation Designer</div>
      <div style={{fontSize:12,color:"#6e6e73"}}>What do you want to design?</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      {tile("quick", "Quick experiment", "Design a single validation test (linearity, accuracy, etc.) with a printable instruction sentence and CSV output. Best when you just need to plan one test.", "✓", "#0F8AA2")}
      {tile("full", "Full validation plan", "Design a multi-test plan (any combination of the 7 tests). Generates a Treatment Groups table with deterministic Sample IDs so future imported data can be auto-analyzed.", "📋", "#6337b9")}
    </div>
  </div>;
}


export default function App() {
  var _s=useState(false),on=_s[0],setOn=_s[1];
  var _t=useState(0),tab=_t[0],setTab=_t[1];
  var _ae=useState(""),analyzeError=_ae[0],setAnalyzeError=_ae[1];
  var _pra=useState(false),pendingReanalyze=_pra[0],setPendingReanalyze=_pra[1];
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
  var _activePlate=useState(0),activePlate=_activePlate[0],setActivePlate=_activePlate[1];
  var _collapsedPlate=useState(false),collapsedPlate=_collapsedPlate[0],setCollapsedPlate=_collapsedPlate[1];

  var u=function(k,v){setCfg(function(p){var n={};for(var x in p)n[x]=p[x];n[k]=v;return n;});};
  useEffect(function(){if(activePlate>=np)setActivePlate(np-1);},[np]);
  var np=Math.max(1,Math.min(24,parseInt(cfg.np)||1));
  var sr=parseInt(cfg.sr)||3; var xr=parseInt(cfg.xr)||3;
  var nl=cfg.names.split(/[,\n]/).map(function(s){return s.trim();}).filter(Boolean);
  var unit=cfg.unit||"mg/mL";
  // Display unit overrides — let the user click a tiny pill to change how concs are shown
  // without changing the underlying data. State is initialized from cfg.unit but follows cfg.unit
  // when the user changes the input unit (so stale display values don't persist).
  var _duChart = useState(unit), displayUnitChart = _duChart[0], setDisplayUnitChart = _duChart[1];
  var _duResults = useState(unit), displayUnitResults = _duResults[0], setDisplayUnitResults = _duResults[1];
  // Toggle for showing the "at DF=X" subscript under each concentration in the Results & Recommendations summary
  // tables. Default OFF so the analyst can copy/paste the table cleanly. Toggle is a small dotted-link in each
  // table header.
  var _showDils = useState(false), showDilutions = _showDils[0], setShowDilutions = _showDils[1];
  // Toggle for drawing solid horizontal lines between plates in flat-listed result tables (multi-plate runs only).
  // Makes it easier to visually scan where one plate's samples end and another's begin. Default ON.
  var _showPlateSep = useState(true), showPlateSeparators = _showPlateSep[0], setShowPlateSeparators = _showPlateSep[1];
  // Sync display units when input unit changes (e.g. user switches from mg/mL to ng/mL in General Info)
  useEffect(function(){ setDisplayUnitChart(unit); setDisplayUnitResults(unit); }, [unit]);
  // Dilution display format: "ratio" (default, "1:N") or "factor" ("N×"). Affects landing-page series previews
  // and the bench-workflow well labels. Independent of unit display.
  var _dilFmt = useState("ratio"), dilFormat = _dilFmt[0], setDilFormat = _dilFmt[1];
  var targetP=cfg.tp==="yes"?"Total Protein":(cfg.target||cfg.sn);
  var assayKind=cfg.tp==="yes"?"total":(cfg.at==="elisa"?"elisa":"direct");
  // Display name for the standard, scoped to a plate when there are multiple plates so
  // analysts can tell apart "GFP standard" on plate 1 vs. plate 2 in charts/tables/exports.
  // Single-plate runs read just "GFP standard" (no parenthetical).
  var stdDisplayName = function(pi){
    var base = (cfg.sn || "Standard") + " standard";
    return np>1 ? base + " (P" + (pi+1) + ")" : base;
  };

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
    if(cfg.layout==="transposed_mixed"){
      // Transposed mixed-rep ("Andrew+ format"): same half-row slot model as classical transposed,
      // but per-sample rep counts come from cfg.xrMix (e.g. "3,3,2").
      // Standard curve always takes the first cfg.sr rows of the LEFT half.
      // Pattern then resets at the half boundary — samples never span halves.
      var halfWidth = Math.floor(cols / 2);
      var dilsPerRep = halfWidth - 1;
      var halfStart = function(halfIdx){return halfIdx===0 ? 0 : halfWidth;};
      var halfBlank = function(halfIdx){return halfIdx===0 ? halfWidth-1 : cols-1;};
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
          rowsUsed: Array.from(new Set(slots.map(function(s){return s.row;}))),
          dilsPerRep: dilsPerRep
        };
      };
      var srN_mix = Math.max(1, parseInt(cfg.sr)||3);
      var mixParsed = parseRepMix(cfg.xrMix || "3,3,2");
      var pattern = mixParsed.valid ? mixParsed.parts : [1];
      var groups_mix = [];
      // ── LEFT HALF ──
      // Standard takes first srN_mix rows; pattern fills remaining rows
      var leftStdSlots = [];
      for (var rL=0; rL<srN_mix && rL<rows; rL++) leftStdSlots.push({row:rL, halfIdx:0});
      groups_mix.push(buildGroupFromSlots("std","Standard",leftStdSlots));
      var leftRemaining = [];
      for (var rL2=srN_mix; rL2<rows; rL2++) leftRemaining.push({row:rL2, halfIdx:0});
      var sampleIdx_mix = 1;
      var patIdxL = 0;
      while (leftRemaining.length > 0) {
        var n_takeL = pattern[patIdxL % pattern.length];
        if (n_takeL > leftRemaining.length) n_takeL = leftRemaining.length; // partial last group in left half
        var grpSlotsL = leftRemaining.slice(0, n_takeL);
        leftRemaining = leftRemaining.slice(n_takeL);
        groups_mix.push(buildGroupFromSlots("smp","Sample "+sampleIdx_mix,grpSlotsL));
        sampleIdx_mix++;
        patIdxL++;
      }
      // ── RIGHT HALF ──
      // Pattern restarts from the top; standard does NOT repeat. All rows used for samples.
      var rightRemaining = [];
      for (var rR=0; rR<rows; rR++) rightRemaining.push({row:rR, halfIdx:1});
      var patIdxR = 0;
      while (rightRemaining.length > 0) {
        var n_takeR = pattern[patIdxR % pattern.length];
        if (n_takeR > rightRemaining.length) n_takeR = rightRemaining.length; // partial last group in right half
        var grpSlotsR = rightRemaining.slice(0, n_takeR);
        rightRemaining = rightRemaining.slice(n_takeR);
        groups_mix.push(buildGroupFromSlots("smp","Sample "+sampleIdx_mix,grpSlotsR));
        sampleIdx_mix++;
        patIdxR++;
      }
      return {groups:groups_mix, totalRows:rows, totalCols:cols, axis:"row", dilsPerRep:dilsPerRep, dilutionCount:dilsPerRep, halfWidth:halfWidth, mixPattern:pattern};
    }
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
    // ── AUTOSAMPLER PATH ───────────────────────────────────────────────────
    // For vials/LC-MS mode, build the result from cfg.msInjections (flat list of injection rows).
    // Each row: {sampleType, sampleName, levelOrDilution, reps:[]}.
    //
    //   For Standards: levelOrDilution is the integer level number. Concentration is computed via
    //     asStandardConcForLevel(level, cfg).
    //   For Unknowns / SST: dilution factor is auto-derived from the row's position among same-name
    //     rows. First row of a sample = pDil(cfg.xdf); each subsequent = previous × pDil(cfg.xds).
    //   For Blanks: skipped (no data point produced — could be subtracted in future).
    //
    // Multiple rows with the same level (Standards) get pooled as replicates for that level. Multiple
    // rows with the same sample name (Unknowns/SST) become separate dilution rows for that sample.
    //
    // Output structure (res[0].samps[].dils[]) is parallel to the plate-reader path.
    if (cfg.layout === "autosampler") {
      var injections = (function(){try{var x=JSON.parse(cfg.msInjections||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();

      // ─── Step 1: Standards grouped by level number ───
      var stdGroups = {};
      var unresolvedLevels = [];
      injections.forEach(function(r){
        if (r.sampleType !== "Standard") return;
        var level = parseInt(r.levelOrDilution);
        if (!isFinite(level) || level < 1) return;
        var conc = asStandardConcForLevel(level, cfg);
        if (conc == null) {
          if (unresolvedLevels.indexOf(level) < 0) unresolvedLevels.push(level);
          return;
        }
        var validReps = (r.reps||[]).map(function(v){return parseFloat(v);}).filter(function(v){return isFinite(v) && v > 0;});
        if (validReps.length === 0) return;
        var key = String(level);
        if (!stdGroups[key]) stdGroups[key] = {level: level, conc: conc, reps: []};
        stdGroups[key].reps = stdGroups[key].reps.concat(validReps);
      });
      var validStd = Object.keys(stdGroups).map(function(k){return stdGroups[k];}).sort(function(a,b){return b.conc - a.conc;});
      if (validStd.length < 2) {
        var msg = "Need at least 2 Standard rows with a level number AND at least one replicate.";
        if (unresolvedLevels.length > 0) {
          msg += "\n\nLevel(s) referenced in the table but not yet defined in General Information: "+unresolvedLevels.join(", ")+".\n\n";
          msg += "Either set the top concentration + serial DF (serial mode), or add concentrations for those levels (discrete mode).";
        }
        window.alert(msg);
        return;
      }

      // ─── Step 2: Pick fit model & build calibration regression ───
      // "auto" mode: fit all four models, pick highest R². User can later override via in-canvas picker.
      var asCurveModel;
      if (cfg.fm === "loglog") asCurveModel = "loglog";
      else if (cfg.fm === "4pl" || cfg.fm === "5pl") asCurveModel = cfg.fm;
      else if (cfg.fm === "auto") asCurveModel = "auto";
      else asCurveModel = "linear";

      var asXR = [], asYR = [];
      var asDbS = validStd.map(function(l, idx){
        var avg = l.reps.reduce(function(s,v){return s+v;},0) / l.reps.length;
        var sd = l.reps.length > 1 ? Math.sqrt(l.reps.reduce(function(s,v){return s+(v-avg)*(v-avg);},0)/(l.reps.length-1)) : 0;
        var cv = avg > 0 ? sd/avg : 0;
        asXR.push(l.conc); asYR.push(avg);
        return {row:idx, conc:l.conc, raw:l.reps, blank:0, cor:l.reps, avg:avg, sd:sd, cv:cv};
      });

      var asLf;
      if (asCurveModel === "auto") {
        // Try all four models, keep the one with highest R²
        var candidates = [];
        try {
          var _lin = linReg(asXR, asYR);
          if (_lin && isFinite(_lin.r2)) candidates.push({model:"linear", slope:_lin.slope, intercept:_lin.intercept, r2:_lin.r2});
        } catch(_){}
        try {
          var _ll = logLogReg(asXR, asYR);
          if (_ll && isFinite(_ll.r2)) candidates.push({model:"loglog", slope:_ll.slope, intercept:_ll.intercept, r2:_ll.r2});
        } catch(_){}
        try {
          var _4 = fitLogistic(asXR, asYR, "4pl");
          if (_4 && isFinite(_4.r2)) candidates.push(_4);
        } catch(_){}
        try {
          var _5 = fitLogistic(asXR, asYR, "5pl");
          if (_5 && isFinite(_5.r2)) candidates.push(_5);
        } catch(_){}
        if (candidates.length === 0) {
          // Fallback: linear straight-line, even if R² is bad — better than nothing
          var lrFallback = linReg(asXR, asYR);
          asLf = {model:"linear", slope:lrFallback.slope, intercept:lrFallback.intercept, r2:lrFallback.r2, fallback:true};
        } else {
          candidates.sort(function(a,b){return b.r2 - a.r2;});
          asLf = candidates[0];
        }
        asCurveModel = asLf.model;
      } else if (asCurveModel === "linear") {
        var lr = linReg(asXR, asYR);
        asLf = {model:"linear", slope:lr.slope, intercept:lr.intercept, r2:lr.r2};
      } else if (asCurveModel === "loglog") {
        var llr = logLogReg(asXR, asYR);
        asLf = {model:"loglog", slope:llr.slope, intercept:llr.intercept, r2:llr.r2};
      } else {
        asLf = fitLogistic(asXR, asYR, asCurveModel);
        if (!asLf) {
          var lr2 = linReg(asXR, asYR);
          asLf = {model:"linear", slope:lr2.slope, intercept:lr2.intercept, r2:lr2.r2, fallback:true};
          asCurveModel = "linear";
        }
      }
      var asFFn = function(x){
        if (asLf.model==="linear") return asLf.slope*x + asLf.intercept;
        if (asLf.model==="loglog") {
          if (x<=0||!isFinite(x)) return null;
          return Math.pow(10, asLf.slope*Math.log10(x) + asLf.intercept);
        }
        return logisticY(x, asLf.params, asLf.model);
      };
      var asIFn = function(y){
        if (asLf.model==="linear") return asLf.slope ? (y-asLf.intercept)/asLf.slope : null;
        if (asLf.model==="loglog") {
          if (y<=0||!isFinite(y)||!asLf.slope) return null;
          var lx = (Math.log10(y) - asLf.intercept) / asLf.slope;
          var xv = Math.pow(10, lx);
          return isFinite(xv) && xv > 0 ? xv : null;
        }
        return logisticInv(y, asLf.params, asLf.model);
      };
      var asMxA = Math.max.apply(null, asYR), asMnA = Math.min.apply(null, asYR);
      var asMidA = (asMxA + asMnA) / 2;
      var asSP = asDbS.map(function(s){return {conc:s.conc, avg:s.avg, sd:s.sd, cv:s.cv};});

      // ─── Step 3: Group Unknown + SST rows by sampleName, walk in order to assign DF ───
      // Hybrid model: each row's DF is either:
      //   (a) per-row override — analyst typed something into r.levelOrDilution that parses as a
      //       valid dilution (1/N, 1:N, or decimal 0<v≤1) — that value wins.
      //   (b) auto-derived — pDil(cfg.xdf) × pDil(cfg.xds)^rowOrderIdx
      // The rowOrderIdx counter still increments for ALL rows of a sample (overridden or not) so
      // the auto-derived series for non-overridden rows stays consistent.
      var smpFirstDF = pDil(cfg.xdf || "1/10");  if (!isFinite(smpFirstDF) || smpFirstDF<=0) smpFirstDF = 0.1;
      var smpSerialDF = pDil(cfg.xds || "1/2");  if (!isFinite(smpSerialDF) || smpSerialDF<=0) smpSerialDF = 0.5;

      var sampleOrder = [];
      var sampleMap = {};
      var sstRowKeys = {};
      var sampleSeenCount = {};
      injections.forEach(function(r){
        if (r.sampleType !== "Unknown" && r.sampleType !== "SST") return;
        var name = (r.sampleName||"").trim();
        if (!name) return;
        var validReps = (r.reps||[]).map(function(v){return parseFloat(v);}).filter(function(v){return isFinite(v) && v > 0;});
        if (validReps.length === 0) {
          sampleSeenCount[name] = (sampleSeenCount[name] || 0) + 1;
          return;
        }
        var rowOrderIdx = sampleSeenCount[name] || 0;
        sampleSeenCount[name] = rowOrderIdx + 1;
        // Check for per-row override
        var rawOverride = (r.levelOrDilution || "").trim();
        var df = null;
        if (rawOverride !== "") {
          var parsedOverride = pDil(rawOverride);
          if (isFinite(parsedOverride) && parsedOverride > 0 && parsedOverride <= 1) {
            df = parsedOverride;
          }
        }
        if (df == null) {
          df = smpFirstDF * Math.pow(smpSerialDF, rowOrderIdx);
        }

        if (!sampleMap[name]) {
          sampleMap[name] = {name: name, dils: [], anySST: false};
          sampleOrder.push(name);
        }
        if (r.sampleType === "SST") sampleMap[name].anySST = true;
        sampleMap[name].dils.push({reps: validReps, df: df, rowOrderIdx: rowOrderIdx});
      });

      // ─── Step 4: For each grouped sample, compute back-calculated concs ───
      var asSamps = sampleOrder.map(function(name, sIdx){
        var samp = sampleMap[name];
        var dils = samp.dils.map(function(d, di){
          var avg = d.reps.reduce(function(s,v){return s+v;},0) / d.reps.length;
          var sd = d.reps.length > 1 ? Math.sqrt(d.reps.reduce(function(s,v){return s+(v-avg)*(v-avg);},0)/(d.reps.length-1)) : 0;
          var cv = avg > 0 ? sd/avg : 0;
          var ir = avg <= asMxA && avg >= asMnA;
          var cW = null;
          var inv = asIFn(avg);
          if (inv != null && isFinite(inv) && inv > 0) cW = inv;
          var cS = cW != null ? cW / d.df : null;
          return {di:di, avgA:avg, cv:cv, ir:ir, cW:cW, cS:cS, df:d.df, lbaOK:false, lbaNote:""};
        });
        var aS = selAll(dils, asMidA, "direct");
        if (samp.anySST) sstRowKeys[sIdx] = true;
        return {name: name, dils: dils, aS: aS};
      });

      // ─── Step 5: Auto-flag SST samples in cfg.sstFlags ───
      var existingFlags = (function(){try{var x=JSON.parse(cfg.sstFlags||"{}");return (x&&typeof x==="object")?x:{};}catch(_){return {};}})();
      var nextFlags = Object.assign({}, existingFlags);
      var flagsChanged = false;
      Object.keys(sstRowKeys).forEach(function(sIdx){
        var key = "0-"+sIdx;
        if (!nextFlags[key]) {
          nextFlags[key] = true;
          flagsChanged = true;
        }
      });
      if (flagsChanged) u("sstFlags", JSON.stringify(nextFlags));

      var asResult = {
        sc: {slope:asLf.slope, intercept:asLf.intercept, r2:asLf.r2, pts:asSP, model:asLf.model, params:asLf.params, fallback:asLf.fallback},
        fFn: asFFn,
        iFn: asIFn,
        fL: asLf.model==="linear"?"Linear":(asLf.model==="loglog"?"Log-log":(asLf.model==="5pl"?"5PL":"4PL")),
        samps: asSamps,
        dbS: asDbS,
        bA: 0,
        mxA: asMxA,
        mnA: asMnA
      };
      setRes([asResult]);
      setTab(1);
      return;
    }

    var sc=parseFloat(cfg.sc),df1=pDil(cfg.sdf),ds=pDil(cfg.sds),xf1=pDil(cfg.xdf),xs=pDil(cfg.xds);
    df1*=pOptionalDil(cfg.stdPredil);
    xf1*=pOptionalDil(cfg.smpPredil);
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
      // Curve model selection priority:
      //   - cfg.fm "auto" → fit all four models, pick highest R²
      //   - cfg.fm explicitly set to "loglog" → log-log linear
      //   - cfg.fm "5pl" or "4pl" → 4PL or 5PL (ELISA shape)
      //   - otherwise → straight linear
      var curveModel;
      if (cfg.fm === "auto") {
        curveModel = "auto";
      } else if (cfg.fm === "loglog") {
        curveModel = "loglog";
      } else if (cfg.at === "elisa") {
        curveModel = (cfg.fm === "5pl" ? "5pl" : "4pl");
      } else {
        curveModel = "linear";
      }
      // Optionally include the blank well as a (conc=0, fluorescence_corrected=0) calibration point.
      // Default off (matches ICH M10 / immunoassay convention: standards only).
      // On = matches the older "Excel forces origin" approach common in classroom worksheets.
      // Note: log-log can't include zero-conc points (log(0) is undefined), so this flag is silently
      // ignored in loglog mode.
      if(curveModel==="linear"&&cfg.forceOriginInCurve==="yes"){
        xR.push(0); yR.push(0);
      }
      var lr=null,lf=null;
      if(curveModel==="auto"){
        // Fit all four models, pick highest R²
        var candidates = [];
        try {
          var _lin = linReg(xR, yR);
          if (_lin && isFinite(_lin.r2)) candidates.push({model:"linear", slope:_lin.slope, intercept:_lin.intercept, r2:_lin.r2});
        } catch(_){}
        try {
          var _ll = logLogReg(xR, yR);
          if (_ll && isFinite(_ll.r2)) candidates.push({model:"loglog", slope:_ll.slope, intercept:_ll.intercept, r2:_ll.r2});
        } catch(_){}
        try {
          var _4 = fitLogistic(xR, yR, "4pl");
          if (_4 && isFinite(_4.r2)) candidates.push(_4);
        } catch(_){}
        try {
          var _5 = fitLogistic(xR, yR, "5pl");
          if (_5 && isFinite(_5.r2)) candidates.push(_5);
        } catch(_){}
        if (candidates.length === 0) {
          var lrFb = linReg(xR, yR);
          lf = {model:"linear", slope:lrFb.slope, intercept:lrFb.intercept, r2:lrFb.r2, fallback:true};
        } else {
          candidates.sort(function(a,b){return b.r2 - a.r2;});
          lf = candidates[0];
        }
        curveModel = lf.model;
      } else if(curveModel==="linear"){
        lr=linReg(xR,yR);
        lf={model:"linear",slope:lr.slope,intercept:lr.intercept,r2:lr.r2};
      } else if(curveModel==="loglog"){
        lr=logLogReg(xR,yR);
        // Slope/intercept here are on the LOG10 axes. Forward fn: y = 10^(slope*log10(x)+intercept).
        // Inverse: x = 10^((log10(y)-intercept)/slope).
        lf={model:"loglog",slope:lr.slope,intercept:lr.intercept,r2:lr.r2};
      } else {
        lf=fitLogistic(xR,yR,curveModel);
        if(!lf){
          lr=linReg(xR,yR);
          lf={model:"linear",slope:lr.slope,intercept:lr.intercept,r2:lr.r2,fallback:true};
          curveModel="linear";
        }
      }
      var fFn=function(x){
        if(lf.model==="linear") return lf.slope*x+lf.intercept;
        if(lf.model==="loglog"){
          if(x<=0||!isFinite(x)) return null;
          return Math.pow(10, lf.slope*Math.log10(x) + lf.intercept);
        }
        return logisticY(x,lf.params,lf.model);
      };
      var iFn=function(y){
        if(lf.model==="linear") return lf.slope?(y-lf.intercept)/lf.slope:null;
        if(lf.model==="loglog"){
          if(y<=0||!isFinite(y)||!lf.slope) return null;
          var lx = (Math.log10(y) - lf.intercept) / lf.slope;
          var xv = Math.pow(10, lx);
          return isFinite(xv) && xv > 0 ? xv : null;
        }
        return logisticInv(y,lf.params,lf.model);
      };
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
          dils.push({di:d,avgA:a2,cv:cv2,ir:ir2,cW:cW,cS:cS2,df:df,lbaOK:false,lbaNote:""});
          dbD.push({di:d,raw:raw2,blank:sB,cor:cor2,avgA:a2,cv:cv2,ir:ir2,cW:cW,df:df,cS:cS2});
        }
        if(assayKind==="elisa"){
          for(var li=0;li<dils.length;li++){
            var here=dils[li];
            if(!(here.ir&&here.cS!=null))continue;
            for(var lj=Math.max(0,li-1);lj<=Math.min(dils.length-1,li+1);lj++){
              if(lj===li)continue;
              var nb=dils[lj];
              if(!(nb&&nb.ir&&nb.cS!=null))continue;
              var agreement=100*Math.min(here.cS,nb.cS)/Math.max(here.cS,nb.cS);
              if(agreement>=80){here.lbaOK=true;here.lbaNote="Dilutionally linear with neighboring dilution ("+agreement.toFixed(0)+"%)";break;}
            }
            if(!here.lbaOK)here.lbaNote="No neighboring in-range dilution agrees within 80–120%; review for hook effect or matrix interference";
          }
        }
        samps.push({name:nm,dils:dils,aS:selAll(dils,midA,assayKind),dbD:dbD});
      }
      all.push({sc:{slope:lf.slope,intercept:lf.intercept,r2:lf.r2,pts:sP,model:lf.model,params:lf.params,fallback:lf.fallback},fFn:fFn,iFn:iFn,fL:lf.model==="linear"?"Linear":(lf.model==="loglog"?"Log-log":(lf.model==="5pl"?"5PL":"4PL")),samps:samps,dbS:dbS,bA:bA,mxA:mxA,mnA:mnA});
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
    // Try download first; if it fails (sandboxed iframe, embedded preview, no Blob support, etc.),
    // fall back to copying the CSV to clipboard with a brief alert. This ensures the export still
    // works in environments where downloads are blocked.
    var filename = "essf_curve_results_"+APP_VERSION+".csv";
    var downloadOk = false;
    try {
      var bb=new Blob([c],{type:"text/csv"});
      var u2=URL.createObjectURL(bb);
      var a=document.createElement("a");
      a.href=u2;
      a.download=filename;
      a.style.display="none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(u2);
      downloadOk = true;
    } catch(err) {
      // Download path failed — fall through to clipboard
      console.warn("CSV download failed; falling back to clipboard:", err);
    }
    if (!downloadOk) {
      // Clipboard fallback: try modern API first, fall back to execCommand path for older browsers / sandboxes.
      var copied = false;
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(c).then(function(){
          alert("Download blocked in this environment. CSV copied to clipboard — paste into a text editor and save as "+filename+".");
        }, function(){
          // Modern clipboard API rejected (often: not in user gesture, or document not focused). Fall through.
          legacyCopy();
        });
        return;
      }
      legacyCopy();
      function legacyCopy(){
        try {
          var ta = document.createElement("textarea");
          ta.value = c;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          copied = document.execCommand("copy");
          document.body.removeChild(ta);
        } catch(_){copied = false;}
        if (copied) {
          alert("Download blocked in this environment. CSV copied to clipboard — paste into a text editor and save as "+filename+".");
        } else {
          // Last resort: open the CSV in a new tab so the user can copy/save manually.
          var w = window.open();
          if (w) {
            w.document.write("<pre style='font-family:monospace;font-size:12px;padding:1rem;'>"+c.replace(/&/g,"&amp;").replace(/</g,"&lt;")+"</pre>");
            w.document.title = filename;
          } else {
            alert("Could not export CSV: download blocked, clipboard unavailable, and popup blocked. Try the deployed app on Vercel where downloads work directly.");
          }
        }
      }
    }
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
  var reset=function(){
    try {
      // First: clear all state synchronously so React re-renders to landing.
      setCfg(defaultCfg());
      setTab(0);
      setRes(null);
      setPl([EP()]);
      setDet([]);
      setDbg(false);
      setMathRow(null);
      setPicks({});
      setResultsExpanded({});
      setExpanded({});
      setCmp(false);
      setSpikeSets([{plate:"1",endo:"0",spiked:"1",spikeProtein:"GFP",stockConc:"500",stockUnit:"ug/uL",spikeVol:"10",spikeVolUnit:"uL",sampleVol:"1000",sampleVolUnit:"uL",noEndo:false}]);
      setActivePlate(0);
      setCollapsedPlate(false);
      setPlanningMode(false);
      setOn(false);
      // Belt-and-suspenders: if for any reason the React state path didn't return to landing,
      // force a hard reload after a short delay. This is a no-op if state reset already worked
      // (the page just reloads to the same fresh-landing state). If state reset failed silently,
      // this guarantees the user sees a clean landing.
      setTimeout(function(){
        try { window.location.reload(); } catch(_e) {}
      }, 100);
    } catch (e) {
      window.alert("Reset failed: " + (e && e.message ? e.message : String(e)) + "\n\nForcing page reload.");
      try { window.location.reload(); } catch(_e) {}
    }
  };
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
          var xf1 = pDil(cfg.xdf) * pOptionalDil(cfg.smpPredil), xs = pDil(cfg.xds);
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
  // Shared summary-row builder for the Recommendations summary and the Results "Show summary of picks"
  // disclosure. Pass strategyId="literature" for the canonical ICH M10 view (Recommendations default), or
  // pass the currently selected sm to mirror what the analyst sees on Results.
  // Each row carries BOTH the algorithm pick (per strategyId) and the analyst's actual reported pick (gsc),
  // plus a `disagrees` flag set when the two differ. Recovery is included for the analyst pick context only,
  // since that's what the analyst is actually reporting.
  var buildSummaryRows = function(strategyId){
    if(!res) return [];
    return res.flatMap(function(pp,pi){return pp.samps.map(function(s,si){
      var algoPick = s.aS && s.aS[strategyId];
      var analystPick = gsc(pi, si);  // respects picks[]; falls back to active strategy when no override
      var srs = spikeRowsForSample(pi,si);
      var rec = srs.length>0 ? srs[0].recovery : null;
      // disagrees: the dilution chosen by the algorithm differs from the analyst's reported dilution.
      // null-handling: if either side has no qualified pick, no disagreement (we just show "—").
      var algoDil = algoPick && algoPick.dil!=null ? algoPick.dil : null;
      var analystDil = analystPick && analystPick.dil!=null ? analystPick.dil : null;
      // Look up the actual DF FRACTION for each picked dilution index. samp.dils[i].df already stores
      // it (e.g. 0.1 for a 1:10). This is what the table's "at 1:10" subscript needs.
      var algoDilDf = null, analystDilDf = null;
      if (algoDil != null && s.dils) {
        var aRow = s.dils.find(function(d){return d.di === algoDil;});
        if (aRow) algoDilDf = aRow.df;
      }
      if (analystDil != null && s.dils) {
        var bRow = s.dils.find(function(d){return d.di === analystDil;});
        if (bRow) analystDilDf = bRow.df;
      }
      var disagrees = (algoDil!=null && analystDil!=null && algoDil !== analystDil);
      return {
        pi: pi+1,
        plateIdx: pi,
        sampleIdx: si,
        name: s.name,
        algoDil: algoDil,
        algoDilDf: algoDilDf,
        algoCv: algoPick && algoPick.cv!=null ? algoPick.cv : null,
        algoConc: algoPick && algoPick.conc!=null ? algoPick.conc : null,
        analystDil: analystDil,
        analystDilDf: analystDilDf,
        analystCv: analystPick && analystPick.cv!=null ? analystPick.cv : null,
        analystConc: analystPick && analystPick.conc!=null ? analystPick.conc : null,
        recovery: rec,
        disagrees: disagrees,
        // hasOverride: did the analyst explicitly click a radio button (vs. accepting algorithm)?
        // picks[plate-sample] is set only on explicit click.
        hasOverride: !!picks[pi+"-"+si]
      };
    });});
  };
  // SST helpers — bridge between cfg (JSON-stringified dict) and the SystemSuitabilityCard component.
  // cfg.sstExpected is "{}" by default; values are stored as strings of the expected concentration in BASE unit (cfg.unit).
  // The card receives a parsed object for read access and a setter that writes individual keys back.
  var sstExpectedDict = (function(){
    try {
      var parsed = JSON.parse(cfg.sstExpected || "{}");
      return (parsed && typeof parsed === "object") ? parsed : {};
    } catch(_){ return {}; }
  })();
  var setSSTExpected = function(key, value){
    var next = {};
    for (var k in sstExpectedDict) next[k] = sstExpectedDict[k];
    if (value === "" || value == null) {
      delete next[key];
    } else {
      next[key] = String(value);
    }
    u("sstExpected", JSON.stringify(next));
  };
  // sstFlags: manual SST designation. Lets the analyst pick from the existing sample list and tag a sample
  // as SST without renaming it. Stored as JSON string {key: true} where key="plateIdx-sampleIdx".
  var sstFlagsDict = (function(){
    try {
      var parsed = JSON.parse(cfg.sstFlags || "{}");
      return (parsed && typeof parsed === "object") ? parsed : {};
    } catch(_){ return {}; }
  })();
  var toggleSSTFlag = function(key, on){
    var next = {};
    for (var k in sstFlagsDict) next[k] = sstFlagsDict[k];
    if (on) next[key] = true;
    else delete next[key];
    u("sstFlags", JSON.stringify(next));
  };
  // analystPickFor: returns the analyst's reported pick for the given (plate, sample) in BASE unit.
  // Used by the SST card so it can pull the "observed" value with all manual overrides honored.
  var analystPickFor = function(pi, si){
    var pick = gsc(pi, si);
    if (!pick) return null;
    return { conc: pick.conc, dil: pick.dil, cv: pick.cv };
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
  var changeFitAndReanalyze = function(newFm){
    if (newFm === cfg.fm) return;
    u("fm", newFm);
    setPendingReanalyze(true);
  };
  var confirmAnalyze=function(){
    setAnalyzeError(""); // clear any previous error
    // Autosampler-mode validation: source of truth is cfg.msInjections, not pl[]
    if (cfg.layout === "autosampler") {
      var injections = (function(){try{var x=JSON.parse(cfg.msInjections||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
      // Need at least 2 Standard rows with valid level numbers AND at least one numeric rep each
      var stdLevelsWithData = {};
      var anySampleHasData = false;
      injections.forEach(function(r){
        var hasRep = (r.reps||[]).some(function(v){return isFinite(parseFloat(v)) && parseFloat(v) > 0;});
        if (!hasRep) return;
        if (r.sampleType === "Standard") {
          var lv = parseInt(r.levelOrDilution);
          if (isFinite(lv) && lv >= 1) stdLevelsWithData[lv] = true;
        } else if (r.sampleType === "Unknown" || r.sampleType === "SST") {
          anySampleHasData = true;
        }
      });
      var nStdLevelsWithData = Object.keys(stdLevelsWithData).length;
      if (nStdLevelsWithData < 2) {
        setAnalyzeError("Need data in at least 2 Standard rows (with level numbers) before analyzing. Paste your peak-area values into the Data Entry table above.");
        return;
      }
      // Also confirm the standard curve definition is set (top conc + DF, or discrete list)
      var hasStdDef = false;
      if (cfg.asStdMode === "discrete") {
        var lvls = (function(){try{var x=JSON.parse(cfg.asDiscreteLevels||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
        var validCount = lvls.filter(function(v){return isFinite(parseFloat(v)) && parseFloat(v) > 0;}).length;
        if (validCount >= 2) hasStdDef = true;
      } else {
        var topC = parseFloat(cfg.asTopConc);
        var sdf = pDil(cfg.asSerialDF);
        if (isFinite(topC) && topC > 0 && isFinite(sdf) && sdf > 0 && sdf < 1) hasStdDef = true;
      }
      if (!hasStdDef) {
        setAnalyzeError("Set the Standard curve definition in General Information first — top concentration + serial dilution factor (or discrete level list).");
        return;
      }
      analyze();
      return;
    }
    // Plate-mode validation (original logic below)
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
    if(cfg.stdPredil && isNaN(pDil(cfg.stdPredil))) bad.push("standard pre-plate dilution");
    if(cfg.smpPredil && isNaN(pDil(cfg.smpPredil))) bad.push("sample pre-plate dilution");
    if(bad.length){
      window.alert("Cannot analyze: please fix these field(s) — "+bad.join(", ")+".\n\nDilution factors should be entered as '1/2' (for 1:2 dilution), '1/10', etc.");
      return;
    }
    // No confirmation dialog — user already clicked the Analyze button intentionally.
    // Run analysis and navigate to Analysis tab.
    analyze();
  };
  // Reanalyze trigger: when changeFitAndReanalyze sets pendingReanalyze=true, this effect fires
  // on the next render (after cfg.fm has propagated to the new value), runs confirmAnalyze with
  // the fresh closure that sees the new cfg, and clears the flag. Avoids the stale-closure issue
  // that prevented the in-canvas fit picker from triggering a re-analysis.
  useEffect(function(){
    if (pendingReanalyze) {
      setPendingReanalyze(false);
      confirmAnalyze();
    }
  }, [pendingReanalyze, cfg.fm]);

  if(!on) return (
    <div style={{padding:"1.25rem 0 2.5rem",maxWidth:1060}}>
      <div style={{background:"linear-gradient(180deg,#f4f9fd,#eef5fb)",border:"1px solid "+BORDER,borderRadius:20,marginBottom:"1rem",boxShadow:SHADOW,overflow:"hidden"}}>
        <PageHeader instructor={instructor} setInstructor={setInstructor} large={true} />
        <div style={{padding:"6px 20px 16px",fontSize:14,color:"#5a6984",fontStyle:"italic"}}>Curve, qualify, validate.</div>
      </div>
      <div style={{background:"linear-gradient(180deg,#ffffff,#fbfdff)",borderRadius:24,border:"1px solid "+BORDER,padding:"1.5rem",boxShadow:"0 18px 44px rgba(11,42,111,0.08)",marginBottom:"1.25rem"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:"1rem",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:21,fontWeight:800,color:"#18233f",marginBottom:5}}>Assay setup</div>
            <div style={{fontSize:13,color:"#6f7fa0"}}>{cfg.layout==="autosampler"?"Vial-based assay (LC-MS, intact mass, LC quant).":"Plate-based assay — pick plate count and replicate layout."}</div>
          </div>
        </div>
        {/* ── Step 1: Assay mode toggle ──
            Top-level Plate vs Vials picker. Drives everything else on the page. Switching modes
            also nudges cfg.fm to a sensible default (loglog for vials, linear for plates) so the
            user doesn't get stuck with a stale fit choice from the other mode.
        */}
        <div style={{background:"linear-gradient(180deg,#fbfeff,#f4fbff)",border:"1px solid #e5edf7",borderRadius:20,padding:"1.2rem 1.25rem",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.8)",marginBottom:"1rem"}}>
          <label style={{display:"block",fontSize:13,fontWeight:800,marginBottom:10,color:"#18233f"}}>What are you doing today?</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            {[
              {id:"plate",   title:"Plate assay",  desc:"96-well plate, microplate reader. Classical or transposed orientation, multi-plate support.", isSel: cfg.layout!=="autosampler", color:TEAL},
              {id:"vials",   title:"Vials / autosampler",  desc:"LC-MS, intact mass quant, or LC peak-area quant. Each row in your data is one injection.", isSel: cfg.layout==="autosampler", color:TEAL},
              {id:"tools",   title:"Tools (no data needed)", desc:"Plan a validation experiment, calculate spike volumes, design a dilution series, or convert units — without setting up an assay.", isSel:false, color:"#6337b9"}
            ].map(function(opt){
              return <button key={opt.id} onClick={function(){
                if (opt.id === "vials") {
                  u("layout","autosampler");
                  if (cfg.fm !== "linear" && cfg.fm !== "loglog" && cfg.fm !== "auto" && cfg.fm !== "4pl" && cfg.fm !== "5pl") u("fm","linear");
                  else if (cfg.fm === "loglog" || cfg.fm === "auto") u("fm","linear");
                } else if (opt.id === "tools") {
                  // Skip assay setup. Jump to Tools tab in planning mode.
                  setOn(true); setTab(4); setPlanningMode(true);
                } else {
                  if (cfg.layout === "autosampler") u("layout","classical");
                  if (cfg.fm === "loglog" || cfg.fm === "auto") u("fm", cfg.at === "elisa" ? "4pl" : "linear");
                }
              }} style={{textAlign:"left",cursor:"pointer",border:"2px solid "+(opt.isSel?opt.color:"#d8dfeb"),background:opt.isSel?(opt.color===TEAL?"#eefcfd":"#f5f0ff"):"#fff",borderRadius:14,padding:"14px 16px",boxShadow:opt.isSel?"0 8px 20px rgba(19,156,182,0.10)":"none",transition:"all 0.15s"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:14,fontWeight:800,color:opt.isSel?NAVY:"#18233f"}}>{opt.title}</span>
                  {opt.isSel && <span style={{fontSize:10,color:opt.color,fontWeight:700,padding:"2px 7px",background:"#fff",borderRadius:10,border:"1px solid "+opt.color}}>SELECTED</span>}
                </div>
                <div style={{fontSize:12,color:"#5a6984",lineHeight:1.5}}>{opt.desc}</div>
              </button>;
            })}
          </div>
        </div>
        {cfg.layout!=="autosampler" && <div style={{display:"grid",gridTemplateColumns:"1.25fr 1fr",gap:"1rem"}}>
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
            {cfg.layout==="transposed_mixed" ? (function(){
              // Standard always takes first cfg.sr rows of LEFT half. Pattern then resets per half.
              var srN = Math.max(1, parseInt(cfg.sr)||3);
              var mixParsed = parseRepMix(cfg.xrMix || "3,3,2");
              var pattern = mixParsed.valid ? mixParsed.parts : [];
              // Simulate per-half allocation
              var allocate = function(rowsAvail){
                var out = []; var idx = 0; var rem = rowsAvail;
                while (rem > 0 && out.length < 50 && pattern.length > 0) {
                  var n = pattern[idx % pattern.length];
                  if (n > rem) { out.push({n:rem, partial:true}); rem = 0; }
                  else { out.push({n:n, partial:false}); rem -= n; }
                  idx++;
                }
                return out;
              };
              var leftSamples = mixParsed.valid ? allocate(8 - srN) : [];
              var rightSamples = mixParsed.valid ? allocate(8) : [];
              var totalSamples = leftSamples.length + rightSamples.length;
              var anyPartial = leftSamples.some(function(s){return s.partial;}) || rightSamples.some(function(s){return s.partial;});
              return <div>
                <label style={{display:"block",fontSize:13,fontWeight:800,marginBottom:7,color:"#18233f"}}>Replicate setup</label>
                <div style={{fontSize:11,color:"#6f7fa0",marginBottom:10,lineHeight:1.5}}>The standard curve takes the first row(s) of the left half. Sample reps fill the rest of the left half, then the rep pattern restarts on the right half. Samples never span halves.</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.9rem",marginBottom:10}}>
                  <div>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Standard replicates</label>
                    <select value={cfg.sr} onChange={function(e){u("sr",e.target.value);}} style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}}>
                      <option value="1">Singlicate (1 half-row)</option>
                      <option value="2">Duplicate (2 half-rows)</option>
                      <option value="3">Triplicate (3 half-rows)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Rep mix</label>
                    <input type="text" value={cfg.xrMix} onChange={function(e){u("xrMix",e.target.value);}} placeholder="e.g. 3,3,2" style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid "+(mixParsed.valid?"#d8dfeb":"#e8b8b8"),fontSize:14,color:"#1d1d1f",background:mixParsed.valid?"#fff":"#fdf3f3",fontFamily:"monospace"}} />
                  </div>
                </div>
                <div style={{fontSize:11,color:"#5a6984",padding:"7px 10px",background:mixParsed.valid?"#f7f1ff":"#fdf3f3",borderRadius:8,border:"1px solid "+(mixParsed.valid?"#e2d7fb":"#f5b7b1"),lineHeight:1.5}}>
                  {!mixParsed.valid ? <span><strong style={{color:"#a02c1c"}}>Invalid:</strong> {mixParsed.error}. Use a comma-separated list of positive integers.</span>
                  : <span><strong>This setup:</strong> Standard takes {srN} half-row{srN===1?"":"s"} (top of left half). Then {totalSamples} sample{totalSamples===1?"":"s"}: left half = [{leftSamples.map(function(s){return s.n+(s.partial?"*":"");}).join(", ") || "—"}], right half = [{rightSamples.map(function(s){return s.n+(s.partial?"*":"");}).join(", ") || "—"}].{anyPartial && <span style={{color:"#a02c1c"}}> *Partial — pattern didn't fit cleanly.</span>}</span>}
                </div>
              </div>;
            })() : cfg.layout==="transposed" ? <div>
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
        </div>}
        {cfg.layout==="autosampler" && <div style={{display:"grid",gridTemplateColumns:"1.25fr 1fr",gap:"1rem"}}>
          {/* Left panel: sample count with chunky number buttons + override (mirrors "How many plates?") */}
          <div style={{background:"linear-gradient(180deg,#fbfeff,#f4fbff)",border:"1px solid #e5edf7",borderRadius:20,padding:"1.2rem 1.25rem",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.8)"}}>
            <label style={{display:"block",fontSize:13,fontWeight:800,marginBottom:12,color:"#18233f"}}>How many samples?</label>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
              {[1,2,3,4,5].map(function(n){var sel=String(n)===cfg.asNSamples;return <button key={n} onClick={function(){u("asNSamples",String(n));}} style={{width:58,height:58,borderRadius:16,border:"1.5px solid "+(sel?TEAL:"#d8dfeb"),background:sel?"#eefcfd":"#fff",color:sel?NAVY:"#1d1d1f",fontSize:21,fontWeight:700,cursor:"pointer",boxShadow:sel?"0 8px 20px rgba(19,156,182,0.10)":"none"}}>{n}</button>;})}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:12,color:"#6f7fa0"}}>Use a different sample count:</span>
              <input type="number" min="1" max="50" value={cfg.asNSamples} onChange={function(e){u("asNSamples",e.target.value);}} style={{width:84,padding:"10px 12px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}} />
            </div>
          </div>
          {/* Right panel: replicate cards + dilution-level cards in a 2x2 grid */}
          <div style={{background:"linear-gradient(180deg,#fbfeff,#f4fbff)",border:"1px solid #e5edf7",borderRadius:20,padding:"1.2rem 1.25rem",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.8)"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.9rem"}}>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Standard replicates</label>
                <select value={cfg.sr} onChange={function(e){u("sr",e.target.value);}} style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}}>
                  <option value="1">Singlicate</option>
                  <option value="2">Duplicate</option>
                  <option value="3">Triplicate</option>
                </select>
              </div>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Sample replicates</label>
                <select value={cfg.xr} onChange={function(e){u("xr",e.target.value);}} style={{width:"100%",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}}>
                  <option value="1">Singlicate</option>
                  <option value="2">Duplicate</option>
                  <option value="3">Triplicate</option>
                </select>
              </div>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Standard dilution levels</label>
                <input type="number" min="2" max="20" value={cfg.asNStdLevels||"6"} onChange={function(e){u("asNStdLevels",e.target.value);}} style={{width:"100%",boxSizing:"border-box",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}} />
              </div>
              <div>
                <label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:7,color:"#18233f"}}>Sample dilution levels</label>
                <input type="number" min="1" max="12" value={cfg.asNDilutions||"3"} onChange={function(e){u("asNDilutions",e.target.value);}} style={{width:"100%",boxSizing:"border-box",padding:"10px 11px",borderRadius:12,border:"1px solid #d8dfeb",fontSize:14,color:"#1d1d1f",background:"#fff"}} />
              </div>
            </div>
            <div style={{fontSize:11,color:"#5a6984",marginTop:10,padding:"7px 10px",background:"#eefcfd",borderRadius:8,border:"1px solid #c9eaef",lineHeight:1.5}}>
              <strong>This setup:</strong> {(parseInt(cfg.asNStdLevels)||6)} standard level{(parseInt(cfg.asNStdLevels)||6)===1?"":"s"} × {parseInt(cfg.sr)||3} rep{(parseInt(cfg.sr)||3)===1?"":"s"}, plus {(parseInt(cfg.asNSamples)||3)} sample{(parseInt(cfg.asNSamples)||3)===1?"":"s"} × {parseInt(cfg.asNDilutions)||3} dilution{(parseInt(cfg.asNDilutions)||3)===1?"":"s"} × {parseInt(cfg.xr)||3} rep{(parseInt(cfg.xr)||3)===1?"":"s"}. The data-entry table will be pre-seeded with these rows when you continue.
            </div>
          </div>
        </div>}
        {cfg.layout!=="autosampler" && <div style={{marginTop:"1.25rem",background:"linear-gradient(180deg,#fbfeff,#f4fbff)",border:"1px solid #e5edf7",borderRadius:20,padding:"1.2rem 1.25rem",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.8)"}}>
          <label style={{display:"block",fontSize:13,fontWeight:800,marginBottom:4,color:"#18233f"}}>Plate orientation</label>
          <div style={{fontSize:12,color:"#6f7fa0",marginBottom:14}}>Pick the orientation that matches how you loaded the plate. The math is the same; only the wells map differently.</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(0, 1fr))",gap:14}}>
            {(function(){
              var renderOpt=function(id, title, blurb, svg){
                var sel = cfg.layout===id;
                return <button key={id} onClick={function(){
                  u("layout",id);
                  // Side-effect: default to linear when switching modes (unless ELISA → 4PL).
                  // "auto" remains an opt-in choice via the in-canvas fit picker.
                  if (id === "autosampler" && cfg.fm !== "linear" && cfg.fm !== "loglog" && cfg.fm !== "auto" && cfg.fm !== "4pl" && cfg.fm !== "5pl") {
                    u("fm", "linear");
                  } else if (id === "autosampler" && (cfg.fm === "loglog" || cfg.fm === "auto")) {
                    u("fm", "linear");
                  } else if (id !== "autosampler" && (cfg.fm === "loglog" || cfg.fm === "auto")) {
                    u("fm", cfg.at === "elisa" ? "4pl" : "linear");
                  }
                }} style={{textAlign:"left",cursor:"pointer",border:"2px solid "+(sel?TEAL:"#d8dfeb"),background:sel?"#eefcfd":"#fff",borderRadius:14,padding:"12px 14px",boxShadow:sel?"0 8px 20px rgba(19,156,182,0.10)":"none",transition:"all 0.15s"}}>
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
                return <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%",height:"auto",maxWidth:W,display:"block"}} xmlns="http://www.w3.org/2000/svg">
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

              // === TRANSPOSED MIXED-REP GRAPHIC (data-driven from cfg.xrMix; standard always present, pattern resets per half) ===
              var transposedMixedSvg = (function(){
                var srT = Math.max(1, parseInt(cfg.sr)||3);
                var mixParsed = parseRepMix(cfg.xrMix || "3,3,2");
                var pattern = mixParsed.valid ? mixParsed.parts : [1];
                var slotOwner = {};
                // LEFT HALF
                for (var rL=0; rL<srT && rL<8; rL++) slotOwner[rL+"-0"] = {type:"std", colors:stdColor, name:"Std"};
                var sIdxLeft = 0;
                var patIdxL = 0;
                var rowL = srT;
                while (rowL < 8) {
                  var n = pattern[patIdxL % pattern.length];
                  var rowsLeft = 8 - rowL;
                  if (n > rowsLeft) n = rowsLeft;
                  var col = sampleColors[sIdxLeft % sampleColors.length];
                  for (var k=0; k<n; k++) slotOwner[(rowL+k)+"-0"] = {type:"smp", sIdx:sIdxLeft, colors:col, name:"Sample "+(sIdxLeft+1)};
                  rowL += n; sIdxLeft++; patIdxL++;
                }
                // RIGHT HALF — pattern restarts, sample numbering continues from where left half stopped
                var sIdxRight = sIdxLeft;
                var patIdxR = 0;
                var rowR = 0;
                while (rowR < 8) {
                  var n2 = pattern[patIdxR % pattern.length];
                  var rowsLeftR = 8 - rowR;
                  if (n2 > rowsLeftR) n2 = rowsLeftR;
                  var col2 = sampleColors[sIdxRight % sampleColors.length];
                  for (var k2=0; k2<n2; k2++) slotOwner[(rowR+k2)+"-1"] = {type:"smp", sIdx:sIdxRight, colors:col2, name:"Sample "+(sIdxRight+1)};
                  rowR += n2; sIdxRight++; patIdxR++;
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
              // Vial-rack illustration for autosampler option. Same dimensions as the plate SVGs so visual weight balances.
              // Drawn as a small grid of circles representing vials in a tray (e.g., 4 rows × 6 cols = 24 vials).
              var autosamplerSvg = (function(){
                var rows = 4, cols = 6;
                var trayW = 220, trayH = 120;
                var pad = 16;
                var vialR = 7;
                var stepX = (trayW - 2*pad) / (cols - 1);
                var stepY = (trayH - 2*pad) / (rows - 1);
                var vials = [];
                for(var r=0;r<rows;r++){
                  for(var c=0;c<cols;c++){
                    var idx = r*cols + c;
                    // Color a few vials to suggest standards (teal) and SST (purple) and samples (amber).
                    var fill = "#dde5f0", stroke = "#aebcd0";
                    if(c===0){ fill="#cdf2f8"; stroke="#139cb6"; }       // first column: standards
                    else if(idx===8 || idx===15){ fill="#f0e3ff"; stroke="#6337b9"; } // SSTs
                    else if(c<5){ fill="#ffe7c7"; stroke="#bf7a1a"; }                 // samples
                    vials.push({cx: pad+c*stepX, cy: pad+r*stepY, fill:fill, stroke:stroke});
                  }
                }
                return <svg viewBox={"0 0 "+trayW+" "+trayH} style={{width:"100%",height:"auto",maxWidth:trayW,display:"block"}}>
                  <rect x="2" y="2" width={trayW-4} height={trayH-4} rx="10" ry="10" fill="#f9fbfd" stroke="#d8dfeb" strokeWidth="1" />
                  {vials.map(function(v,i){return <circle key={i} cx={v.cx} cy={v.cy} r={vialR} fill={v.fill} stroke={v.stroke} strokeWidth="1.2" />;})}
                </svg>;
              })();
              return [
                renderOpt("classical","Classical (column-wise)","Each column is one sample (or the standard). Each row is a dilution step. Bottom row is the blank. The default for hand-loaded plates and most ELISA workflows.",classicalSvg),
                renderOpt("transposed","Transposed (row-wise, uniform reps)","Each row is one sample. Each column is a dilution step. The middle and last columns are blanks. Up to 16 sample slots — pair both halves for replicates, or run singlicates and fit twice as many samples.",transposedSvg),
                renderOpt("transposed_mixed","Transposed (row-wise, mixed reps)","Same row-wise layout as Transposed, but each sample can have a different replicate count. Useful when you need one sample with 3 reps next to two more with 2 reps each, etc. Pattern is applied symmetrically to both halves.",transposedMixedSvg)
              ];
            })()}
          </div>
        </div>}
        <div style={{display:"flex",gap:12,marginTop:"1.35rem",alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={function(){
            // In autosampler mode, if the data-entry table is empty, pre-seed it with rows based on
            // the landing-page settings: cfg.asNStdLevels Standard rows + cfg.asNSamples × cfg.asNDilutions Unknown rows.
            // The analyst can edit / add / delete from there.
            if (cfg.layout === "autosampler") {
              var existing = (function(){try{var x=JSON.parse(cfg.msInjections||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
              if (existing.length === 0) {
                var nStdLevels = parseInt(cfg.asNStdLevels) || 6;
                var nSamples = parseInt(cfg.asNSamples) || 3;
                var nSampleDils = parseInt(cfg.asNDilutions) || 3;
                var nStdReps = parseInt(cfg.sr) || 3;
                var nSmpReps = parseInt(cfg.xr) || 3;
                var nMaxReps = Math.max(nStdReps, nSmpReps);
                var emptyReps = function(n){var a = []; for (var i=0;i<n;i++) a.push(""); return a;};
                var seeded = [];
                // Standard rows: one per level. Names left empty so user fills them in (or pastes).
                for (var lvl = 1; lvl <= nStdLevels; lvl++) {
                  seeded.push({sampleType: "Standard", sampleName: "", levelOrDilution: String(lvl), reps: emptyReps(nMaxReps)});
                }
                // Sample rows: nSampleDils per sample, nSamples samples. Names left empty.
                for (var si = 1; si <= nSamples; si++) {
                  for (var di = 0; di < nSampleDils; di++) {
                    seeded.push({sampleType: "Unknown", sampleName: "", levelOrDilution: "", reps: emptyReps(nMaxReps)});
                  }
                }
                u("msInjections", JSON.stringify(seeded));
              }
            }
            setOn(true);setTab(0);setPlanningMode(false);
          }} style={{background:"linear-gradient(135deg,"+TEAL_DARK+","+NAVY+")",color:"#fff",border:"none",padding:"11px 22px",borderRadius:12,fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:"0 10px 22px rgba(11,42,111,0.12)"}}>Continue to workspace</button>
          <button onClick={demo} style={{background:"transparent",border:"1px solid #d8dfeb",padding:"11px 18px",borderRadius:12,fontSize:12,color:"#6e6e73",cursor:"pointer",fontWeight:600}}>Load demo</button>
          <span style={{fontSize:11,color:"#6f7fa0"}}>The app will wait here until setup is confirmed.</span>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{padding:"1rem 0",maxWidth:1040}}>
      <div style={{background:"linear-gradient(180deg,#f4f9fd,#eef5fb)",border:"1px solid "+BORDER,borderRadius:20,marginBottom:"1rem",boxShadow:SHADOW,overflow:"hidden"}}>
        <PageHeader instructor={instructor} setInstructor={setInstructor} onReset={reset} onSecretTap={htc} />
      </div>
      <div style={{display:"flex",gap:6,marginBottom:"1.25rem",background:"#eef3f8",borderRadius:14,padding:5,border:"1px solid #e2e9f2"}}>{TABS.map(function(l,i){return <button key={i} onClick={function(){setTab(i);}} style={{flex:1,padding:"9px 14px",fontSize:12,fontWeight:i===tab?700:500,cursor:"pointer",background:i===tab?"#fff":"transparent",color:i===tab?NAVY:"#6e6e73",border:"none",borderRadius:10,boxShadow:i===tab?"0 4px 14px rgba(11,42,111,0.08)":"none"}}>{l}</button>;})}
      {dbg&&<button onClick={function(){setTab(5);}} style={{padding:"9px 14px",fontSize:12,fontWeight:tab===5?700:500,cursor:"pointer",background:tab===5?"#fef3e2":"transparent",color:tab===5?"#a05a00":"#aeaeb2",border:"none",borderRadius:10}}>Debug</button>}</div>

      {/* DATA ENTRY */}
      {tab===0&&(<div>
        {cfg.layout!=="autosampler" && <div style={{background:"#edf9fb",borderRadius:14,padding:"12px 16px",marginBottom:"1rem",border:"1px solid #d9eef2"}}><p style={{margin:0,fontSize:13,color:"#0f5c4d"}}>Paste data into the first cell. Analysts can leave the optional sample name list collapsed and work directly from the familiar plate grid.</p></div>}
        {/* ── Plate tab strip (shown only when np > 1) ── */}
        {cfg.layout!=="autosampler" && np > 1 && (function(){
          // hasData[pi] = true if any cell in that plate is non-empty
          var hasData = Array.from({length:np}, function(_,pi){
            var d = pl[pi];
            if(!d) return false;
            for(var r=0;r<8;r++) for(var c=0;c<12;c++) if(d[r]&&d[r][c]&&d[r][c].trim()) return true;
            return false;
          });
          return <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"#6e6e73",marginRight:4}}>Plate:</span>
            {Array.from({length:np},function(_,pi){
              var active = pi===activePlate;
              var filled = hasData[pi];
              return <button key={pi} onClick={function(){setActivePlate(pi);setCollapsedPlate(false);}}
                style={{padding:"4px 13px",borderRadius:20,border:active?"1.5px solid #0b2a6f":"1.5px solid #d0d8ea",background:active?"#0b2a6f":"transparent",color:active?"#fff":"#5a6984",fontSize:12,fontWeight:active?700:500,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                {pi+1}
                <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:filled?(active?"#7ee8c8":"#1d9e75"):"#d0d8ea",flexShrink:0}} title={filled?"has data":"empty"} />
              </button>;
            })}
          </div>;
        })()}

        {/* ── Single-plate grid: only render the active plate ── */}
        {cfg.layout!=="autosampler" && Array.from({length:np},function(_,pi){
          if(pi !== activePlate) return null;  // only show active plate

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
                // No window.confirm — some sandboxed iframes suppress it. Click clears immediately.
                setPl(function(p){var n=p.slice();n[pi]=EP();return n;});
                setDet(function(p){var n=p.slice();n[pi]=null;return n;});
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
        {/* ── AUTOSAMPLER ENTRY: flat injection-list table (vials), v5bq ─────
            Like v5bp but:
              - Type cell is plain text in the row's accent color with a dotted underline; click to change.
              - Single "+ Add row" button (defaults to Unknown); type changed via the type cell.
              - Optional sample-names paste textarea (mirrors plate workflow's "Sample labels" details).
                Names map to Unknown/SST rows in order, skipping Standard/Blank.
              - White input cells with grey grid lines; standards now teal (matches plate workflow's
                #d70015 Standard accent text + teal row tint).
              - Hatched cells for trailing rep columns the row didn't fill (flag visually unused).
        */}
        {cfg.layout==="autosampler" && (function(){
          var rows = (function(){try{var x=JSON.parse(cfg.msInjections||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
          var setRows = function(next){u("msInjections", JSON.stringify(next));};

          var ensureReps = function(reps, n){
            var out = (reps || []).slice();
            while (out.length < n) out.push("");
            return out;
          };
          // Total column count for the rep section = max of standard reps and sample reps from cfg.
          // Each row's "expected rep count" is determined by its type (Standard → cfg.sr, others → cfg.xr).
          // Cells past a row's expected count are hatched. So if cfg.sr=3 and cfg.xr=2, the table has
          // 3 rep columns; Sample/SST/Blank rows get Rep 3 hatched permanently.
          var nStdReps = parseInt(cfg.sr) || 3; if (nStdReps < 1) nStdReps = 1;
          var nSmpReps = parseInt(cfg.xr) || 3; if (nSmpReps < 1) nSmpReps = 1;
          var maxReps = Math.max(nStdReps, nSmpReps, 1);

          // Auto-DF for non-Standard rows (same logic as v5bp)
          var firstDF  = pDil(cfg.xdf || "1/10");  if (!isFinite(firstDF) || firstDF<=0) firstDF = 0.1;
          var serialDF = pDil(cfg.xds || "1/2");   if (!isFinite(serialDF) || serialDF<=0) serialDF = 0.5;
          var sampleSeenCount = {};
          var rowAutoDF = rows.map(function(r){
            if (r.sampleType !== "Unknown" && r.sampleType !== "SST") return null;
            var nm = (r.sampleName||"").trim();
            if (!nm) return null;
            var idx = sampleSeenCount[nm] || 0;
            sampleSeenCount[nm] = idx + 1;
            return firstDF * Math.pow(serialDF, idx);
          });
          var fmtDF = function(df){
            if (df==null || !isFinite(df) || df<=0) return "";
            if (df >= 1) return df.toFixed(2)+"×";
            var n = 1/df;
            var r2 = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1);
            return "1:"+r2;
          };

          // Color rotation — shared GC palette (defined at module level, used by plate workflow too)
          // so vials and plate look identical. Standard always uses GC[0] (teal). SST always uses
          // GC[8] (violet/purple). Each unique Unknown sample name gets its own GC index by
          // first-appearance order, starting at GC[1] and skipping GC[0] (standard) and GC[8] (SST).
          var STD_GC = GC[0];          // teal
          var SST_GC = GC[8];          // violet
          var BLANK_GC = {bg:"#f4f4f6", hd:"#dcd9cb", tx:"#444441", cell:"#fafafa"};
          // Build a list of palette indices available for Unknowns (skip standard's and SST's slots)
          var UNK_GC_INDICES = [];
          for (var gci = 1; gci < GC.length; gci++) { if (gci !== 8) UNK_GC_INDICES.push(gci); }
          var unknownColorMap = {};
          (function(){
            var idx = 0;
            rows.forEach(function(r){
              if (r.sampleType !== "Unknown") return;
              var nm = (r.sampleName||"").trim();
              if (!nm) return;
              if (!(nm in unknownColorMap)) {
                unknownColorMap[nm] = UNK_GC_INDICES[idx % UNK_GC_INDICES.length];
                idx++;
              }
            });
          })();
          var rowColor = function(r){
            // Returns an object with: bg (row tint), text (accent text color), hd (header tint, used for hatching darker line)
            if (r.sampleType === "Standard") return {bg:STD_GC.cell, text:STD_GC.tx, hd:STD_GC.hd};
            if (r.sampleType === "SST")      return {bg:SST_GC.cell, text:SST_GC.tx, hd:SST_GC.hd};
            if (r.sampleType === "Blank")    return {bg:BLANK_GC.cell, text:BLANK_GC.tx, hd:BLANK_GC.hd};
            var nm = (r.sampleName||"").trim();
            var gcIdx = (nm && nm in unknownColorMap) ? unknownColorMap[nm] : UNK_GC_INDICES[0];
            var theme = GC[gcIdx];
            return {bg:theme.cell, text:theme.tx, hd:theme.hd};
          };
          // Type-cell text color — matches plate workflow's Standard/Sample label coloring:
          //   Standard = "#d70015" (the red used for "Standard" word in plate General Info)
          //   Sample (Unknown/SST) = "#30437a" (the navy used for "Sample" word in plate General Info)
          //   Blank = gray
          var typeTextColor = function(r){
            if (r.sampleType === "Standard") return "#d70015";
            if (r.sampleType === "Blank")    return "#5F5E5A";
            return "#30437a";
          };

          // Helper to read fresh rows from cfg at mutation time (avoids stale closure)
          var freshRows = function(){
            try { var x = JSON.parse(cfg.msInjections||"[]"); return Array.isArray(x) ? x : []; }
            catch(_) { return []; }
          };
          // Mutators — all read fresh state to avoid stale-closure issues across rapid edits
          var addRow = function(){
            var fr = freshRows();
            setRows(fr.concat([{sampleName: "", sampleType: "Unknown", levelOrDilution: "", reps: ensureReps([], maxReps)}]));
          };
          var rmRow = function(i){
            var fr = freshRows();
            var n = fr.slice(); n.splice(i,1);
            setRows(n);
          };
          var setField = function(i, field, value){
            var fr = freshRows();
            var n = fr.slice();
            if (i >= n.length) return;
            var r = Object.assign({}, n[i]); r[field] = value;
            n[i] = r;
            setRows(n);
          };
          var setRep = function(i, repIdx, value){
            var fr = freshRows();
            var n = fr.slice();
            if (i >= n.length) return;
            var r = Object.assign({}, n[i]);
            r.reps = ensureReps(r.reps, repIdx+1);
            r.reps[repIdx] = value;
            n[i] = r;
            setRows(n);
          };
          var clearAll = function(){
            // Clear ALL user-entered data: sample names AND rep values. Keep the row scaffold:
            // sampleType (Standard/Unknown/SST/Blank) and levelOrDilution (for Standards).
            // No confirm dialog — some sandboxed browsers suppress confirm.
            var fresh = (function(){try{var x=JSON.parse(cfg.msInjections||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
            if (fresh.length === 0) return;
            var freshMax = Math.max(parseInt(cfg.sr) || 3, parseInt(cfg.xr) || 3, 1);
            var n = fresh.map(function(r){
              return Object.assign({}, r, {
                sampleName: "",
                reps: ensureReps([], freshMax)
              });
            });
            setRows(n);
          };

          // Type changer — when user clicks the type cell, swap to a select. Done with a parallel
          // state of "edit mode for which row's type" via React state. Since we don't have local
          // state in this functional block, we use a simple inline approach: render the type as
          // both a hidden select (always present, click-through-able) and visible text. The native
          // <select> sits on top transparent so clicks open the dropdown; the rendered text shows
          // the current value with the dotted underline.
          var TYPE_OPTIONS = ["Standard", "Unknown", "SST", "Blank"];

          // Inline cell-paste — handles three formats from clipboard:
          //   (a) Tab-separated worklist with Type col: Type | Name | Level | Rep1 [Rep2 ...]   (4+ cols)
          //   (b) Tab-separated worklist without Type col: Name | Level | Rep1 [Rep2 ...]      (3+ cols)
          //   (c) Plain names list (one per line, no tabs) → handled by the dedicated names textarea
          //
          // PASTE MAPS ONTO EXISTING ROWS IN ORDER.
          //   - For row N in clipboard ↔ row N in table (1:1).
          //   - sampleType is PRESERVED from the existing row (never overwritten by paste)
          //     UNLESS the clipboard explicitly has a Type column. Rationale: if the user defined
          //     "5 standards then 9 unknowns" on landing page, the paste should respect that scaffold
          //     even if the paste's data shape might suggest otherwise.
          //   - levelOrDilution: take from paste if it's non-empty AND the existing row is a Standard;
          //     else keep existing (auto-derived for non-Standard).
          //   - sampleName: always take from paste.
          //   - reps: always take from paste.
          //   - If clipboard has MORE rows than the table, append extras with inferred type.
          //   - If clipboard has FEWER rows, leave trailing existing rows untouched.
          //
          // Header row detection: if the first row's cells contain words like "sample"/"name"/"type"/"rep"/"level"/"dilution"
          // and no numeric cells, treat it as a header and skip.
          var inlinePaste = function(e){
            var clip = (e.clipboardData || window.clipboardData);
            if (!clip) return;
            var text = clip.getData("text");
            if (!text) return;
            // No tab → not a worklist; let normal paste flow into the cell
            if (text.indexOf("\t") < 0) return;
            var lines = text.split(/\r?\n/).filter(function(s){return s.trim().length>0;});
            if (lines.length < 1) return;

            // Header detection
            var firstParts = lines[0].split(/\t/);
            var looksHeaderish = firstParts.some(function(p){
              return /sample|name|type|rep|level|dilution/i.test(p) && !/\d/.test(p.replace(/(\s|sample|name|type|rep|level|dilution|if|std|standard)/gi,""));
            });
            if (looksHeaderish) lines = lines.slice(1);
            if (lines.length < 1) return;

            // Detect column format from first data line
            var detect = lines[0].split(/\t/);
            var col0 = (detect[0]||"").trim().toLowerCase();
            var hasTypeCol = (col0 === "standard" || col0 === "std" || col0 === "unknown" || col0 === "unk" || col0 === "sst" || col0 === "blank");

            e.preventDefault();
            // Read fresh existing rows (not closure copy) so this handler always sees the latest scaffold
            var existing = (function(){try{var x=JSON.parse(cfg.msInjections||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();

            // Build a list of "paste rows" — parsed clipboard data, each with optional explicit type
            var pasteRows = [];
            lines.forEach(function(line){
              var parts = line.split(/\t/);
              if (parts.length < 3) return;
              var typeRaw, name, ld, repCells;
              if (hasTypeCol) {
                if (parts.length < 4) return;
                typeRaw = (parts[0]||"").trim().toLowerCase();
                name = (parts[1]||"").trim();
                ld = (parts[2]||"").trim();
                repCells = parts.slice(3);
              } else {
                name = (parts[0]||"").trim();
                ld = (parts[1]||"").trim();
                repCells = parts.slice(2);
                typeRaw = "";
              }
              if (!name) return;
              repCells = repCells.map(function(s){
                var t = (s||"").trim();
                if (t === "-" || t === "−" || t === "") return "";
                return t;
              });
              while (repCells.length > 0 && repCells[repCells.length-1] === "") repCells.pop();
              if (repCells.length === 0) return;
              // Determine explicit type only if hasTypeCol; else mark for inference (used only when appending new rows)
              var explicitType = null;
              if (hasTypeCol) {
                if (/^std/i.test(typeRaw) || /standard/i.test(typeRaw)) explicitType = "Standard";
                else if (/^sst$/i.test(typeRaw) || /suit/i.test(typeRaw)) explicitType = "SST";
                else if (/^blank$/i.test(typeRaw)) explicitType = "Blank";
                else explicitType = "Unknown";
              }
              pasteRows.push({name: name, levelOrDilution: ld, reps: repCells, explicitType: explicitType});
            });
            if (pasteRows.length === 0) return;

            // Map paste rows onto existing rows in order; preserve types beyond clipboard's explicit override
            var merged = existing.slice();
            for (var i = 0; i < pasteRows.length; i++) {
              var pr = pasteRows[i];
              if (i < merged.length) {
                // Update existing row: PRESERVE sampleType (unless clipboard had explicit Type col)
                var existingRow = merged[i];
                var newRow = Object.assign({}, existingRow);
                if (pr.explicitType) {
                  newRow.sampleType = pr.explicitType;
                }
                // Sample name: always update from paste
                newRow.sampleName = pr.name;
                // Level / Dilution handling per row type:
                //   - Standard: the paste's level column is an integer level number → store as-is
                //   - Unknown / SST: the paste's level column might be a dilution override (1/10,
                //     1:20, 0.05). If it parses as a valid dilution AND row is Unknown/SST, store
                //     it as a per-row override. Otherwise leave empty (use auto-derived).
                //   - Blank: always empty.
                if (pr.levelOrDilution && newRow.sampleType === "Standard") {
                  newRow.levelOrDilution = pr.levelOrDilution;
                } else if (pr.levelOrDilution && (newRow.sampleType === "Unknown" || newRow.sampleType === "SST")) {
                  // Try to parse as a dilution. If it works, store as override.
                  var pasteAsDF = pDil(pr.levelOrDilution);
                  if (isFinite(pasteAsDF) && pasteAsDF > 0 && pasteAsDF <= 1) {
                    newRow.levelOrDilution = pr.levelOrDilution;  // keep original string format
                  } else {
                    newRow.levelOrDilution = "";  // unparseable → use auto
                  }
                } else if (newRow.sampleType !== "Standard") {
                  newRow.levelOrDilution = "";
                }
                // Reps: always update
                newRow.reps = pr.reps;
                merged[i] = newRow;
              } else {
                // Append: new row doesn't exist in scaffold, so infer type from data
                var inferredType;
                if (pr.explicitType) {
                  inferredType = pr.explicitType;
                } else if (/^blank$/i.test(pr.name)) {
                  inferredType = "Blank";
                } else if (/(^|[^a-z])sst([^a-z]|$)/i.test(pr.name) || /sys[\s_-]*suit/i.test(pr.name) || /system[\s_-]*suit/i.test(pr.name) || /suitab/i.test(pr.name)) {
                  inferredType = "SST";
                } else if (/^\d+$/.test(pr.levelOrDilution) && parseInt(pr.levelOrDilution) >= 1 && parseInt(pr.levelOrDilution) <= 30) {
                  inferredType = "Standard";
                } else {
                  inferredType = "Unknown";
                }
                // For non-Standard appended rows, store paste's level column as override if it parses as a dilution.
                var appendedLD = "";
                if (inferredType === "Standard") {
                  appendedLD = pr.levelOrDilution;
                } else if (inferredType === "Unknown" || inferredType === "SST") {
                  if (pr.levelOrDilution) {
                    var df = pDil(pr.levelOrDilution);
                    if (isFinite(df) && df > 0 && df <= 1) {
                      appendedLD = pr.levelOrDilution;
                    }
                  }
                }
                merged.push({
                  sampleName: pr.name,
                  sampleType: inferredType,
                  levelOrDilution: appendedLD,
                  reps: pr.reps
                });
              }
            }
            // Ensure all rep arrays are padded to the table's column count (max of cfg.sr / cfg.xr)
            var newMax = Math.max(parseInt(cfg.sr) || 3, parseInt(cfg.xr) || 3, merged.reduce(function(m,r){return Math.max(m,(r.reps||[]).length);}, 0));
            merged = merged.map(function(r){return Object.assign({}, r, {reps: ensureReps(r.reps, newMax)});});
            setRows(merged);
          };

          // Paste sample names list → fills Unknown/SST rows in order.
          // Reads rows fresh from cfg.msInjections at apply time (not the closure-captured `rows`)
          // so multiple pastes in quick succession don't clobber each other.
          var applyPastedNames = function(text){
            var names = text.split(/[,\n]/).map(function(s){return s.trim();}).filter(Boolean);
            if (names.length === 0) return;
            var fresh = (function(){try{var x=JSON.parse(cfg.msInjections||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
            var n = fresh.slice();
            var ni = 0;
            for (var i = 0; i < n.length && ni < names.length; i++) {
              if (n[i].sampleType === "Unknown" || n[i].sampleType === "SST") {
                n[i] = Object.assign({}, n[i], {sampleName: names[ni++]});
              }
            }
            // If we ran out of rows, append remaining names as new Unknown rows.
            var freshMaxReps = n.reduce(function(m,r){return Math.max(m, (r.reps||[]).length);}, 0) || 2;
            while (ni < names.length) {
              n.push({sampleName: names[ni++], sampleType: "Unknown", levelOrDilution: "", reps: ensureReps([], freshMaxReps)});
            }
            setRows(n);
          };

          // Match plate-grid table style: light grey grid lines, transparent input cells, neutral
          // header bg, navy text. All values pulled from the plate workflow at lines 5297, 5275 etc.
          var tdBase = {padding:0,border:"1px solid #d1d1d6",verticalAlign:"middle"};
          var thBase = {padding:"8px 8px",fontFamily:"monospace",fontWeight:700,fontSize:11,background:"#f4f4f6",color:"#30437a",border:"1px solid #d1d1d6",textAlign:"center"};
          var inputCellStyle = {width:"100%",boxSizing:"border-box",border:"none",padding:"6px 6px",fontSize:11,fontFamily:"monospace",textAlign:"right",background:"transparent",outline:"none",color:"#1d1d1f"};
          var hatchedStyle = function(rowBg){
            return {
              backgroundColor: rowBg,
              backgroundImage: "repeating-linear-gradient(45deg,transparent 0 4px,rgba(0,0,0,0.07) 4px 5px)",
              color:"#a8a8a8",
              padding:"6px 6px",
              textAlign:"center",
              fontFamily:"monospace",
              fontSize:11
            };
          };

          return <div>
            {/* Compact toolbar: just the Clear data button on the right (no instructions banner —
                the table is intuitive enough). Matches plate-mode placement of Clear data. */}
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:"0.6rem"}}>
              <button onClick={clearAll} title="Clear all peak-area values (keeps sample names, types, levels)" style={{background:"#fff",border:"1px solid #d8dfeb",color:"#6e6e73",padding:"5px 11px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}>
                <span style={{fontSize:13,lineHeight:1}}>×</span>
                Clear data
              </button>
            </div>

            {/* Main injection table */}
            <div style={{background:"#fff",borderRadius:8,border:"0.5px solid #d1d1d6",padding:0,marginBottom:"0.85rem",overflow:"hidden"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{borderCollapse:"collapse",width:"100%",fontSize:11}}>
                  <thead>
                    <tr>
                      <th style={Object.assign({},thBase,{textAlign:"left",width:110})}>Sample Type</th>
                      <th style={Object.assign({},thBase,{textAlign:"left",minWidth:140})}>Sample name</th>
                      <th style={Object.assign({},thBase,{lineHeight:1.3,width:120})}>
                        <div>Dilution Level</div>
                        <div style={{fontFamily:"monospace",fontWeight:500,fontSize:9,color:"#8e9bb5"}}>(if Std)</div>
                      </th>
                      {Array.from({length:maxReps}, function(_,i){
                        return <th key={i} style={Object.assign({},thBase,{minWidth:90})}>Rep {i+1}</th>;
                      })}
                      <th style={Object.assign({},thBase,{padding:"8px 4px",width:24,border:"1px solid #d1d1d6"})}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && <tr>
                      <td colSpan={4+maxReps} style={{padding:"30px 16px",textAlign:"center",fontSize:12,color:"#8e9bb5",fontStyle:"italic",background:"#f9fbfd",border:"1px solid #d1d1d6"}}>
                        No injections yet. Click <strong>+ Add row</strong> below to start.
                        <div style={{marginTop:6,fontSize:11,color:"#aeaeb2"}}>Define your standard concentrations in <strong>General Information</strong> below first.</div>
                      </td>
                    </tr>}
                    {rows.map(function(r, i){
                      var isStd = r.sampleType === "Standard";
                      var isBlank = r.sampleType === "Blank";
                      var col = rowColor(r);
                      var typeColor = typeTextColor(r);

                      // Level cell content
                      var ldContent = null;
                      if (isStd) {
                        // Always show the computed concentration below the level number — the analyst
                        // needs to know what each level represents (not just instructors). If the
                        // conc can't be computed (top conc / DF not yet set), show nothing rather
                        // than a noisy fallback message.
                        var preview = null;
                        var lv = parseInt(r.levelOrDilution);
                        if (isFinite(lv) && lv >= 1) {
                          var c = asStandardConcForLevel(lv, cfg);
                          if (c != null) preview = sig3(c)+" "+cfg.unit;
                        }
                        ldContent = <div style={{padding:"4px 6px",textAlign:"center"}}>
                          <input
                            type="text"
                            value={r.levelOrDilution || ""}
                            onChange={function(e){setField(i,"levelOrDilution",e.target.value);}}
                            placeholder="1"
                            style={{width:"100%",boxSizing:"border-box",padding:"4px 6px",border:"none",fontSize:11,textAlign:"center",fontFamily:"monospace",background:"transparent",outline:"none",color:col.text,fontWeight:700}}
                            title="Integer level number — concentration computed from General Information"
                          />
                          {preview && <div style={{fontFamily:"monospace",fontSize:9,color:col.text,marginTop:2,fontStyle:"italic",opacity:0.85}}>{preview}</div>}
                        </div>;
                      } else if (isBlank) {
                        ldContent = <div style={{padding:"6px",textAlign:"center",color:"#aeaeb2",fontSize:11}}>—</div>;
                      } else {
                        // Unknown / SST: hybrid — global default (cfg.xdf + cfg.xds + row order)
                        // OR per-row override (user types into the cell).
                        // If r.levelOrDilution is non-empty AND parses as a valid dilution,
                        // it's the override. Otherwise fall back to the auto-derived value.
                        var rawOverride = (r.levelOrDilution || "").trim();
                        var overrideDF = null;
                        if (rawOverride !== "") {
                          var parsedDF = pDil(rawOverride);
                          if (isFinite(parsedDF) && parsedDF > 0 && parsedDF <= 1) overrideDF = parsedDF;
                        }
                        var autoDF = rowAutoDF[i];
                        var effectiveDF = overrideDF != null ? overrideDF : autoDF;
                        var isOverride = overrideDF != null;
                        // Format the auto DF for placeholder display when nothing is typed
                        var autoPlaceholder = autoDF != null ? fmtDF(autoDF) : "1/10";
                        ldContent = <div style={{padding:"4px 6px",textAlign:"center"}}>
                          <input
                            type="text"
                            value={r.levelOrDilution || ""}
                            onChange={function(e){setField(i,"levelOrDilution",e.target.value);}}
                            placeholder={autoPlaceholder}
                            style={{
                              width:"100%",boxSizing:"border-box",padding:"4px 6px",
                              border:"none",fontSize:11,textAlign:"center",fontFamily:"monospace",
                              background:"transparent",outline:"none",
                              color: isOverride ? col.text : "#aeaeb2",
                              fontWeight: isOverride ? 700 : 400,
                              fontStyle: isOverride ? "normal" : "italic"
                            }}
                            title={"Per-row dilution factor. Type 1/10, 1:10, or 0.1. Leave blank to use the auto-derived value from General Info (Sample first DF + serial DF)."}
                          />
                          {effectiveDF != null && <div style={{fontFamily:"monospace",fontSize:9,color:col.text,marginTop:2,fontStyle:"italic",opacity:0.85}}>
                            {isOverride ? "= "+fmtDF(effectiveDF) : "auto"}
                          </div>}
                        </div>;
                      }

                      // Hatching: declarative by row type, not based on what the user has filled.
                      // Each row's expected rep count comes from its type:
                      //   Standard → cfg.sr (standard replicates)
                      //   Unknown / SST / Blank → cfg.xr (sample replicates)
                      // Cells past that count are permanently hatched and read-only — "no data
                      // expected here" — independent of what the user's typed.
                      var rowExpectedReps = isStd ? nStdReps : nSmpReps;

                      return <tr key={i} style={{background:col.bg}}>
                        {/* Sample Type cell — text in row-accent color, dotted underline, click to dropdown */}
                        <td style={Object.assign({},tdBase,{textAlign:"left"})}>
                          <div style={{position:"relative",display:"inline-block",padding:"6px 12px"}}>
                            <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:typeColor,borderBottom:"1px dotted "+typeColor,opacity:0.95,cursor:"pointer",pointerEvents:"none"}}>{r.sampleType||"Unknown"}</span>
                            <select
                              value={r.sampleType||"Unknown"}
                              onChange={function(e){
                                var newType = e.target.value;
                                // Read fresh and combine type+level update in one setRows call.
                                var fr = freshRows();
                                var n = fr.slice();
                                if (i >= n.length) return;
                                var rowCopy = Object.assign({}, n[i], {sampleType: newType});
                                if (newType === "Standard") {
                                  if (!/^\d+$/.test(String(rowCopy.levelOrDilution||""))) {
                                    rowCopy.levelOrDilution = String(fr.filter(function(rr){return rr.sampleType==="Standard";}).length + 1);
                                  }
                                } else {
                                  rowCopy.levelOrDilution = "";
                                }
                                n[i] = rowCopy;
                                setRows(n);
                              }}
                              style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",fontSize:11,fontFamily:"inherit",border:"none",background:"transparent",appearance:"none",WebkitAppearance:"none"}}
                              title="Change sample type"
                            >
                              {TYPE_OPTIONS.map(function(t){return <option key={t} value={t}>{t}</option>;})}
                            </select>
                          </div>
                        </td>
                        {/* Sample name — borderless input that takes the row-accent color.
                            First row's placeholder shows just "paste" (italic) when no name has
                            been typed yet — matches plate workflow's paste-cell convention. */}
                        <td style={Object.assign({},tdBase,{padding:"4px 8px"})}>
                          <input
                            type="text"
                            value={r.sampleName||""}
                            onChange={function(e){setField(i,"sampleName",e.target.value);}}
                            onPaste={inlinePaste}
                            placeholder={i===0 && rows.every(function(rr){return !(rr.sampleName||"").trim();}) ? "paste" : ""}
                            style={{width:"100%",boxSizing:"border-box",padding:"4px 6px",border:"none",fontSize:11,fontFamily:"monospace",background:"transparent",color:col.text,fontWeight:700,outline:"none",fontStyle:i===0 && rows.every(function(rr){return !(rr.sampleName||"").trim();}) && !(r.sampleName||"").trim() ? "italic" : "normal"}}
                          />
                        </td>
                        {/* Dilution Level cell */}
                        <td style={Object.assign({},tdBase)}>{ldContent}</td>
                        {/* Rep cells — white input for cells within the row's expected reps,
                            hatched (read-only) for cells past the row type's rep count */}
                        {Array.from({length:maxReps}, function(_,rep){
                          var v = (r.reps||[])[rep] || "";
                          // Declarative: hatch any cell whose index is past the row type's expected rep count
                          if (rep >= rowExpectedReps) {
                            return <td key={rep} style={Object.assign({},tdBase,hatchedStyle(col.bg))} title={"No data expected — "+(isStd?"Standard reps = "+nStdReps:"Sample reps = "+nSmpReps)}>−</td>;
                          }
                          return <td key={rep} style={tdBase}>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={v}
                              onChange={function(e){setRep(i,rep,e.target.value);}}
                              placeholder="−"
                              title={(r.sampleName||("Sample "+(i+1)))+" — Rep "+(rep+1)}
                              style={inputCellStyle}
                            />
                          </td>;
                        })}
                        {/* Delete row */}
                        <td style={Object.assign({},tdBase,{padding:"4px 4px",textAlign:"center"})}>
                          <button onClick={function(){rmRow(i);}} title="Remove row" style={{padding:"0 6px",fontSize:14,fontWeight:700,color:"#b4332e",background:"transparent",border:"none",cursor:"pointer",lineHeight:1}}>×</button>
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Action buttons — single Add row. Rep count is set on landing page / General Info.
                Status line shows whether the analyst's data is in a state where Analyze will succeed. */}
            {(function(){
              // Compute live data readiness
              var stdLevelsWithData = {};
              var unkRowsWithData = 0;
              rows.forEach(function(r){
                var hasRep = (r.reps||[]).some(function(v){return isFinite(parseFloat(v)) && parseFloat(v) > 0;});
                if (!hasRep) return;
                if (r.sampleType === "Standard") {
                  var lv = parseInt(r.levelOrDilution);
                  if (isFinite(lv) && lv >= 1) stdLevelsWithData[lv] = true;
                } else if (r.sampleType === "Unknown" || r.sampleType === "SST") {
                  unkRowsWithData++;
                }
              });
              var nStdLevelsFilled = Object.keys(stdLevelsWithData).length;
              var hasStdDef = false;
              if (cfg.asStdMode === "discrete") {
                var lvls = (function(){try{var x=JSON.parse(cfg.asDiscreteLevels||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
                hasStdDef = lvls.filter(function(v){return parseFloat(v) > 0;}).length >= 2;
              } else {
                hasStdDef = parseFloat(cfg.asTopConc) > 0 && pDil(cfg.asSerialDF) > 0 && pDil(cfg.asSerialDF) < 1;
              }
              var ready = nStdLevelsFilled >= 2 && hasStdDef;
              return <div style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap",alignItems:"center"}}>
                <button onClick={addRow} style={{padding:"7px 14px",background:"#fff",border:"1px solid #d8dfeb",borderRadius:8,fontSize:11,fontWeight:600,color:"#30437a",cursor:"pointer"}}>+ Add row</button>
                <span style={{flex:1,minWidth:20}}></span>
                <span style={{fontSize:10,color:ready?"#1b7f6a":"#8e9bb5",fontStyle:"italic",fontFamily:"monospace"}}>
                  {ready ? "✓ ready to analyze: " : "needs more: "}
                  {nStdLevelsFilled} std level{nStdLevelsFilled===1?"":"s"} with data · {unkRowsWithData} sample row{unkRowsWithData===1?"":"s"} with data{!hasStdDef ? " · curve def missing in General Info" : ""}
                </span>
              </div>;
            })()}

            {/* Sample labels paste textarea — collapsible, mirrors plate workflow.
                User types or pastes names, then clicks "Apply names" to push them into the rows.
                The textarea content is intentionally persistent — no auto-apply, no auto-clear —
                so the user has a clear record of what they entered and can re-apply if needed.
                A ref is used to read the textarea content at apply time (no React state needed). */}
            <details style={{marginBottom:"1.25rem",background:"#fff",borderRadius:14,border:"1px solid "+BORDER,padding:"0.85rem 1rem",boxShadow:"0 6px 18px rgba(11,42,111,0.03)"}}>
              <summary style={{fontSize:13,fontWeight:700,cursor:"pointer",color:"#30437a"}}>Sample labels (optional)</summary>
              <p style={{fontSize:12,color:"#6e6e73",margin:"10px 0 8px",lineHeight:1.5}}>
                Paste or type one sample name per line (or comma-separated), then click <strong>Apply names</strong>. Names auto-fill the Unknown / SST rows in order, skipping Standards and Blanks.
                <span style={{display:"block",marginTop:6,fontStyle:"italic",color:"#8e9bb5"}}>If there are more names than existing rows, the extras are added as new Unknown rows.</span>
              </p>
              {(function(){
                // Use a closure-captured DOM ref (assigned via ref callback) so we read the textarea
                // value at click time, not from React state. This avoids a re-render when the user types.
                var taRef = {current: null};
                return <div>
                  <textarea
                    ref={function(el){taRef.current = el;}}
                    rows={4}
                    placeholder={"2026GFP\n2025GFP\nSST mid"}
                    style={{width:"100%",boxSizing:"border-box",padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,fontFamily:"monospace",outline:"none",resize:"vertical"}}
                  />
                  <div style={{display:"flex",gap:8,marginTop:8,alignItems:"center"}}>
                    <button onClick={function(){
                      var v = (taRef.current && taRef.current.value) || "";
                      if (v.trim().length === 0) return;
                      applyPastedNames(v);
                    }} style={{padding:"6px 14px",background:"linear-gradient(135deg,"+TEAL_DARK+","+NAVY+")",color:"#fff",border:"none",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer"}}>Apply names</button>
                    <button onClick={function(){
                      if (taRef.current) taRef.current.value = "";
                    }} style={{padding:"6px 12px",background:"#fff",border:"1px solid #d8dfeb",color:"#6e6e73",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer"}}>Clear textbox</button>
                  </div>
                </div>;
              })()}
            </details>
          </div>;
        })()}

        {/* Sample names text input — plate modes only. In autosampler mode, names come from per-sample blocks. */}
        {cfg.layout!=="autosampler" && <details style={{marginBottom:"1rem",background:SURFACE,borderRadius:14,border:"1px solid "+BORDER,padding:"0.85rem 1rem",boxShadow:"0 6px 18px rgba(11,42,111,0.03)"}}>
          <summary style={{fontSize:13,fontWeight:700,cursor:"pointer",color:"#30437a"}}>Sample labels (optional)</summary>
          <p style={{fontSize:12,color:"#6e6e73",margin:"10px 0 8px",lineHeight:1.5}}>
            Paste one sample name per line, in the order they appear on the plate. The app assigns them automatically.
            <span style={{display:"block",marginTop:6,fontStyle:"italic",color:"#8e9bb5"}}>The standard is added automatically — don't include it here. Only enter your unknowns.</span>
            {layout.axis==="row" && <span style={{display:"block",marginTop:6,padding:"6px 10px",background:"#f7f1ff",borderRadius:6,border:"1px solid #e2d7fb",color:"#5a6984"}}>
              <strong>Transposed order:</strong> down the left half first (top to bottom, skipping the standard's slot{(parseInt(cfg.sr)||2)>1?"s":""}), then down the right half. With your current setup, you can name up to <strong>{smpGroups.length} samples</strong>.
            </span>}
          </p>
          <textarea value={cfg.names} onChange={function(e){u("names",e.target.value);}} rows={4} placeholder={"Sample A\nSample B\nSample C\nSample D"} style={{width:"100%",boxSizing:"border-box",padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,fontFamily:"monospace",outline:"none",resize:"vertical"}} />
        </details>}
        <div style={{background:SURFACE,borderRadius:18,border:"1px solid "+BORDER,padding:"1.25rem",marginBottom:"1.25rem",boxShadow:"0 8px 22px rgba(11,42,111,0.04)"}}>
        <div style={{background:"linear-gradient(135deg,"+NAVY+", "+TEAL_DARK+")",color:"#fff",padding:"10px 16px",borderRadius:12,fontSize:14,fontWeight:800,marginBottom:"1rem",boxShadow:"0 10px 22px rgba(11,42,111,0.16)"}}>General information</div>
        {[
          ...(cfg.layout!=="autosampler" ? [
          ["Is this a total protein assay?",<select value={cfg.tp} onChange={function(e){var v=e.target.value;if(v==="yes"){u("tp","yes");u("at","direct");u("fm","linear");}else{u("tp","no");}}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}><option value="no">No</option><option value="yes">Yes</option></select>],
          ...(cfg.tp==="no"?[["Is this an ELISA?",<select value={cfg.at==="elisa"?"yes":"no"} onChange={function(e){var v=e.target.value;if(v==="yes"){u("at","elisa");u("fm",cfg.fm==="5pl"?"5pl":"4pl");}else{u("at","direct");u("fm","linear");}}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}><option value="no">No</option><option value="yes">Yes</option></select>]]:[])
          ] : []),
          ["Standard Protein Used",<input value={cfg.sn} onChange={function(e){u("sn",e.target.value);}} style={{width:"100%",boxSizing:"border-box",padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none"}} />],
          ...((cfg.layout!=="autosampler" && cfg.tp==="no") || cfg.layout==="autosampler"?[["Target protein",<input value={cfg.target} onChange={function(e){u("target",e.target.value);}} placeholder="e.g. GFP, IL-6" style={{width:"100%",boxSizing:"border-box",padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none"}} />]]:[]),
          ...(cfg.layout==="autosampler"
            ? [
                // Standard curve config: how the analyst defines per-level concentrations.
                // Serial mode = top conc + DF; the app computes Level 1 = top, Level 2 = top×DF, ...
                // Discrete mode = analyst types each level's concentration directly into a small list.
                // The mode toggle lives on the landing page; here we just show the value editor.
                // Concentration unit is merged inline (next to the top conc input or per-level header).
                [<div><span style={{color:"#d70015",fontWeight:700}}>Standard</span> curve definition</div>,<div>
                  {/* Level numbering toggle — lets the analyst decide whether Level 1 is the top
                      (highest concentration) or the bottom (lowest concentration). Some labs label
                      their standards starting from the lowest, others from the highest. */}
                  <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:10,fontSize:11,color:"#5a6984"}}>
                    <span style={{fontWeight:600}}>Level numbering:</span>
                    <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer"}}>
                      <input type="radio" name="asLevelOrder" value="highest" checked={(cfg.asLevelOrder||"highest")!=="lowest"} onChange={function(){u("asLevelOrder","highest");}} />
                      Level 1 = highest
                    </label>
                    <label style={{display:"inline-flex",alignItems:"center",gap:5,cursor:"pointer"}}>
                      <input type="radio" name="asLevelOrder" value="lowest" checked={(cfg.asLevelOrder||"highest")==="lowest"} onChange={function(){u("asLevelOrder","lowest");}} />
                      Level 1 = lowest
                    </label>
                  </div>
                  {cfg.asStdMode!=="discrete" ? <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontSize:10,color:"#5a6984",marginBottom:3,fontWeight:600}}>Top concentration ({(cfg.asLevelOrder||"highest")==="lowest" ? "Level "+(parseInt(cfg.asNStdLevels)||6) : "Level 1"})</div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <input type="number" step="any" value={cfg.asTopConc} onChange={function(e){u("asTopConc",e.target.value);}} placeholder="e.g. 100" style={{width:110,padding:"7px 10px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none"}} />
                        <select value={cfg.unit} onChange={function(e){u("unit",e.target.value);}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}>{CONC_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}</select>
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:"#5a6984",marginBottom:3,fontWeight:600}}>Serial dilution factor</div>
                      <input value={cfg.asSerialDF} onChange={function(e){u("asSerialDF",e.target.value);}} placeholder="1/2" style={{width:90,padding:"7px 10px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,fontFamily:"monospace"}} title="Each level is the previous one × this factor. Accepts '1/2', '1:2', or '0.5'." />
                    </div>
                  </div> : (function(){
                    // Discrete mode: editable list. User adds/removes rows manually; default shows 5 rows.
                    var list = (function(){try{var x=JSON.parse(cfg.asDiscreteLevels||"[]");return Array.isArray(x)?x:[];}catch(_){return[];}})();
                    var displayLen = Math.max(list.length, 5);
                    var setList = function(next){u("asDiscreteLevels",JSON.stringify(next));};
                    var setLevel = function(idx, val){var n=list.slice();while(n.length<=idx)n.push("");n[idx]=val;setList(n);};
                    var addLevel = function(){setList(list.concat([""]));};
                    var rmLevel = function(idx){var n=list.slice();n.splice(idx,1);setList(n);};
                    return <div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <span style={{fontSize:10,color:"#5a6984",fontWeight:600}}>Per-level concentration in</span>
                        <select value={cfg.unit} onChange={function(e){u("unit",e.target.value);}} style={{padding:"5px 8px",borderRadius:6,border:"1px solid #e5e5ea",fontSize:11}}>{CONC_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}</select>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:6,marginBottom:6}}>
                        {Array.from({length:displayLen}, function(_,i){
                          return <div key={i} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 8px",background:"#fff",border:"1px solid #e5e5ea",borderRadius:6}}>
                            <span style={{fontSize:10,color:"#5a6984",fontWeight:700,minWidth:24}}>L{i+1}</span>
                            <input type="number" step="any" value={list[i]||""} onChange={function(e){setLevel(i,e.target.value);}} placeholder="0.0" style={{flex:1,minWidth:0,padding:"3px 6px",borderRadius:4,border:"1px solid #e5e5ea",fontSize:11,fontFamily:"monospace",textAlign:"right"}} />
                            {i>=5 && <button onClick={function(){rmLevel(i);}} title="Remove" style={{padding:"0 4px",fontSize:11,color:"#b4332e",background:"transparent",border:"none",cursor:"pointer"}}>×</button>}
                          </div>;
                        })}
                      </div>
                      <button onClick={addLevel} style={{padding:"4px 10px",background:"#fff",border:"1px solid #d0d8ea",borderRadius:6,fontSize:10,fontWeight:600,color:"#30437a",cursor:"pointer"}}>+ Add level</button>
                    </div>;
                  })()}
                </div>],
                // Sample-block dilution count is no longer relevant in flat-list workflow.
                // Each row in the data-entry table IS one dilution. Standard / sample level counts
                // are set on the landing page as defaults; analyst adds/removes rows as needed.
                // Blanks are also added as rows (with sample type "Blank") rather than via toggle.
              ]
            : [[<div>Concentration of the <span style={{color:"#d70015",fontWeight:700}}>Standard</span> <span style={{color:"#d70015",fontStyle:"italic",fontWeight:700}}>stock</span></div>,<div style={{display:"flex",alignItems:"center",gap:8}}><input type="number" step="any" value={cfg.sc} onChange={function(e){u("sc",e.target.value);}} style={{width:120,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none"}} /><select value={cfg.unit} onChange={function(e){u("unit",e.target.value);}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}>{CONC_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}</select></div>]]
          ),
          ...(cfg.layout!=="autosampler" ? [
          [<div><div>Dilution Factor</div><div>used on first</div><div>row of <span style={{color:"#d70015",fontWeight:700}}>Standard</span></div></div>,<div>
            {(function(){
              var locked = cfg.stdPredil && !isNaN(pDil(cfg.stdPredil)) && pOptionalDil(cfg.stdPredil)!==1;
              var combined = locked ? pDil(cfg.sdf)*pOptionalDil(cfg.stdPredil) : null;
              var showPanel = cfg.showStdPredilPanel;
              if(locked) return <div>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:8,border:"1px solid #d0dff0",background:"#f5f8fc",fontFamily:"monospace",fontSize:13,color:"#0b2a6f"}}>
                  {fmtDilution(combined,dilFormat,100000)}
                  <span style={{fontSize:10,fontWeight:700,color:"#8a5a00",background:"#fff7e0",border:"1px solid #e8c77d",borderRadius:5,padding:"2px 7px"}}>adjusted</span>
                </div>
                <div style={{fontSize:10,color:"#8a5a00",marginTop:4,lineHeight:1.4}}>= {fmtDilution(pDil(cfg.sdf),dilFormat,100000)} first-row × {fmtDilution(pOptionalDil(cfg.stdPredil),dilFormat,100000)} pre-plate. App uses {fmtDilution(combined,dilFormat,100000)} for back-calc.</div>
                <button onClick={function(){u("stdPredil","");u("showStdPredilPanel",false);}} style={{background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:"2px 0",marginTop:4,textDecoration:"underline",textDecorationStyle:"dotted"}}>Undo pre-plate adjustment</button>
              </div>;
              return <div>
                <input value={cfg.sdf} onChange={function(e){u("sdf",e.target.value);}} placeholder="1/2" style={{width:140,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none",fontFamily:"monospace"}} />
                {pDil(cfg.sdf)>0 && !showPanel && <button onClick={function(){u("showStdPredilPanel",true);}} style={{display:"block",background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:"2px 0",marginTop:5,textDecoration:"underline",textDecorationStyle:"dotted",fontStyle:"italic"}}>I diluted my Standard STOCK before adding to the plate</button>}
                {showPanel && <div style={{marginTop:8,padding:"10px 12px",background:"#f7fbff",border:"1px solid #c6d3e8",borderRadius:10}}>
                  <div style={{fontSize:11,color:"#30437a",lineHeight:1.5,marginBottom:6}}>Enter the dilution you applied to your Standard STOCK (listed above) before it touched the plate — e.g. <code>1/10</code>. The app multiplies this into the first-row value so your dilution fields stay unchanged.</div>
                  <input value={cfg.stdPredil||""} onChange={function(e){u("stdPredil",e.target.value);}} placeholder="e.g. 1/10" style={{width:130,padding:"7px 10px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:12,fontFamily:"monospace",outline:"none"}} />
                  {(function(){var f=pDil(cfg.sdf),p=pOptionalDil(cfg.stdPredil);if(!cfg.stdPredil||isNaN(f)||p===1)return null;return <div style={{marginTop:6,fontSize:11,color:"#7a4a00",lineHeight:1.45}}>✓ App will use <strong style={{fontFamily:"monospace"}}>{fmtDilution(f*p,dilFormat,100000)}</strong> for Standard row 1 ({fmtDilution(f,dilFormat,100000)} × {fmtDilution(p,dilFormat,100000)}). The field above stays as entered.</div>;})()}
                  <button onClick={function(){u("showStdPredilPanel",false);}} style={{background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:"2px 0",marginTop:6,textDecoration:"underline",textDecorationStyle:"dotted"}}>Cancel</button>
                </div>}
              </div>;
            })()}
          </div>],
          [<div><div>Dilution Factor</div><div>used on second</div><div>and remaining</div><div>rows of <span style={{color:"#d70015",fontWeight:700}}>Standard</span></div></div>,<input value={cfg.sds} onChange={function(e){u("sds",e.target.value);}} placeholder="1/2" style={{width:140,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none",fontFamily:"monospace"}} />],
          [<div><div>Dilution Factor</div><div>used on first</div><div>row of <span style={{color:"#30437a",fontWeight:700}}>Sample</span></div></div>,<div>
            {(function(){
              var locked = cfg.smpPredil && !isNaN(pDil(cfg.smpPredil)) && pOptionalDil(cfg.smpPredil)!==1;
              var combined = locked ? pDil(cfg.xdf)*pOptionalDil(cfg.smpPredil) : null;
              var showPanel = cfg.showSmpPredilPanel;
              if(locked) return <div>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:8,border:"1px solid #d0dff0",background:"#f5f8fc",fontFamily:"monospace",fontSize:13,color:"#0b2a6f"}}>
                  {fmtDilution(combined,dilFormat,100000)}
                  <span style={{fontSize:10,fontWeight:700,color:"#8a5a00",background:"#fff7e0",border:"1px solid #e8c77d",borderRadius:5,padding:"2px 7px"}}>adjusted</span>
                </div>
                <div style={{fontSize:10,color:"#8a5a00",marginTop:4,lineHeight:1.4}}>= {fmtDilution(pDil(cfg.xdf),dilFormat,100000)} first-row × {fmtDilution(pOptionalDil(cfg.smpPredil),dilFormat,100000)} pre-plate. App uses {fmtDilution(combined,dilFormat,100000)} for back-calc.</div>
                <button onClick={function(){u("smpPredil","");u("showSmpPredilPanel",false);}} style={{background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:"2px 0",marginTop:4,textDecoration:"underline",textDecorationStyle:"dotted"}}>Undo pre-plate adjustment</button>
              </div>;
              return <div>
                <input value={cfg.xdf} onChange={function(e){u("xdf",e.target.value);}} placeholder="1/2" style={{width:140,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none",fontFamily:"monospace"}} />
                {pDil(cfg.xdf)>0 && !showPanel && <button onClick={function(){u("showSmpPredilPanel",true);}} style={{display:"block",background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:"2px 0",marginTop:5,textDecoration:"underline",textDecorationStyle:"dotted",fontStyle:"italic"}}>I diluted my sample before adding to the plate</button>}
                {showPanel && <div style={{marginTop:8,padding:"10px 12px",background:"#f7fbff",border:"1px solid #c6d3e8",borderRadius:10}}>
                  <div style={{fontSize:11,color:"#30437a",lineHeight:1.5,marginBottom:6}}>Enter the dilution you applied to your sample before it touched the plate — e.g. <code>1/10</code>. The app multiplies this into the first-row value so your dilution fields stay unchanged.</div>
                  <input value={cfg.smpPredil||""} onChange={function(e){u("smpPredil",e.target.value);}} placeholder="e.g. 1/10" style={{width:130,padding:"7px 10px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:12,fontFamily:"monospace",outline:"none"}} />
                  {(function(){var f=pDil(cfg.xdf),p=pOptionalDil(cfg.smpPredil);if(!cfg.smpPredil||isNaN(f)||p===1)return null;return <div style={{marginTop:6,fontSize:11,color:"#7a4a00",lineHeight:1.45}}>✓ App will use <strong style={{fontFamily:"monospace"}}>{fmtDilution(f*p,dilFormat,100000)}</strong> for Sample row 1 ({fmtDilution(f,dilFormat,100000)} × {fmtDilution(p,dilFormat,100000)}). The field above stays as entered.</div>;})()}
                  <button onClick={function(){u("showSmpPredilPanel",false);}} style={{background:"transparent",border:"none",fontSize:10,color:"#8e9bb5",cursor:"pointer",padding:"2px 0",marginTop:6,textDecoration:"underline",textDecorationStyle:"dotted"}}>Cancel</button>
                </div>}
              </div>;
            })()}
          </div>],
          [<div><div>Dilution Factor</div><div>used on second</div><div>and remaining</div><div>rows of <span style={{color:"#30437a",fontWeight:700}}>Sample</span></div></div>,<input value={cfg.xds} onChange={function(e){u("xds",e.target.value);}} placeholder="1/2" style={{width:140,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none",fontFamily:"monospace"}} />],
          ] : []),
          // Autosampler-mode sample dilution factors. Plate workflow uses xdf/xds for the same purpose;
          // we reuse those keys here so the math layer needs no special-casing. These define the dilution
          // applied to each Sample dilution row: Dil 1 = xdf, Dil 2 = Dil1 × xds, Dil 3 = Dil2 × xds, etc.
          // The serial DF row (xds) is hidden when only 1 sample dilution row is configured — there's
          // nothing to apply "between rows" of when there's only one row.
          ...(cfg.layout==="autosampler" ? [
          [<div><div>Dilution Factor</div><div>used on first</div><div>row of <span style={{color:"#30437a",fontWeight:700}}>Sample</span></div></div>,<input value={cfg.xdf} onChange={function(e){u("xdf",e.target.value);}} placeholder="1/10" style={{width:140,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none",fontFamily:"monospace"}} />],
          ...((parseInt(cfg.asNDilutions)||3) > 1 ? [
          [<div><div>Dilution Factor</div><div>between</div><div>sample dilution rows</div></div>,<input value={cfg.xds} onChange={function(e){u("xds",e.target.value);}} placeholder="1/2" style={{width:140,padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13,outline:"none",fontFamily:"monospace"}} />]
          ] : [])
          ] : []),

          ["Spike recovery used?",<select value={cfg.spikeUsed} onChange={function(e){u("spikeUsed",e.target.value);}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e5e5ea",fontSize:13}}><option value="no">No</option><option value="yes">Yes</option></select>],

        ].map(function(row,i){return <div key={i} style={{display:"flex",gap:16,alignItems:"center",padding:"10px 0",borderBottom:i<10?"1px solid #f0f0f3":"none"}}><div style={{width:200,flexShrink:0,fontSize:13,color:"#6e6e73",lineHeight:1.4}}>{row[0]}</div><div style={{flex:1}}>{row[1]}</div></div>;})}
        </div>
        {cfg.spikeUsed==="yes"&&<div style={{background:SURFACE,borderRadius:18,border:"1px solid "+BORDER,padding:"1.25rem",marginBottom:"1.25rem",boxShadow:"0 8px 22px rgba(11,42,111,0.04)"}}>
          <div style={{background:"linear-gradient(135deg,#8f3fdb,#3478F6)",color:"#fff",padding:"10px 16px",borderRadius:12,fontSize:14,fontWeight:800,marginBottom:"1rem",boxShadow:"0 10px 22px rgba(52,120,246,0.16)"}}>Accuracy / spike recovery</div>
          {instructor && cfg.layout==="autosampler" && <div style={{padding:"8px 12px",background:"#f7f1ff",border:"1px solid #e2d7fb",borderRadius:8,fontSize:11,color:"#3a2470",lineHeight:1.55,marginBottom:"1rem"}}>
            <strong>Note for LC-MS quant:</strong> the recovery math here is classical — (spiked − unspiked) / expected × 100, applied to back-calculated concentrations from the curve. In MS workflows you'll often see <em>internal-standard-based recovery</em> instead, where each injection is normalized by the IS area before comparing spiked vs unspiked. That's a separate quantitation paradigm (area-ratio quant) — not yet wired into eSSF. For now, the classical formula works on your back-calculated concentrations.
          </div>}
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
                  <div><label style={{display:"block",fontSize:11,fontWeight:700,marginBottom:6,color:"#18233f"}}>Stock concentration of the spike</label><div style={{display:"flex",gap:8,alignItems:"center"}}><input value={set.stockConc} onChange={function(e){updateSpike(idx,"stockConc",e.target.value);}} style={{width:"100%",padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}} /><select value={set.stockUnit} onChange={function(e){updateSpike(idx,"stockUnit",e.target.value);}} style={{padding:"8px 10px",borderRadius:10,border:"1px solid #d8dfeb",fontSize:13}}>{SPIKE_STOCK_UNITS.map(function(u){return <option key={u} value={u}>{u}</option>;})}</select></div></div>
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
        {analyzeError && <div style={{background:"#fff3f3",border:"1px solid #f0b8b8",borderRadius:10,padding:"10px 14px",marginTop:"1rem",marginBottom:"-0.5rem",display:"flex",alignItems:"flex-start",gap:10}}>
          <span style={{fontSize:14,color:"#b4332e",fontWeight:700,flexShrink:0}}>⚠</span>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:700,color:"#b4332e",marginBottom:3}}>Cannot analyze yet</div>
            <div style={{fontSize:12,color:"#7a3e3a",lineHeight:1.5}}>{analyzeError}</div>
          </div>
          <button onClick={function(){setAnalyzeError("");}} style={{background:"transparent",border:"none",color:"#b4332e",fontSize:14,cursor:"pointer",padding:"0 4px",lineHeight:1}} title="Dismiss">×</button>
        </div>}
        <div style={{display:"flex",gap:12}}><button onClick={confirmAnalyze} disabled={!dv} style={{background:"linear-gradient(135deg,#1b7f6a,#3478F6)",color:"#fff",border:"none",padding:"11px 24px",borderRadius:12,fontWeight:700,fontSize:13,cursor:dv?"pointer":"not-allowed",opacity:dv?1:.5,boxShadow:"0 10px 20px rgba(11,42,111,0.10)"}}>Analyze</button><button onClick={demo} style={{background:"transparent",border:"1px solid #e5e5ea",padding:"11px 20px",borderRadius:12,fontSize:12,color:"#6e6e73",cursor:"pointer",fontWeight:600}}>Load demo</button></div>
      </div>)}

      {/* ANALYSIS */}
      {tab===1&&res&&(function(){var p=res[vp];if(!p)return null;
        // Multi-plate overlay: build a series array from every plate's standard curve.
        // Plate colors cycle through a curated subset of GC (skipping GC[0]=teal which is reserved for the focused/active curve).
        // The currently-viewed plate (vp) is rendered "active" in the chart (full color, error bars, glow);
        // the rest fade to ghost markers + thin lines. Click a plate chip to switch focus.
        var PLATE_COLORS = ["#2d74ea","#bf7a1a","#6337b9","#1b7f6a","#b4332e","#0f8aa2","#8a4f10","#5a2a6a","#1a3a8a","#9a1f5a","#1a5a2a","#6a4f10","#5a4a10","#3a2e7a","#0f5c4d","#7a2620"];
        var stdSeries = res.map(function(pp,pi){
          return {
            label: stdDisplayName(pi),
            pts: pp.sc.pts,
            fn: pp.fFn,
            fL: pp.fL,
            r2: pp.sc.r2,
            slope: pp.sc.slope,
            intercept: pp.sc.intercept,
            params: pp.sc.params,
            model: pp.sc.model,
            color: PLATE_COLORS[pi % PLATE_COLORS.length]
          };
        });
        return (<div>
        {assayKind==="elisa"&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:12,padding:"10px 14px",background:"#f7f1ff",border:"1px solid #e2d7fb",borderRadius:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:12,fontWeight:800,color:"#6337b9"}}>ELISA standard curve fit</div>
            <div style={{fontSize:11,color:"#6e6e73",marginTop:2}}>4PL is the usual default. Use 5PL when the curve is visibly asymmetric. ELISA reporting prefers the least-diluted in-range result that also agrees with a neighboring dilution.</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <select value={cfg.fm==="5pl"?"5pl":"4pl"} onChange={function(e){u("fm",e.target.value);}} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #d8dfeb",fontSize:13,background:"#fff"}}><option value="4pl">4PL</option><option value="5pl">5PL</option></select>
            <button onClick={confirmAnalyze} style={{background:"#6337b9",color:"#fff",border:"none",padding:"8px 12px",borderRadius:8,fontSize:12,fontWeight:800,cursor:"pointer"}}>Re-analyze</button>
          </div>
        </div>}
        <div style={{position:"relative",display:"flex",justifyContent:"center",marginBottom:"1rem",background:"linear-gradient(180deg,#ffffff,#f5f9fe)",borderRadius:18,padding:"1.25rem",border:"1px solid #dfe7f2",boxShadow:"0 16px 34px rgba(11,42,111,0.08), inset 0 1px 0 rgba(255,255,255,0.85)"}}>
          {(function(){
            // Plate selector overlay — only built when multi-plate. Passed into StdChart's overlay prop so it
            // positions inside the canvas plot rectangle (bottom-right) and tracks canvas scaling on narrow viewports.
            // Label is "PLATE" (not "FOCUS") so the analyst sees explicit context. Options spell out "Plate N — R²=…"
            // in full (the dropdown sits in empty plot-area space and has room).
            var overlayNode = null;
            if(res.length>1){
              var col = PLATE_COLORS[vp % PLATE_COLORS.length];
              overlayNode = <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,0.96)",border:"1px solid "+col,borderRadius:8,padding:"2px 4px 2px 8px",boxShadow:"0 2px 8px rgba(11,42,111,0.10)"}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:col,display:"inline-block"}}></span>
                <select value={vp} onChange={function(e){setVp(parseInt(e.target.value));}} style={{
                  border:"none",background:"transparent",fontSize:11,fontWeight:700,color:"#30437a",
                  cursor:"pointer",outline:"none",padding:"2px 2px",fontFamily:"inherit"
                }}>
                  {res.map(function(pp,pi){return <option key={pi} value={pi}>Plate {pi+1} — R²={sig3(pp.sc.r2)}</option>;})}
                </select>
              </div>;
            }
            return res.length>1
              ? <StdChart series={stdSeries} activeIdx={vp} sn={cfg.sn} unit={unit} displayUnit={displayUnitChart} onDisplayUnitChange={setDisplayUnitChart} instructor={instructor} overlay={overlayNode} onFitChange={changeFitAndReanalyze} autoMode={cfg.fm==="auto"} />
              : <StdChart pts={p.sc.pts} fn={p.fFn} sn={cfg.sn} fl={p.fL} r2={p.sc.r2} unit={unit} displayUnit={displayUnitChart} onDisplayUnitChange={setDisplayUnitChart} slope={p.sc.slope} intercept={p.sc.intercept} params={p.sc.params} curveModel={p.sc.model} instructor={instructor} onFitChange={changeFitAndReanalyze} autoMode={cfg.fm==="auto"} />;
          })()}
        </div>
        {/* Focused-plate toolbar: jump-to-sample picker. Lists samples across ALL plates so the analyst can jump cross-plate without first switching focus.
            When a sample on a different plate is picked, focus switches first, then the card opens and scrolls into view. */}
        {res.some(function(pp){return pp.samps.length>0;}) && <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,padding:"8px 12px",background:"#f7fbff",border:"1px solid #dfe7f2",borderRadius:10,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:700,color:"#6e6e73",textTransform:"uppercase",letterSpacing:1}}>Jump to sample:</span>
          <select onChange={function(e){
            var v = e.target.value;
            if(!v) return;
            var parts = v.split(":");
            var pi = parseInt(parts[0]);
            var si = parseInt(parts[1]);
            if(isNaN(pi) || isNaN(si)) return;
            var ek = pi+"-"+si;
            // If the target is on a different plate, switch focus first.
            if(pi !== vp) setVp(pi);
            // Open the card if collapsed.
            var n={};for(var k in expanded)n[k]=expanded[k];n[ek]=true;setExpanded(n);
            // Scroll into view — give React a tick to mount the new plate's DOM if we just changed vp.
            setTimeout(function(){
              var el = document.getElementById("ana-sample-"+pi+"-"+si);
              if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
            }, pi !== vp ? 120 : 50);
            e.target.value="";
          }} value="" style={{padding:"5px 9px",borderRadius:8,border:"1px solid #d8dfeb",fontSize:12,background:"#fff",fontWeight:600,color:"#30437a",minWidth:200,cursor:"pointer"}}>
            <option value="">— select a sample —</option>
            {res.length>1
              ? res.map(function(pp,pi){
                  return <optgroup key={pi} label={"Plate "+(pi+1)}>
                    {pp.samps.map(function(s,si){return <option key={si} value={pi+":"+si}>{s.name}</option>;})}
                  </optgroup>;
                })
              : (res[0]||{samps:[]}).samps.map(function(s,si){return <option key={si} value={"0:"+si}>{s.name}</option>;})
            }
          </select>
          <span style={{flex:1}}></span>
          <span style={{fontSize:10,color:"#8e9bb5",fontStyle:"italic"}}>{(function(){var t=0;res.forEach(function(pp){t+=pp.samps.length;});return t;})()} sample{(function(){var t=0;res.forEach(function(pp){t+=pp.samps.length;});return t===1?"":"s";})()} total{res.length>1?" across "+res.length+" plates":""}</span>
        </div>}
        <details style={{marginBottom:"1rem"}}><summary style={{fontSize:13,fontWeight:700,cursor:"pointer"}}>Standard curve data {res.length>1 ? "— "+stdDisplayName(vp) : ""}</summary><div style={{fontSize:11,color:"#6e6e73",marginTop:8}}>Optical responses shown here are <strong>blank/background-corrected</strong> before fitting.{res.length>1 ? " Showing focused plate only — change focus in the dropdown on the chart to see another plate's data." : ""}</div><table style={{borderCollapse:"collapse",width:"100%",marginTop:8}}><thead><tr><th style={{...thS,textAlign:"center"}}>[{cfg.sn}] (<UnitPill unit={displayUnitChart} onChange={setDisplayUnitChart} size={11} color="#6e6e73" hoverColor="#0b2a6f" weight={700} />)</th><th style={{...thS,textAlign:"center",lineHeight:1.3}}><div>Avg corrected</div><div>optical response</div></th><th style={{...thS,textAlign:"center"}}>SD</th><th style={{...thS,textAlign:"center"}}>CV (%)</th></tr></thead><tbody>{p.sc.pts.map(function(pt,i){var concDisp = convertConc(pt.conc, unit, displayUnitChart); return <tr key={i}><td style={tdS}>{sig3(concDisp)}</td><td style={{...tdS,textAlign:"center"}}>{fmtResponse(pt.avg)}</td><td style={{...tdS,textAlign:"center"}}>{fmtResponse(pt.sd)}</td><td style={{...tdS,textAlign:"center"}}><CVB val={pt.cv} /></td></tr>;})}</tbody></table>
        {/* Regression parameters table — fitted-curve coefficients for the focused plate.
            Shape depends on the fit model: linear shows slope/intercept/R²; 4PL adds A/B/C/D; 5PL adds G as well.
            C (the half-maximal concentration) is shown in the active display unit so it's directly interpretable.
            Other coefficients (A, B, D, G, slope, intercept) are unitless or in optical-response units, so they
            don't change with unit selection. */}
        <div style={{marginTop:14,padding:"10px 12px",background:"#f7fbff",border:"1px solid #d7e7fb",borderRadius:8}}>
          <div style={{fontSize:12,fontWeight:700,color:"#30437a",marginBottom:6}}>Regression parameters {res.length>1 ? "— "+stdDisplayName(vp) : ""}</div>
          {(function(){
            var model = p.sc.model;
            var rows = [];
            if (model === "linear") {
              // Display slope in the active display unit. y = slope*x + intercept; if x changes by factor k, slope divides by k.
              var displaySlope = p.sc.slope!=null ? p.sc.slope / convertConc(1, unit, displayUnitChart) : null;
              rows.push({ k: "Slope", v: displaySlope!=null?sig3(displaySlope):"—", help: "(response per "+displayUnitChart+")" });
              rows.push({ k: "Intercept", v: sig3(p.sc.intercept), help: "(response at zero concentration; theoretically zero on a blank-corrected curve)" });
            } else if (model === "loglog") {
              // log10(y) = slope * log10(x) + intercept. Slope/intercept are dimensionless on the log axes.
              // Equivalent power-law form: y = (10^intercept) * x^slope. Note: this means the prefactor changes
              // with the unit of x (since the prefactor absorbs unit scaling). We don't auto-rescale the displayed
              // slope/intercept by displayUnit because they're not in any concentration unit — they're log10-scale.
              rows.push({ k: "Slope (log–log)", v: sig3(p.sc.slope), help: "(power-law exponent; 1 = exact linear; >1 = response grows faster than concentration)" });
              rows.push({ k: "Intercept (log–log)", v: sig3(p.sc.intercept), help: "(log\u2081\u2080 of the response at concentration = 1 in the base unit, "+unit+")" });
              rows.push({ k: "Prefactor (10^intercept)", v: sig3(Math.pow(10, p.sc.intercept)), help: "(the response value at concentration = 1 in the base unit; equivalent power-law form: y = prefactor \u00d7 x^slope)" });
            } else {
              var P = p.sc.params || {};
              rows.push({ k: "A", v: sig3(P.A), help: "(asymptote at high concentration)" });
              rows.push({ k: "D", v: sig3(P.D), help: "(asymptote at low concentration)" });
              rows.push({ k: "C", v: P.C!=null?sig3(convertConc(P.C, unit, displayUnitChart))+" "+displayUnitChart:"—", help: "(midpoint / EC50 — concentration at half-maximal response)" });
              rows.push({ k: "B", v: sig3(P.B), help: "(slope factor / Hill coefficient)" });
              if (model === "5pl") rows.push({ k: "G", v: sig3(P.G), help: "(asymmetry factor; 1 reduces to 4PL)" });
            }
            rows.push({ k: "R²", v: sig3(p.sc.r2), help: model==="loglog" ? "(coefficient of determination on log\u2013log axes; closer to 1 = better fit on the log scale)" : "(coefficient of determination; closer to 1 = better fit)" });
            return <table style={{borderCollapse:"collapse",width:"100%"}}>
              <thead><tr>
                <th style={{...thS,textAlign:"center",fontSize:10}}>Parameter</th>
                <th style={{...thS,textAlign:"center",fontSize:10}}>Value</th>
                {instructor && <th style={{...thS,textAlign:"center",fontSize:10}}>Notes</th>}
              </tr></thead>
              <tbody>
                {rows.map(function(r,i){return <tr key={i}>
                  <td style={{...tdS,fontWeight:700,fontSize:12}}>{r.k}</td>
                  <td style={{...tdS,fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#0b2a6f"}}>{r.v}</td>
                  {instructor && <td style={{...tdS,fontSize:11,color:"#6e6e73",fontStyle:"italic"}}>{r.help}</td>}
                </tr>;})}
              </tbody>
            </table>;
          })()}
          {instructor && <div style={{marginTop:8,fontSize:10,color:"#8e9bb5",fontStyle:"italic"}}>
            {p.sc.model === "linear"
              ? "Equation: y = slope × x + intercept"
              : (p.sc.model === "loglog"
                  ? "Equation: log\u2081\u2080(y) = slope \u00d7 log\u2081\u2080(x) + intercept   \u2261   y = (10^intercept) \u00d7 x^slope"
                  : (p.sc.model === "5pl" ? "Equation: y = D + (A − D) / (1 + (x/C)^B)^G" : "Equation: y = D + (A − D) / (1 + (x/C)^B)"))}
          </div>}
        </div>
        </details>
        {/* Expand/collapse all */}
        <div style={{display:"flex",gap:12,marginBottom:12}}><button onClick={function(){toggleAll(true);}} style={{fontSize:12,color:"#3478F6",background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>Expand all samples</button><button onClick={function(){toggleAll(false);}} style={{fontSize:12,color:"#6e6e73",background:"transparent",border:"none",cursor:"pointer",fontWeight:600}}>Collapse all</button></div>
        {p.samps.map(function(s,si){var sel=gsc(vp,si);var gc=GC[(si+1)%GC.length];var ek=vp+"-"+si;var isOpen=expanded[ek];return (
          <div key={si} id={"ana-sample-"+vp+"-"+si} style={{marginBottom:8,background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",overflow:"hidden",boxShadow:"0 10px 22px rgba(11,42,111,0.05)",scrollMarginTop:80}}>
            <div onClick={function(){var n={};for(var k in expanded)n[k]=expanded[k];n[ek]=!isOpen;setExpanded(n);}} style={{background:"linear-gradient(180deg,"+gc.hd+", "+gc.bg+")",padding:"11px 16px",display:"flex",alignItems:"center",gap:10,cursor:"pointer",userSelect:"none",borderBottom:"1px solid rgba(255,255,255,0.35)",boxShadow:glow(gc)}}>
              <span style={{fontSize:14,fontWeight:700,color:gc.tx,transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"rotate(0deg)"}}>&#9654;</span>
              <span style={{fontSize:11,fontWeight:700,color:gc.tx,textTransform:"uppercase",letterSpacing:1}}>Sample</span>
              <span style={{fontSize:15,fontWeight:800,color:gc.tx}}>{s.name}</span>
              <span style={{marginLeft:"auto",fontSize:12,color:gc.tx,fontWeight:700,opacity:0.95}}>{sel&&sel.conc!=null?"Selected by "+SM.find(function(m){return m.id===sm;}).short+": "+sig3(sel.conc)+" "+unit:"No qualified concentration selected"}</span>
            </div>
            {isOpen&&(<div style={{padding:"1rem 1.25rem",overflowX:"auto"}}>
              {instructor&&<div style={{fontSize:11,color:"#3478F6",marginBottom:8,fontWeight:600}}>Click any row for step-by-step math</div>}
              <table style={{borderCollapse:"collapse",width:"100%"}}><thead><tr>
                <th style={{...thS,textAlign:"center"}}>Dilution</th>
                <th style={{...thS,textAlign:"center",lineHeight:1.3}}><div>Average corrected</div><div>response</div></th>
                <th style={{...thS,textAlign:"center"}}>CV (%)</th>
                <th style={{...thS,textAlign:"center",lineHeight:1.3}}><div>[{targetP}]</div><div style={{fontWeight:500,fontSize:10,color:"#8e9bb5",textAlign:"center"}}>in well (<UnitPill unit={displayUnitChart} onChange={setDisplayUnitChart} size={10} color="#8e9bb5" hoverColor="#0b2a6f" weight={500} />)</div></th>
                <th style={{...thS,textAlign:"center",lineHeight:1.3}}><div>[{targetP}]</div><div style={{fontWeight:500,fontSize:10,color:"#8e9bb5",textAlign:"center"}}>in sample (<UnitPill unit={displayUnitChart} onChange={setDisplayUnitChart} size={10} color="#8e9bb5" hoverColor="#0b2a6f" weight={500} />)</div></th>
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
                    <td style={{...tdS,textAlign:"center"}}>{fmtResponse(d.avgA)}</td>
                    <td style={{...tdS,textAlign:"center"}}><CVB val={d.cv} /></td>
                    <td style={{...tdS,textAlign:"center",color:!d.ir&&instructor?"#a05a00":"inherit",fontStyle:!d.ir&&instructor?"italic":"normal"}}>{d.cW!=null?(d.ir?sig3(convertConc(d.cW, unit, displayUnitChart)):(instructor?sig3(convertConc(d.cW, unit, displayUnitChart)):"---")):"---"}</td>
                    <td style={{...tdS,textAlign:"center",fontWeight:isRec||isPk?700:400,color:!d.ir&&instructor?"#a05a00":"inherit",fontStyle:!d.ir&&instructor?"italic":"normal"}}>{d.cS!=null?(d.ir?sig3(convertConc(d.cS, unit, displayUnitChart)):(instructor?sig3(convertConc(d.cS, unit, displayUnitChart)):"---")):"---"}</td>
                    <td style={{...tdS,textAlign:"center"}}>{d.ir?<span style={{color:"#1b7f6a",fontWeight:700}}>IR</span>:<span style={{color:"#d70015"}}>OOR</span>}</td>
                  </tr>,
                  isMO&&dbD2?<tr key={di+"m"}><td colSpan={6} style={{padding:0,border:"none"}}><MathWalk d={dbD2} slope={p.sc.slope} intercept={p.sc.intercept} params={p.sc.params} curveModel={p.sc.model} sn={cfg.sn} target={targetP} unit={unit} displayUnit={displayUnitChart} instructor={instructor} /></td></tr>:null
                ];})}</tbody></table>
            </div>)}
          </div>
        );})}
        {/* Plate pager — only when multi-plate. Lets the analyst advance to the next plate without scrolling back up to the chart dropdown.
            Does NOT scroll to top of page on click — the user is reading near the bottom and likely wants to keep flipping.
            After click, scrolls the pager itself into view (since plates have different sample counts and the pager's vertical
            position can shift), keeping the buttons under the user's cursor. */}
        {res.length>1 && <div id="ana-plate-pager" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"14px 18px",marginTop:"1rem",background:"linear-gradient(180deg,#f7fbff,#ffffff)",border:"1px solid #dfe7f2",borderRadius:14,boxShadow:"0 6px 16px rgba(11,42,111,0.04)",scrollMarginBottom:20}}>
          <button onClick={function(){
            var prev = vp===0 ? res.length-1 : vp-1;
            setVp(prev);
            setTimeout(function(){
              var el = document.getElementById("ana-plate-pager");
              if(el) el.scrollIntoView({behavior:"smooth",block:"end"});
            }, 30);
          }} style={{
            display:"inline-flex",alignItems:"center",gap:8,
            padding:"9px 16px",borderRadius:10,
            border:"1px solid #c6d3e8",background:"#fff",color:"#30437a",
            fontSize:13,fontWeight:700,cursor:"pointer",
            boxShadow:"0 2px 6px rgba(11,42,111,0.06)"
          }}>
            <span style={{fontSize:14}}>←</span>
            <span>Previous plate</span>
            <span style={{fontSize:11,color:"#8e9bb5",fontWeight:500}}>(Plate {vp===0 ? res.length : vp})</span>
          </button>
          <div style={{fontSize:12,color:"#6e6e73",fontWeight:600,textAlign:"center"}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:1,color:"#8e9bb5",fontWeight:700}}>Now viewing</div>
            <div style={{fontSize:14,fontWeight:800,color:"#0b2a6f"}}>Plate {vp+1} of {res.length}</div>
          </div>
          <button onClick={function(){
            var next = (vp+1) % res.length;
            setVp(next);
            setTimeout(function(){
              var el = document.getElementById("ana-plate-pager");
              if(el) el.scrollIntoView({behavior:"smooth",block:"end"});
            }, 30);
          }} style={{
            display:"inline-flex",alignItems:"center",gap:8,
            padding:"9px 16px",borderRadius:10,
            border:"1px solid "+PLATE_COLORS[((vp+1)%res.length) % PLATE_COLORS.length],
            background:PLATE_COLORS[((vp+1)%res.length) % PLATE_COLORS.length],color:"#fff",
            fontSize:13,fontWeight:700,cursor:"pointer",
            boxShadow:"0 4px 10px rgba(11,42,111,0.15)"
          }}>
            <span style={{fontSize:11,opacity:0.85,fontWeight:500}}>(Plate {((vp+1)%res.length)+1})</span>
            <span>Next plate</span>
            <span style={{fontSize:14}}>→</span>
          </button>
        </div>}
      </div>);})()}
      {tab===1&&!res&&<div style={{padding:"3rem",textAlign:"center",color:"#aeaeb2"}}>Paste data and click Analyze.</div>}

      {/* RESULTS */}
      {tab===2&&res&&(function(){
        var qc=runQC();
        return (<div>
        {/* Run-level QC banner (if spike recovery was performed). Detailed validation moved to Method Review tab. */}
        {qc && <div style={{marginBottom:"1.25rem",padding:"16px 18px",borderRadius:14,background:qc.status==="pass"?"linear-gradient(180deg,#e8f5ea,#d6eedf)":qc.status==="fail"?"linear-gradient(180deg,#ffeaed,#fcdce0)":"linear-gradient(180deg,#fff6e8,#fbe9cd)",border:"1px solid "+(qc.status==="pass"?"#8fc4a1":qc.status==="fail"?"#d98a8f":"#d4a76a")}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <span style={{fontSize:22,fontWeight:800,color:qc.status==="pass"?"#1b7f6a":qc.status==="fail"?"#b4332e":"#9a6a00"}}>{qc.status==="pass"?"✓":qc.status==="fail"?"✗":"⚠"}</span>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:qc.status==="pass"?"#1b5a4d":qc.status==="fail"?"#7a2620":"#5a3e00"}}>Run-level spike recovery QC: {qc.status==="pass"?"PASS":qc.status==="fail"?"FAIL":"MIXED"}</div>
              {qc.nWithRec>0 && <div style={{fontSize:12,color:"#5a6984"}}>{qc.nWithRec} of {qc.nSets} spike set{qc.nSets===1?"":"s"} had recovery computed. Range: {qc.minR.toFixed(1)}–{qc.maxR.toFixed(1)}% (mean {qc.meanR.toFixed(1)}%). ICH M10 pass window: 80–120%.</div>}
              {qc.nWithRec===0 && <div style={{fontSize:12,color:"#5a6984"}}>Spike sets are configured but recovery could not be computed (may be missing measured concentrations).</div>}
            </div>
          </div>
          {instructor && <div style={{fontSize:11,color:"#5a6984",lineHeight:1.6,paddingLeft:32}}>
            {qc.status==="pass" && <span><strong>Interpretation:</strong> the assay is measuring accurately for the spiked sample(s). Report concentrations as-measured.</span>}
            {qc.status==="fail" && <span><strong>Interpretation:</strong> all spike recoveries are outside the 80–120% window. The run fails QC by ICH M10. Investigate matrix effects, stock accuracy, or assay drift before reporting. Do <em>not</em> apply recovery as a per-sample correction factor.</span>}
            {qc.status==="mixed" && <span><strong>Interpretation:</strong> recoveries vary across spike sets — some pass, some fail. The assay may be sensitive to matrix differences between samples. Review each spike set individually before deciding what to report.</span>}
            {qc.anyOverride && <span><br/><span style={{color:"#7a4a00"}}><strong>Note:</strong> {qc.nOverride} spike set{qc.nOverride===1?"":"s"} used the endogenous=0 override. Recovery on those sets is only valid if the matrix is truly analyte-free.</span></span>}
          </div>}
        </div>}

        {/* Picks summary — subtle dotted-link disclosure. Mirrors the Recommendations summary table format
            but reflects the analyst's ACTUAL picks (live as they toggle radio buttons in the cards below).
            Uses <details> for native disclosure. Auto-expands if any pick has a QC failure. */}
        {(function(){
          // Check for QC issues — only flag genuine problems (CV >20%). Missing picks are
          // legitimate "no qualified concentration" outcomes, not QC issues.
          var summaryRowsCheck = buildSummaryRows(sm);
          var issues = [];
          summaryRowsCheck.forEach(function(r){
            var name = r.name || "(unnamed)";
            if (r.analystConc != null && r.analystCv != null && r.analystCv > 0.20) {
              issues.push(name + " (CV " + (r.analystCv*100).toFixed(0) + "%)");
            }
          });
          var anyIssue = issues.length > 0;
          var issueMsg = anyIssue ? ("⚠ Issues: " + issues.slice(0,3).join(", ") + (issues.length > 3 ? " and " + (issues.length-3) + " more" : "") + " — click to review") : "Show summary of my picks";
          return <details open={anyIssue} style={{marginBottom:"1rem"}}>
          <summary style={{display:"inline-block",cursor:"pointer",fontSize:12,color:anyIssue?"#b4332e":"#3478F6",fontWeight:600,fontStyle:"italic",textDecoration:"underline",textDecorationStyle:"dotted",userSelect:"none",padding:"4px 0"}}>
            {issueMsg}
          </summary>
          <div style={{marginTop:8,background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1rem 1.25rem"}}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
              <h4 style={{fontSize:13,fontWeight:700,margin:0,color:"#30437a"}}>Your picks summary</h4>
              <div style={{display:"flex",alignItems:"baseline",gap:14}}>
                {res.length>1 && <span onClick={function(){setShowPlateSeparators(!showPlateSeparators);}} style={{fontSize:11,color:"#3478F6",cursor:"pointer",fontStyle:"italic",fontWeight:600,textDecoration:"underline",textDecorationStyle:"dotted",userSelect:"none"}}>{showPlateSeparators?"Hide plate separators":"Show plate separators"}</span>}
                <span onClick={function(){setShowDilutions(!showDilutions);}} style={{fontSize:11,color:"#3478F6",cursor:"pointer",fontStyle:"italic",fontWeight:600,textDecoration:"underline",textDecorationStyle:"dotted",userSelect:"none"}}>{showDilutions?"Hide dilution":"Show dilution"}</span>
              </div>
            </div>
            {(function(){
              var rows = buildSummaryRows(sm);
              var anyOverride = rows.some(function(r){return r.hasOverride;});
              return <div>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",width:"100%"}}>
                    <thead><tr>
                      {res.length>1 && <th style={{...thS,textAlign:"center"}}>Plate</th>}
                      <th style={{...thS,textAlign:"center"}}>Sample</th>
                      <th style={{...thS,textAlign:"center",lineHeight:1.3}}><div>Algorithm pick</div><div style={{fontWeight:500,fontSize:10,color:"#8e9bb5",textAlign:"center"}}>[{targetP}] (<UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={10} color="#8e9bb5" hoverColor="#0b2a6f" weight={500} />)</div></th>
                      <th style={{...thS,textAlign:"center",lineHeight:1.3,background:"#f6fbff"}}><div>Analyst pick</div><div style={{fontWeight:500,fontSize:10,color:"#8e9bb5",textAlign:"center"}}>[{targetP}] (<UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={10} color="#8e9bb5" hoverColor="#0b2a6f" weight={500} />)</div></th>
                      <th style={{...thS,textAlign:"center"}}>CV (%)</th>
                      <th style={{...thS,textAlign:"center"}}>Recovery</th>
                    </tr></thead>
                    <tbody>
                      {rows.map(function(r,i){
                        var rowBg = r.disagrees ? "rgba(180,51,46,0.07)" : (r.hasOverride ? "#fff8e1" : "transparent");
                        var analystColor = r.disagrees ? "#b4332e" : "#0b2a6f";
                        // Plate separator: solid line on top of row when previous row was a different plate
                        var prevPi = i>0 ? rows[i-1].pi : null;
                        var isPlateBoundary = res.length>1 && showPlateSeparators && prevPi != null && prevPi !== r.pi;
                        var rowStyle = {background:rowBg};
                        if (isPlateBoundary) rowStyle.borderTop = "2px solid #6f7fa0";
                        return <tr key={i} style={rowStyle}>
                          {res.length>1 && <td style={tdS}>{r.pi}</td>}
                          <td style={{...tdS,fontWeight:700}}>{r.name}</td>
                          <td style={{...tdS,textAlign:"center",color:"#5a6984"}}>
                            <div style={{fontWeight:700}}>{r.algoConc!=null?sig3(convertConc(r.algoConc, unit, displayUnitResults)):"—"}</div>
                            {showDilutions && <div style={{fontSize:9,color:"#aeaeb2",fontStyle:"italic",fontWeight:500}}>{r.algoDilDf!=null?"at "+fmtDilution(r.algoDilDf,dilFormat,100000):""}</div>}
                          </td>
                          <td style={{...tdS,textAlign:"center",background:r.disagrees?"rgba(180,51,46,0.04)":"#f6fbff",color:analystColor}}>
                            <div style={{fontWeight:800}}>{r.analystConc!=null?sig3(convertConc(r.analystConc, unit, displayUnitResults)):"—"}</div>
                            {showDilutions && <div style={{fontSize:9,fontStyle:"italic",fontWeight:500,color:r.disagrees?"#b4332e":"#aeaeb2"}}>{r.analystDilDf!=null?"at "+fmtDilution(r.analystDilDf,dilFormat,100000):""}</div>}
                          </td>
                          <td style={{...tdS,textAlign:"center"}}>{r.analystCv!=null?<CVB val={r.analystCv} />:"—"}</td>
                          <td style={{...tdS,textAlign:"center",fontWeight:700,color:r.recovery==null?"#aeaeb2":(r.recovery>=80&&r.recovery<=120?"#1b7f6a":"#b4332e")}}>{r.recovery!=null?r.recovery.toFixed(0)+"%":"—"}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{marginTop:10,fontSize:11,color:"#5a6984",fontStyle:"italic"}}>
                  {anyOverride
                    ? <span>Rows tinted red are samples where your pick differs from the algorithm.{instructor && <span> The analyst-pick column shows your reported concentration in red. Reasonable when the data justifies it (e.g. <span title={DILUTIONAL_LINEARITY_TIP} style={{cursor:"help",borderBottom:"1px dotted #5a6984"}}>dilutional linearity</span> agreement, hook-effect avoidance) — be ready to defend the choice in your method record.</span>}</span>
                    : <span>No overrides — your reported concentrations match the algorithm.</span>}
                </div>
              </div>;
            })()}
          </div>
        </details>;
        })()}

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
        {res.flatMap(function(pp,pi){return pp.samps.map(function(s,si){
          var algoSel=s.aS[sm];var apk=pi+"-"+si;var gc=GC[(si+1)%GC.length];var rk=pi+"-"+si;var open=resultsExpanded[rk];
          var mySpikeRows=spikeRowsForSample(pi,si);
          var chosen=gsc(pi,si);
          return (<div key={pi+"-"+si} style={{marginBottom:"1rem",background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",overflow:"hidden",boxShadow:"0 10px 22px rgba(11,42,111,0.05)"}}>
            <div onClick={function(){var n={};for(var k in resultsExpanded)n[k]=resultsExpanded[k];n[rk]=!open;setResultsExpanded(n);}} style={{background:"linear-gradient(180deg,"+gc.hd+", "+gc.bg+")",padding:"11px 16px",display:"flex",alignItems:"center",gap:8,cursor:"pointer",borderBottom:open?"1px solid rgba(255,255,255,0.35)":"none",boxShadow:glow(gc)}}>
              <span style={{fontSize:14,fontWeight:700,color:gc.tx,transition:"transform 0.2s",transform:open?"rotate(90deg)":"rotate(0deg)"}}>&#9654;</span>
              <span style={{fontSize:11,fontWeight:700,color:gc.tx,textTransform:"uppercase",letterSpacing:1}}>Plate {pi+1}</span>
              <span style={{fontSize:14,fontWeight:800,color:gc.tx}}>{s.name}</span>
              <span style={{marginLeft:"auto",fontSize:12,color:gc.tx,fontWeight:800,opacity:0.95}}>{chosen&&chosen.conc!=null?"Picked: "+sig3(convertConc(chosen.conc, unit, displayUnitResults))+" "+displayUnitResults:"No qualified concentration"}</span>
              {mySpikeRows.length>0 && mySpikeRows[0].recovery!=null && <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:mySpikeRows[0].recovery>=80&&mySpikeRows[0].recovery<=120?"#e8f5ea":"#ffeaed",color:mySpikeRows[0].recovery>=80&&mySpikeRows[0].recovery<=120?"#1b7f6a":"#b4332e"}}>Recovery {mySpikeRows[0].recovery.toFixed(0)}%</span>}
            </div>
            {open&&<div style={{padding:"0.75rem 1rem"}}>
              <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",width:"100%"}}><thead><tr>
                <th style={{...thS,textAlign:"center"}}>Dilution</th><th style={{...thS,textAlign:"center"}}>CV (%)</th><th style={{...thS,textAlign:"center",lineHeight:1.3}}><div>[{targetP}]</div><div style={{fontWeight:500,fontSize:10,color:"#8e9bb5",textAlign:"center"}}>in sample (<UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={10} color="#8e9bb5" hoverColor="#0b2a6f" weight={500} />)</div></th>
                {mySpikeRows.length>0 && <th style={{...thS,textAlign:"center",background:"#faf5ff",color:"#6337b9"}} title="Recovery if you reported this dilution, paired against your current unspiked concentration pick. Updates when you change the unspiked sample's pick.">Recovery<span style={{fontSize:8,fontWeight:400,display:"block",marginTop:2,opacity:0.75}}>(vs current unspiked pick)</span></th>}
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
                  <td style={{...tdS,textAlign:"center"}}><CVB val={d.cv} /></td>
                  <td style={{...tdS,textAlign:"center",fontWeight:700,color:!d.ir&&instructor?"#a05a00":"inherit",fontStyle:!d.ir&&instructor?"italic":"normal"}}>{canPick?sig3(convertConc(d.cS, unit, displayUnitResults)):(instructor&&d.cS!=null?sig3(convertConc(d.cS, unit, displayUnitResults)):"")}</td>
                  {mySpikeRows.length>0 && <td style={{...tdS,textAlign:"center",fontFamily:"monospace",fontWeight:isAlgo?800:600,color:dilRec==null?"#aeaeb2":(dilRecPass?"#1b7f6a":"#b4332e")}}>{dilRec!=null?dilRec.toFixed(0)+"%":"—"}</td>}
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

        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,fontSize:12,color:"#6e6e73"}}>
          <span style={{color:"#1b7f6a",fontWeight:800,fontSize:14}}>★</span>
          <span>Recommended by strategy: <span style={{position:"relative",display:"inline-block"}}>
            <span style={{fontWeight:700,color:"#0b2a6f",borderBottom:"1px dotted #0b2a6f",cursor:"pointer",pointerEvents:"none"}}>{SM.find(function(m){return m.id===sm;}).name}</span>
            <select value={sm} onChange={function(e){setSm(e.target.value);}} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",fontSize:12,fontFamily:"inherit",border:"none",background:"transparent",appearance:"none",WebkitAppearance:"none"}} title="Click to change strategy">
              {SM.map(function(m){return <option key={m.id} value={m.id}>{m.name}</option>;})}
            </select>
          </span></span>
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
        // Build the analyst summary using the LITERATURE-BACKED (ICH M10) strategy as the canonical reporting choice.
        // buildSummaryRows returns rows containing both the algorithm pick (for "literature") AND the analyst's
        // actual reported pick (gsc, which respects manual overrides), plus a `disagrees` flag.
        var litStrat = SM.find(function(m){return m.id==="literature";});
        var summaryRows = buildSummaryRows("literature");
        var nDisagree = summaryRows.filter(function(r){return r.disagrees;}).length;
        // Per-plate de-facto LLOQ from the calibrator back-fit. Used to flag rows where the analyst's
        // reported concentration falls below the lowest passing standard — those are BLOQ-zone results
        // and should be reviewed (the curve doesn't reliably quantitate that low).
        var deFactoLLOQs = computeDeFactoLLOQ(res);
        var nBLOQ = summaryRows.filter(function(r){
          var lloq = deFactoLLOQs[r.plateIdx];
          return lloq != null && r.analystConc != null && r.analystConc < lloq;
        }).length;
        return (<div>
          <div style={{marginBottom:"1.25rem"}}>
            <h3 style={{fontSize:18,fontWeight:800,color:"#0b2a6f",marginBottom:4}}>Method Review</h3>
            <p style={{fontSize:13,color:"#6e6e73",margin:0,lineHeight:1.6}}>Run-level QC, validation parameters, and strategy comparison. Active strategy: <strong style={{color:"#0b2a6f"}}>{SM.find(function(m){return m.id===sm;}).name}</strong>.{instructor ? " Compare strategies below." : " Toggle Instructor mode to compare strategies."}</p>
          </div>

          {/* System Suitability + Standard Curve Quality — moved here from Results in v5cj */}
          <SystemSuitabilityCard res={res} unit={unit} displayUnit={displayUnitResults} instructor={instructor} stdDisplayName={stdDisplayName} sstExpected={sstExpectedDict} setSSTExpected={setSSTExpected} sstFlags={sstFlagsDict} toggleSSTFlag={toggleSSTFlag} analystPickFor={analystPickFor} />

          {/* ICH Q2(R2) Method Validation Parameters — moved here from Results in v5cj */}
          <MethodValidationCard res={res} unit={unit} displayUnit={displayUnitResults} instructor={instructor} sstSamples={detectSSTSamples(res, sstFlagsDict)} sstExpected={sstExpectedDict} analystPickFor={analystPickFor} spikeRecovery={runQC()} />

          {/* Robot QC: Replicate Reproducibility — added v5d3. Per-level CV across selected
              "should-be-identical" samples reveals robot dispense reproducibility separately from
              the assay/curve quality. Default selects all samples; user toggles as needed. */}
          <RobotQCCard res={res} instructor={instructor} />

          {/* Analyst summary: side-by-side concentrations (algorithm vs analyst), dilution as small gray subscript,
              analyst column rendered in red when overridden. Per the v5bd spec — drop the dilution columns and
              keep just the concentrations side-by-side, with disagreement signaled via red text on the analyst cell. */}
          <div style={{background:"#fff",borderRadius:14,border:"1px solid #e5e5ea",padding:"1.25rem",marginBottom:"1.25rem"}}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:12,marginBottom:10,flexWrap:"wrap"}}>
              <h4 style={{fontSize:14,fontWeight:700,margin:0,color:"#30437a"}}>Reported concentrations</h4>
              <div style={{display:"flex",alignItems:"baseline",gap:14}}>
                {res.length>1 && <span onClick={function(){setShowPlateSeparators(!showPlateSeparators);}} style={{fontSize:11,color:"#3478F6",cursor:"pointer",fontStyle:"italic",fontWeight:600,textDecoration:"underline",textDecorationStyle:"dotted",userSelect:"none"}}>{showPlateSeparators?"Hide plate separators":"Show plate separators"}</span>}
                <span onClick={function(){setShowDilutions(!showDilutions);}} style={{fontSize:11,color:"#3478F6",cursor:"pointer",fontStyle:"italic",fontWeight:600,textDecoration:"underline",textDecorationStyle:"dotted",userSelect:"none"}}>{showDilutions?"Hide dilution":"Show dilution"}</span>
                <span style={{fontSize:11,color:"#8e9bb5",fontStyle:"italic"}}>
                  Algorithm: <span style={{position:"relative",display:"inline-block"}}>
                    <span style={{fontWeight:700,color:"#30437a",borderBottom:"1px dotted #30437a",cursor:"pointer",pointerEvents:"none"}}>{SM.find(function(m){return m.id===sm;}).name}</span>
                    <select value={sm} onChange={function(e){setSm(e.target.value);}} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",fontSize:11,fontFamily:"inherit",border:"none",background:"transparent",appearance:"none",WebkitAppearance:"none"}} title="Click to change strategy">
                      {SM.map(function(m){return <option key={m.id} value={m.id}>{m.name}</option>;})}
                    </select>
                  </span>
                  {nDisagree>0?" — "+nDisagree+" overridden":""}{nBLOQ>0?" — "+nBLOQ+" below de-facto LLOQ":""}
                </span>
              </div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%"}}>
                <thead><tr>
                  <th style={{...thS,textAlign:"center"}}>Plate</th>
                  <th style={{...thS,textAlign:"center"}}>Sample</th>
                  <th style={{...thS,textAlign:"center",lineHeight:1.3}}><div>Algorithm pick</div><div style={{fontWeight:500,fontSize:10,color:"#8e9bb5",textAlign:"center"}}>[{targetP}] (<UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={10} color="#8e9bb5" hoverColor="#0b2a6f" weight={500} />)</div></th>
                  <th style={{...thS,textAlign:"center",lineHeight:1.3,background:"#f6fbff"}}><div>Analyst pick</div><div style={{fontWeight:500,fontSize:10,color:"#8e9bb5",textAlign:"center"}}>[{targetP}] (<UnitPill unit={displayUnitResults} onChange={setDisplayUnitResults} size={10} color="#8e9bb5" hoverColor="#0b2a6f" weight={500} />)</div></th>
                  <th style={{...thS,textAlign:"center"}}>CV (%)</th>
                  <th style={{...thS,textAlign:"center"}}>Recovery</th>
                </tr></thead>
                <tbody>
                  {summaryRows.map(function(r,i){
                    // Disagreement: row gets a faint pink wash; analyst-conc rendered in red.
                    // BLOQ check: if a de-facto LLOQ exists for this plate AND the analyst's reported
                    // concentration is below it, flag the row. The de-facto LLOQ is the lowest passing
                    // calibrator standard; below that the curve doesn't reliably quantitate.
                    var rowBg = r.disagrees ? "rgba(180,51,46,0.07)" : "transparent";
                    var analystColor = r.disagrees ? "#b4332e" : "#0b2a6f";
                    var lloq = deFactoLLOQs[r.plateIdx];
                    var isBLOQ = lloq != null && r.analystConc != null && r.analystConc < lloq;
                    if (isBLOQ && !r.disagrees) rowBg = "rgba(154,106,0,0.07)";
                    // Plate separator: solid line on top of row when previous row was a different plate
                    var prevPi = i>0 ? summaryRows[i-1].pi : null;
                    var isPlateBoundary = res.length>1 && showPlateSeparators && prevPi != null && prevPi !== r.pi;
                    var rowStyle = {background:rowBg};
                    if (isPlateBoundary) rowStyle.borderTop = "2px solid #6f7fa0";
                    return <tr key={i} style={rowStyle}>
                      <td style={tdS}>{r.pi}</td>
                      <td style={{...tdS,fontWeight:700}}>{r.name}</td>
                      <td style={{...tdS,textAlign:"center",color:"#5a6984"}}>
                        <div style={{fontWeight:700}}>{r.algoConc!=null?sig3(convertConc(r.algoConc, unit, displayUnitResults)):"—"}</div>
                        {showDilutions && <div style={{fontSize:9,color:"#aeaeb2",fontStyle:"italic",fontWeight:500}}>{r.algoDilDf!=null?"at "+fmtDilution(r.algoDilDf,dilFormat,100000):""}</div>}
                      </td>
                      <td style={{...tdS,textAlign:"center",background:r.disagrees?"rgba(180,51,46,0.04)":(isBLOQ?"rgba(154,106,0,0.05)":"#f6fbff"),color:analystColor}}>
                        <div style={{fontWeight:800,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                          {r.analystConc!=null?sig3(convertConc(r.analystConc, unit, displayUnitResults)):"—"}
                          {isBLOQ && <span title={"Reported concentration ("+sig3(convertConc(r.analystConc, unit, displayUnitResults))+" "+displayUnitResults+") is below the de-facto LLOQ for this plate ("+sig3(convertConc(lloq, unit, displayUnitResults))+" "+displayUnitResults+"). The lowest passing calibrator failed back-fit, so the curve doesn't reliably quantitate at this concentration. Consider reporting as <LLOQ instead. "+BLOQ_TIP} style={{fontSize:9,fontWeight:800,color:"#9a6a00",background:"#fff2d8",border:"1px solid #d4a76a",borderRadius:4,padding:"1px 5px",cursor:"help"}}>⚠ BLOQ</span>}
                        </div>
                        {showDilutions && <div style={{fontSize:9,fontStyle:"italic",fontWeight:500,color:r.disagrees?"#b4332e":"#aeaeb2"}}>{r.analystDilDf!=null?"at "+fmtDilution(r.analystDilDf,dilFormat,100000):""}</div>}
                      </td>
                      <td style={{...tdS,textAlign:"center"}}>{r.analystCv!=null?<CVB val={r.analystCv} />:"—"}</td>
                      <td style={{...tdS,textAlign:"center",fontWeight:700,color:r.recovery==null?"#aeaeb2":(r.recovery>=80&&r.recovery<=120?"#1b7f6a":"#b4332e")}}>{r.recovery!=null?r.recovery.toFixed(0)+"%":"—"}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            {nDisagree>0 && <div style={{marginTop:10,padding:"8px 12px",background:"rgba(180,51,46,0.06)",border:"1px solid rgba(180,51,46,0.2)",borderRadius:8,fontSize:11,color:"#7a2620",lineHeight:1.55}}>
              <strong>{nDisagree} sample{nDisagree===1?"":"s"}</strong> {nDisagree===1?"has":"have"} an analyst-overridden dilution different from the algorithm's recommendation.{instructor && <span> Reported concentrations on those rows reflect what you picked on the Results tab — be ready to defend each override in your method record (e.g. <span title={DILUTIONAL_LINEARITY_TIP} style={{cursor:"help",borderBottom:"1px dotted #7a2620"}}>dilutional linearity</span> agreement, hook-effect avoidance, or matrix interference at the algorithm-recommended dilution).</span>}
            </div>}
            {nBLOQ>0 && <div style={{marginTop:10,padding:"8px 12px",background:"rgba(154,106,0,0.07)",border:"1px solid #d4a76a",borderRadius:8,fontSize:11,color:"#5a3e00",lineHeight:1.55}}>
              <strong>⚠ {nBLOQ} sample{nBLOQ===1?"":"s"}</strong> reported below the de-facto LLOQ for {nBLOQ===1?"its":"their"} plate. The de-facto LLOQ is the lowest calibrator standard that passes back-fit accuracy; the actual lowest standard failed, so the curve doesn't reliably quantitate that low.{instructor && <span> Consider reporting these as <span title={BLOQ_TIP} style={{cursor:"help",borderBottom:"1px dotted #5a3e00",fontWeight:700}}>&lt;LLOQ</span> instead of as numeric concentrations, or re-run with closer-spaced low standards. Hover the ⚠ BLOQ badge in any row to see that plate's de-facto LLOQ value.</span>}
            </div>}
            {instructor && <div style={{marginTop:12,padding:"10px 14px",background:"#f6fbff",borderRadius:8,border:"1px solid #d7e7fb",fontSize:11,color:"#30437a",lineHeight:1.6}}>
              <strong>Why this strategy?</strong> ICH M10 (and FDA Bioanalytical Method Validation 2018) recommend reporting the least-diluted in-range, qualified dilution — no averaging across dilutions. For ELISA/LBA data, eSSF also looks for agreement with a neighboring in-range dilution (80–120% — see <span title={DILUTIONAL_LINEARITY_TIP} style={{cursor:"help",borderBottom:"1px dotted #30437a"}}>dilutional linearity</span>) before preferring that dilution, which helps avoid hook-effect and non-parallelism traps. The other strategies are useful for method development and teaching but should not be the default for regulated work.
            </div>}
            {instructor && <details style={{marginTop:8}}>
              <summary style={{cursor:"pointer",fontSize:11,color:"#3478F6",fontStyle:"italic",fontWeight:600,textDecoration:"underline",textDecorationStyle:"dotted",userSelect:"none",padding:"4px 0"}}>
                What is dilutional linearity, exactly? (plain-English explainer)
              </summary>
              <div style={{marginTop:8,padding:"10px 14px",background:"#fffaf3",border:"1px solid #f3e3c8",borderRadius:8,fontSize:11,color:"#5a3e00",lineHeight:1.65,whiteSpace:"pre-wrap"}}>{DILUTIONAL_LINEARITY_LONG}</div>
            </details>}
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
                  <th style={{...thS,textAlign:"center"}}>Sample</th>
                  {SM.map(function(m){return <th key={m.id} style={{...thS,textAlign:"center",fontSize:9}}>{m.short}</th>;})}
                  <th style={{...thS,textAlign:"center",background:"#f4f4f6"}}>Agreement</th>
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
                      {SM.map(function(m){return <td key={m.id} style={{...tdS,textAlign:"center"}}>{d.r[m.id]&&d.r[m.id].conc!=null?sig3(convertConc(d.r[m.id].conc, unit, displayUnitResults)):"—"}</td>;})}
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
                    <th style={{...thS,textAlign:"center",fontSize:10}}>Strategy A</th>
                    <th style={{...thS,textAlign:"center",fontSize:10}}>vs. Strategy B</th>
                    <th style={{...thS,textAlign:"center",fontSize:10}}>Median diff (A−B)</th>
                    <th style={{...thS,textAlign:"center",fontSize:10}}>% diff</th>
                    <th style={{...thS,textAlign:"center",fontSize:10}}>p-value</th>
                    <th style={{...thS,textAlign:"center",fontSize:10}}>Verdict</th>
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
                      <td style={{...tdS,textAlign:"center",fontFamily:"monospace"}}>{pw.mdiff!=null?(pw.mdiff>=0?"+":"")+sig3(convertConc(pw.mdiff, unit, displayUnitResults)):"—"}</td>
                      <td style={{...tdS,textAlign:"center",fontFamily:"monospace"}}>{pw.pctDiff!=null?(pw.pctDiff>=0?"+":"")+pw.pctDiff.toFixed(1)+"%":"—"}</td>
                      <td style={{...tdS,textAlign:"center",fontFamily:"monospace",fontWeight:700,color:sig?"#b4332e":"#30437a"}}>{pw.test.p!=null?(pw.test.p<0.001?"<0.001":pw.test.p.toFixed(3)):"n/a"}</td>
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
            <details style={{marginTop:8}}>
              <summary style={{fontSize:11,fontWeight:600,cursor:"pointer",color:"#6e6e73",padding:"4px 0"}}>References</summary>
              <div style={{marginTop:6,fontSize:11,color:"#6e6e73",lineHeight:1.7,padding:"0 10px"}}>
                <p style={{margin:"0 0 4px"}}>FDA Bioanalytical Method Validation (2018), VII.A.</p>
                <p style={{margin:"0 0 4px"}}>ICH M10 (2022).</p>
                <p style={{margin:"0 0 4px"}}>Findlay and Dillard, AAPS J 2007;9(2):E260.</p>
                <p style={{margin:0}}>DeSilva et al., AAPS J 2003;5(4):22.</p>
              </div>
            </details>
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
          var iconValidation = <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="4" y="3" width="14" height="16" rx="2" stroke="#fff" strokeWidth="1.6" fill="none"/>
            <path d="M7.5 11 L10 13.5 L15 8.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <line x1="7" y1="6" x2="15" y2="6" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
            <line x1="7" y1="16" x2="13" y2="16" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity="0.6"/>
          </svg>;
          var tools = [
            {id:"unit",  title:"Unit Converter",          desc:"Convert mg/mL ↔ ug/mL ↔ ng/mL etc.",  icon:iconConv,  color:"#0F8AA2"},
            {id:"spike", title:"Spike Recovery Planner",   desc:"Plan spike volumes and check expected recovery.", icon:iconSpike, color:"#6337b9"},
            {id:"elisa", title:"Dilution Planner",        desc:"Plan tube pre-dilutions and plate serial dilutions for any assay.", icon:iconElisa, color:"#BF7A1A"},
            {id:"validation", title:"Validation Designer", desc:"Design simple ICH Q2-aligned validation experiments — linearity, accuracy, precision, LLOQ, spike recovery.", icon:iconValidation, color:"#6337b9"},
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
            {selectedTool==="elisa" && <ElisaDesignerCard instructor={instructor} dilFormat={dilFormat} setDilFormat={setDilFormat} onApplyDilutions={function(xdf, xds){
              // Populate the General Information sample dilution fields with the planned series, then jump to Data Entry tab.
              u("xdf", xdf);
              u("xds", xds);
              setOn(true);
              setTab(0);
            }} />}
            {selectedTool==="validation" && <ValidationDesignerEntry instructor={instructor} unit={unit} />}
          </div>;
        })()}
      </div>)}

      {tab===5&&dbg&&res&&(<div><h3 style={{fontSize:16,fontWeight:800,color:"#a05a00"}}>Debug</h3>{res.map(function(pp,pi){return <div key={pi} style={{marginBottom:"2rem"}}><h4 style={{fontSize:13,fontWeight:700}}>Plate {pi+1} | Blank: {fm4(pp.bA)}</h4><details><summary style={{fontSize:12,cursor:"pointer",color:"#6e6e73"}}>Standard</summary><table style={{borderCollapse:"collapse",width:"100%",marginTop:6,fontSize:10,fontFamily:"monospace"}}><thead><tr>{["Row","Conc","Raw","Blank","Corr","Avg","SD","CV (%)"].map(function(h){return <th key={h} style={thS}>{h}</th>;})}</tr></thead><tbody>{(pp.dbS||[]).map(function(d,i){return <tr key={i}><td style={tdS}>{d.row}</td><td style={tdS}>{sig3(d.conc)}</td><td style={tdS}>{d.raw.map(function(v){return v.toFixed(3);}).join(", ")}</td><td style={tdS}>{fm4(d.blank)}</td><td style={tdS}>{d.cor.map(function(v){return v.toFixed(4);}).join(", ")}</td><td style={tdS}>{fm4(d.avg)}</td><td style={tdS}>{fm4(d.sd)}</td><td style={tdS}><CVB val={d.cv} /></td></tr>;})}</tbody></table></details>{pp.samps.map(function(s,si){return <details key={si} style={{marginBottom:6}}><summary style={{fontSize:12,cursor:"pointer",color:"#6e6e73"}}>{s.name}</summary><table style={{borderCollapse:"collapse",width:"100%",marginTop:6,fontSize:10,fontFamily:"monospace"}}><thead><tr>{["Dil","Raw","Blank","Corr","Avg","CV (%)","IR","Well","DilF","Smp"].map(function(h){return <th key={h} style={thS}>{h}</th>;})}</tr></thead><tbody>{(s.dbD||[]).map(function(d,i){return <tr key={i}><td style={tdS}>{d.di}</td><td style={tdS}>{d.raw.map(function(v){return v.toFixed(3);}).join(", ")}</td><td style={tdS}>{fm4(d.blank)}</td><td style={tdS}>{d.cor.map(function(v){return v.toFixed(4);}).join(", ")}</td><td style={tdS}>{fmtResponse(d.avgA)}</td><td style={tdS}><CVB val={d.cv} /></td><td style={tdS}>{d.ir?"Y":"N"}</td><td style={tdS}>{sig3(d.cW)}</td><td style={tdS}>{fm4(d.df)}</td><td style={tdS}>{sig3(d.cS)}</td></tr>;})}</tbody></table></details>;})}</div>;})}</div>)}
    </div>
  );
}
