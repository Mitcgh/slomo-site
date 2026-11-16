/* Touch To Slow engine, used by the home page. */
/* Reads the index of an MP4 or MOV file: where each video frame sits in the file, when it is shown, and which frames stand alone. */
function parseMp4(buf) {
  var dv = new DataView(buf), len = buf.byteLength;
  function kids(start, end) {
    var out = [], p = start;
    while (p + 8 <= end) {
      var size = dv.getUint32(p), type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7)), hdr = 8;
      if (size === 1) { if (p + 16 > end) break; size = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      out.push({ type: type, s: p + hdr, e: p + size });
      p += size;
    }
    return out;
  }
  function find(list, type) { for (var i = 0; i < list.length; i++) if (list[i].type === type) return list[i]; return null; }
  function hex(n, w) { var h = n.toString(16).toUpperCase(); while (h.length < w) h = '0' + h; return h; }

  var moov = find(kids(0, len), 'moov');
  if (!moov) throw new Error('No index found in this file');
  var traks = kids(moov.s, moov.e).filter(function (b) { return b.type === 'trak'; });
  for (var ti = 0; ti < traks.length; ti++) {
    var tk = kids(traks[ti].s, traks[ti].e), mdia = find(tk, 'mdia');
    if (!mdia) continue;
    var md = kids(mdia.s, mdia.e), hdlr = find(md, 'hdlr');
    if (!hdlr || dv.getUint32(hdlr.s + 8) !== 0x76696465) continue; // 'vide'
    var mdhd = find(md, 'mdhd'), minf = find(md, 'minf');
    var stbl = minf && find(kids(minf.s, minf.e), 'stbl');
    if (!mdhd || !stbl) continue;
    var timescale = dv.getUint32(mdhd.s + (dv.getUint8(mdhd.s) === 1 ? 20 : 12));
    var st = kids(stbl.s, stbl.e);
    var stsd = find(st, 'stsd'), stts = find(st, 'stts'), ctts = find(st, 'ctts'), stss = find(st, 'stss'),
        stsc = find(st, 'stsc'), stsz = find(st, 'stsz'), stco = find(st, 'stco'), co64 = find(st, 'co64');
    if (!stsd || !stts || !stsc || !stsz || !(stco || co64)) continue;

    // Codec and its setup bytes.
    var entry = kids(stsd.s + 8, stsd.e)[0];
    if (!entry) continue;
    var width = dv.getUint16(entry.s + 24), height = dv.getUint16(entry.s + 26);
    var sub = kids(entry.s + 78, entry.e), codec = null, desc = null, cfg;
    if ((cfg = find(sub, 'avcC'))) {
      desc = new Uint8Array(buf.slice(cfg.s, cfg.e));
      codec = 'avc1.' + hex(desc[1], 2) + hex(desc[2], 2) + hex(desc[3], 2);
    } else if ((cfg = find(sub, 'hvcC'))) {
      desc = new Uint8Array(buf.slice(cfg.s, cfg.e));
      var b1 = desc[1], compat = 0, rev = 0, i, tail = [];
      for (i = 0; i < 4; i++) compat = (compat * 256 + desc[2 + i]) >>> 0;
      for (i = 0; i < 32; i++) { rev = ((rev << 1) | ((compat >>> i) & 1)) >>> 0; }
      for (i = 0; i < 6; i++) tail.push(desc[6 + i]);
      while (tail.length && tail[tail.length - 1] === 0) tail.pop();
      codec = (entry.type === 'hev1' ? 'hev1' : 'hvc1') + '.' + ['', 'A', 'B', 'C'][b1 >> 6] + (b1 & 31) + '.' + rev.toString(16).toUpperCase() +
              '.' + ((b1 & 32) ? 'H' : 'L') + desc[12] + tail.map(function (x) { return '.' + x.toString(16).toUpperCase(); }).join('');
    } else throw new Error('This clip uses a video format the test page does not read yet (' + entry.type + ')');

    // Rotation: phones store upright video sideways with a turn instruction.
    var rotation = 0, tkhd = find(tk, 'tkhd');
    if (tkhd) {
      var mo = tkhd.s + (dv.getUint8(tkhd.s) === 1 ? 52 : 40);
      var ang = Math.round(Math.atan2(dv.getInt32(mo + 4), dv.getInt32(mo)) * 180 / Math.PI);
      rotation = ((Math.round(ang / 90) * 90) % 360 + 360) % 360;
    }

    // Sizes, positions and timings of every frame.
    var uniform = dv.getUint32(stsz.s + 4), n = dv.getUint32(stsz.s + 8), sizes = new Uint32Array(n);
    for (i = 0; i < n; i++) sizes[i] = uniform || dv.getUint32(stsz.s + 12 + 4 * i);
    var cobox = stco || co64, nChunks = dv.getUint32(cobox.s + 4);
    function chunkOff(c) { return stco ? dv.getUint32(stco.s + 8 + 4 * c) : dv.getUint32(co64.s + 8 + 8 * c) * 4294967296 + dv.getUint32(co64.s + 12 + 8 * c); }
    var offs = new Float64Array(n), nRuns = dv.getUint32(stsc.s + 4), si = 0;
    for (var r = 0; r < nRuns && si < n; r++) {
      var first = dv.getUint32(stsc.s + 8 + 12 * r) - 1, per = dv.getUint32(stsc.s + 12 + 12 * r);
      var nextFirst = r + 1 < nRuns ? dv.getUint32(stsc.s + 8 + 12 * (r + 1)) - 1 : nChunks;
      for (var c = first; c < nextFirst && si < n; c++) {
        var o = chunkOff(c);
        for (var q = 0; q < per && si < n; q++) { offs[si] = o; o += sizes[si]; si++; }
      }
    }
    var dts = new Float64Array(n), t = 0, k = 0, cnt = dv.getUint32(stts.s + 4);
    for (i = 0; i < cnt && k < n; i++) {
      var sc = dv.getUint32(stts.s + 8 + 8 * i), dl = dv.getUint32(stts.s + 12 + 8 * i);
      for (q = 0; q < sc && k < n; q++) { dts[k++] = t; t += dl; }
    }
    var cts = new Float64Array(dts);
    if (ctts) {
      var v1 = dv.getUint8(ctts.s) === 1; cnt = dv.getUint32(ctts.s + 4); k = 0;
      for (i = 0; i < cnt && k < n; i++) {
        sc = dv.getUint32(ctts.s + 8 + 8 * i);
        var off = v1 ? dv.getInt32(ctts.s + 12 + 8 * i) : dv.getUint32(ctts.s + 12 + 8 * i);
        for (q = 0; q < sc && k < n; q++) cts[k++] += off;
      }
    }
    var key = new Uint8Array(n);
    if (stss) { cnt = dv.getUint32(stss.s + 4); for (i = 0; i < cnt; i++) { var kx = dv.getUint32(stss.s + 8 + 4 * i) - 1; if (kx < n) key[kx] = 1; } }
    else key.fill(1);
    var samples = [];
    for (i = 0; i < n; i++) if (sizes[i] > 0 && offs[i] + sizes[i] <= len) samples.push({ off: offs[i], size: sizes[i], cts: cts[i] / timescale, key: key[i] === 1 });
    return { codec: codec, description: desc, width: width, height: height, rotation: rotation, samples: samples, totalTime: t / timescale };
  }
  throw new Error('No video found in this file');
}

/* The engine. It decodes frames itself, keeps a small store of them around the current moment, and paints whichever one
   the clock asks for. The clock is ours, so a change of speed or direction shows on the very next screen refresh. */
function createEngine(buf, info, canvas, onError) {
  var AHEAD = 10, EXTRA = 6, BEHIND = 10, REV_LOW = 12, REV_KEEP = 16, REV_BEHIND = 8, LOOK = 24;

  // Drop anything before the first stand-alone frame, then work out the order frames are shown in.
  var dec = info.samples, d0 = 0;
  while (d0 < dec.length && !dec[d0].key) d0++;
  dec = dec.slice(d0);
  var N = dec.length;
  if (N < 48) throw new Error('This clip is too short for the test page');
  var order = dec.map(function (_, j) { return j; }).sort(function (a, b) { return dec[a].cts - dec[b].cts || a - b; });
  var decOf = new Int32Array(N), times = new Float64Array(N);
  order.forEach(function (j, i) { decOf[i] = j; dec[j].disp = i; times[i] = dec[j].cts - dec[order[0]].cts; });
  var gaps = []; for (var i = 1; i < N; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort(function (a, b) { return a - b; });
  var typical = gaps[gaps.length >> 1] || 1 / 30, dur = times[N - 1] + typical;
  var keys = [], gopOf = new Int32Array(N);
  for (i = 0; i < N; i++) { if (dec[i].key) keys.push(i); gopOf[i] = keys.length - 1; }
  var G = keys.length;
  function gopEnd(g) { return g + 1 < G ? keys[g + 1] : N; }
  function fwd(a, b) { return ((b - a) % N + N) % N; }
  function indexAt(t) { var lo = 0, hi = N - 1; while (lo < hi) { var m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; } return lo; }
  function endOf(i) { return i + 1 < N ? times[i + 1] : dur; }

  // Canvas, turned the right way up.
  var rot = info.rotation, turned = rot === 90 || rot === 270;
  var sc = Math.min(1, 1280 / Math.max(info.width, info.height));
  var fw = Math.round(info.width * sc), fh = Math.round(info.height * sc);
  canvas.width = turned ? fh : fw; canvas.height = turned ? fw : fh;
  var ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rot * Math.PI / 180);

  var cfg = { codec: info.codec, codedWidth: info.width, codedHeight: info.height, description: info.description, optimizeForLatency: true };
  var cache = new Map(), stage = [], decoder = null, dead = false;
  var T = 0, k = 0, drawn = false, mode = 1, gen = 1;
  var fed = 0, outc = 0, fj = 0, flushing = false, boost = 0;
  var rg = 0, rbusy = false, rjob = null;
  var stats = { draws: 0, stalls: 0, held: 0, error: '' }, starvedAt = 0, wasStarved = false;

  function onOut(frame) {
    var g = Math.floor(frame.timestamp / 1e10), idx = Math.round((frame.timestamp % 1e10) / 1000);
    if (dead || g !== gen || idx < 0 || idx >= N) { frame.close(); return; }
    outc++;
    if (mode > 0) {
      var a = fwd(k, idx);
      if (!cache.has(idx) && (a <= AHEAD + EXTRA + boost || N - a <= BEHIND)) cache.set(idx, frame); else frame.close();
      pump();
    } else {
      // Going backwards, a group of frames is only usable once all of it has arrived, so it waits in a side store until then.
      var b = fwd(idx, k), j = rjob;
      var pick = j && idx >= j.lo && idx <= j.hi && ((idx - j.lo) % j.stride === 0 || idx === j.hi);
      if (pick && !cache.has(idx) && b < N / 2 && (b > 0 || !drawn)) stage.push([idx, frame]); else frame.close();
    }
  }
  function onErr(e) { if (dead) return; stats.error = String(e && e.message || e); if (onError) onError(stats.error); }
  function open() { decoder = new VideoDecoder({ output: onOut, error: onErr }); decoder.configure(cfg); }
  function restart() {
    gen++;
    try { if (decoder.state === 'closed') open(); else { decoder.reset(); decoder.configure(cfg); } } catch (e) { try { open(); } catch (e2) { onErr(e2); } }
    fed = 0; outc = 0; flushing = false; rbusy = false; rjob = null; boost = 0;
    stage.forEach(function (p) { p[1].close(); }); stage = [];
  }
  function feed(j) {
    var s = dec[j];
    decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: gen * 1e10 + s.disp * 1000, data: new Uint8Array(buf, s.off, s.size) }));
    fed++;
  }
  function startForward() {
    var start = k;
    if (drawn || cache.has(k)) { start = -1; for (var a = 1; a <= AHEAD + EXTRA; a++) { var i = (k + a) % N; if (!cache.has(i)) { start = i; break; } } if (start < 0) start = (k + AHEAD + EXTRA + 1) % N; }
    fj = keys[gopOf[decOf[start]]];
  }
  function startReverse() { rg = gopOf[decOf[drawn ? (k - 1 + N) % N : k]]; }
  function gopNeeded(g) {
    var lo = keys[g], hi = gopEnd(g) - 1, stride = Math.ceil((hi - lo + 1) / REV_KEEP);
    for (var i = lo; i <= hi; i++) {
      if ((i - lo) % stride !== 0 && i !== hi) continue;
      var b = fwd(i, k);
      if (b < N / 2 && (b > 0 || !drawn) && !cache.has(i)) return stride;
    }
    return 0;
  }
  function pump() {
    if (dead || !decoder || decoder.state !== 'configured') return;
    try {
      if (mode > 0) {
        while (!flushing && decoder.decodeQueueSize < 4) {
          var ahead = 0;
          cache.forEach(function (_, i) { var a = fwd(k, i); if (a < N / 2 && (a > 0 || !drawn)) ahead++; });
          if (ahead + (fed - outc) >= AHEAD + boost) break;
          feed(fj); fj++;
          if (fj >= N) {
            // End of the clip: empty the decoder, then carry straight on from the start so the loop has no gap.
            fj = 0; flushing = true;
            (function (g) { decoder.flush().then(function () { if (g === gen) { flushing = false; outc = fed; pump(); } }, function () {}); })(gen);
          }
        }
      } else if (!rbusy) {
        var below = 0;
        cache.forEach(function (_, i) { var b = fwd(i, k); if (b > 0 && b < N / 2) below++; });
        if (below >= REV_LOW) return;
        var stride = 0, tries = 0;
        while (tries++ < 3 && !(stride = gopNeeded(rg))) rg = (rg - 1 + G) % G;
        if (!stride) return;
        var lo = keys[rg], hi = gopEnd(rg) - 1;
        rjob = { lo: lo, hi: hi, stride: stride }; rbusy = true;
        for (var j = lo; j <= hi; j++) feed(j);
        (function (g) {
          decoder.flush().then(function () {
            if (g !== gen) return;
            stage.forEach(function (p) { if (cache.has(p[0])) p[1].close(); else cache.set(p[0], p[1]); });
            stage = []; rbusy = false; rjob = null; rg = (rg - 1 + G) % G; pump();
          }, function () {});
        })(gen);
      }
    } catch (e) { onErr(e); }
  }
  function evict() {
    cache.forEach(function (f, i) {
      var a = fwd(k, i), keep = mode > 0 ? (a <= AHEAD + EXTRA + boost || N - a <= BEHIND) : (N - a < N / 2 || a <= REV_BEHIND);
      if (!keep) { f.close(); cache.delete(i); }
    });
    stats.held = cache.size;
  }
  function paint(i) {
    var f = cache.get(i);
    try { ctx.drawImage(f, -fw / 2, -fh / 2, fw, fh); } catch (e) { return; }
    k = i; drawn = true; stats.draws++;
  }

  // Called once per screen refresh with the speed wanted right now (negative runs backwards) and the time since the last call.
  function tick(speed, dt, now) {
    if (dead) return false;
    var want = speed > 0 ? 1 : speed < 0 ? -1 : mode;
    if (want !== mode) { mode = want; restart(); if (mode > 0) startForward(); else startReverse(); evict(); }
    T += speed * dt;
    if (T >= dur) T -= dur; else if (T < 0) T += dur;
    if (T < 0 || T >= dur) T = 0;
    var desired = indexAt(T), painted = false, starving = false;
    var d = mode > 0 ? fwd(k, desired) : fwd(desired, k);
    if (d > N / 2) d = 0;
    if (d === 0) {
      if (!drawn) { if (cache.has(k)) { paint(k); painted = true; } else starving = true; }
    } else {
      var best = -1, s, i;
      for (s = d; s >= 1; s--) { i = ((k + mode * s) % N + N) % N; if (cache.has(i)) { best = i; break; } }
      if (best !== desired) {
        var beyond = false;
        for (s = d + 1; s <= d + LOOK; s++) { i = ((k + mode * s) % N + N) % N; if (cache.has(i)) { beyond = true; break; } }
        if (!beyond) starving = true;
      }
      if (best >= 0) { paint(best); painted = true; }
      // The frame wanted is not ready: hold the clock at the newest one shown, so the picture waits and never skips.
      if (starving) T = mode > 0 ? endOf(k) - 1e-6 : times[k];
    }
    if (starving && speed !== 0) {
      if (!wasStarved) { starvedAt = now; }
      else if (now - starvedAt > 120 && !stats.counted) { stats.stalls++; stats.counted = true; }
      if (now - starvedAt > 300 && mode > 0 && !flushing) { boost = Math.min(24, boost + 4); starvedAt = now; }
    } else stats.counted = false;
    wasStarved = starving && speed !== 0;
    if (painted) evict();
    pump();
    return painted;
  }
  function seek(t) {
    T = Math.max(0, Math.min(dur - 1e-3, t)); k = indexAt(T); drawn = false;
    cache.forEach(function (f) { f.close(); }); cache.clear();
    restart(); if (mode > 0) startForward(); else startReverse(); pump();
  }
  function destroy() {
    dead = true; gen++;
    try { decoder.close(); } catch (e) {}
    cache.forEach(function (f) { f.close(); }); cache.clear();
    stage.forEach(function (p) { p[1].close(); }); stage = [];
  }

  open(); startForward(); pump();
  return { tick: tick, seek: seek, destroy: destroy, stats: stats, dur: dur, frames: N, fps: (N - 1) / times[N - 1],
           time: function () { return T; }, width: canvas.width, height: canvas.height };
}
