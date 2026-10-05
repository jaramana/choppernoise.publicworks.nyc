/* Chopper Noise (choppernoise.publicworks.nyc) / noise model
   ------------------------------------------------------------------
   Where each helicopter is at a given moment, and how many residents hear
   it. The level formula and its constants come from pipeline stage 5 via
   meta.json, so the map and the published totals use one model:

       L(r) = L150 - 20 log10(r / 150) - absorption * (r - 150)

   No DOM and no map library here, so the same file runs under Node for the
   check against the pipeline's numbers. */

(function (root) {
  'use strict';

  var FT = 0.3048;

  function Model(meta, blocks) {
    var m = meta.model;
    this.meta = meta;
    this.step = meta.step;
    this.bands = meta.bands;
    this.ref = m.ref_m;
    this.absorb = m.absorption_db_per_km / 1000;
    this.minSlant = m.min_slant_m;
    this.mPerDeg = m.m_per_deg;
    this.lonScale = m.lon_scale;
    this.cellDeg = m.cell_deg;

    // Block points, decoded once. Region 1 is New Jersey.
    var n = blocks.pop.length;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    this.pop = Int32Array.from(blocks.pop);
    this.region = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      this.lat[i] = blocks.lat0 + blocks.lat[i] / blocks.scale;
      this.lon[i] = blocks.lon0 + blocks.lon[i] / blocks.scale;
    }
    var nj = blocks.regions.nj;
    for (i = nj[0]; i < nj[1]; i++) this.region[i] = 1;

    // Blocks on a grid, so a lookup checks only nearby cells.
    this.grid = new Map();
    for (i = 0; i < n; i++) {
      var key = this.cell(this.lat[i], this.lon[i]);
      var list = this.grid.get(key);
      if (list) list.push(i); else this.grid.set(key, [i]);
    }

    // Loudest level per block at the current moment, reused every frame.
    this.level = new Float32Array(n);
    this.touched = [];
  }

  // Truncation, as Python's int() does, so cells match stage 5.
  Model.prototype.cellIJ = function (lat, lon) {
    return [Math.trunc(lat / this.cellDeg), Math.trunc(lon * this.lonScale / this.cellDeg)];
  };
  Model.prototype.cell = function (lat, lon) {
    var c = this.cellIJ(lat, lon);
    return c[0] * 100000 + c[1];
  };

  Model.prototype.levelAt = function (l150, slant) {
    var r = Math.max(slant, this.minSlant);
    return l150 - 20 * Math.log10(r / this.ref) - this.absorb * (r - this.ref);
  };

  Model.prototype.noiseType = function (type) {
    var t = this.meta.types;
    return t[type || 'unknown'] || t.unknown;
  };

  // ---- Flights ------------------------------------------------------

  // Paths arrive as [lat, lon, alt, dlat, dlon, dalt, ...] in 1e-5 degrees
  // and feet. Each becomes three typed arrays on the shared 10-second clock.
  Model.prototype.decodeDay = function (day) {
    var self = this;
    day.flights.forEach(function (f) {
      var n = f.p.length / 3;
      f.lat = new Float64Array(n);
      f.lon = new Float64Array(n);
      f.alt = new Float32Array(n);
      var la = 0, lo = 0, al = 0;
      for (var i = 0; i < n; i++) {
        la += f.p[3 * i]; lo += f.p[3 * i + 1]; al += f.p[3 * i + 2];
        f.lat[i] = la / 1e5; f.lon[i] = lo / 1e5; f.alt[i] = al;
      }
      f.k1 = f.k0 + n - 1;
      f.t0 = f.k0 * self.step;
      f.t1 = f.k1 * self.step;
      var nt = self.noiseType(f.type);
      f.l150 = nt.l150;
      f.reach = nt.reach;
      delete f.p;
    });
    return day;
  };

  // Position and heading at t seconds after local midnight, or null.
  Model.prototype.where = function (f, t) {
    if (t < f.t0 || t > f.t1) return null;
    var s = t / this.step - f.k0;
    var i = Math.min(Math.floor(s), f.lat.length - 2);
    var u = s - i;
    var lat = f.lat[i] + u * (f.lat[i + 1] - f.lat[i]);
    var lon = f.lon[i] + u * (f.lon[i + 1] - f.lon[i]);
    var alt = f.alt[i] + u * (f.alt[i + 1] - f.alt[i]);
    var dy = f.lat[i + 1] - f.lat[i];
    var dx = (f.lon[i + 1] - f.lon[i]) * this.lonScale;
    var hdg = dx || dy ? Math.atan2(dx, dy) * 180 / Math.PI : (f.hdg || 0);
    f.hdg = hdg;
    return { lat: lat, lon: lon, alt: alt, hdg: hdg };
  };

  // Ground distance at which each band ends, for a helicopter at alt feet.
  // Null when the band does not reach the ground.
  Model.prototype.rings = function (f, alt) {
    var h = Math.max(alt * FT, 0);
    return f.reach.map(function (r) { return r > h ? Math.sqrt(r * r - h * h) : null; });
  };

  // ---- Exposure -----------------------------------------------------

  // Residents above each band right now. `items` is [{f, pos}]. The
  // combined count takes each block's loudest helicopter, so a block under
  // two flights is counted once. Each item also gets its own count.
  // `visit(block, level)`, when given, is called once for every block heard.
  Model.prototype.exposure = function (items, visit) {
    var bands = this.bands, nb = bands.length;
    var level = this.level, touched = this.touched;
    var self = this;
    touched.length = 0;

    items.forEach(function (it) {
      var own = it.own = new Array(nb).fill(0);
      var f = it.f, p = it.pos;
      var h = Math.max(p.alt * FT, 0);
      var reach = f.reach[0];
      if (h >= reach) return;
      var ground = Math.sqrt(reach * reach - h * h);
      var span = Math.floor(ground / (self.cellDeg * self.mPerDeg)) + 1;
      var c = self.cellIJ(p.lat, p.lon);
      for (var gi = c[0] - span; gi <= c[0] + span; gi++) {
        for (var gj = c[1] - span; gj <= c[1] + span; gj++) {
          var list = self.grid.get(gi * 100000 + gj);
          if (!list) continue;
          for (var k = 0; k < list.length; k++) {
            var b = list[k];
            var dy = (self.lat[b] - p.lat) * self.mPerDeg;
            var dx = (self.lon[b] - p.lon) * self.mPerDeg * self.lonScale;
            var L = self.levelAt(f.l150, Math.sqrt(dx * dx + dy * dy + h * h));
            if (L < bands[0]) continue;
            for (var j = 0; j < nb && L >= bands[j]; j++) own[j] += self.pop[b];
            if (level[b] === 0) touched.push(b);
            if (L > level[b]) level[b] = L;
          }
        }
      }
    });

    var total = { all: new Array(nb).fill(0), nyc: new Array(nb).fill(0), nj: new Array(nb).fill(0) };
    touched.forEach(function (b) {
      var L = level[b], region = self.region[b] ? total.nj : total.nyc;
      if (visit) visit(b, L);
      for (var j = 0; j < nb && L >= bands[j]; j++) {
        total.all[j] += self.pop[b];
        region[j] += self.pop[b];
      }
      level[b] = 0;
    });
    return total;
  };

  if (typeof module === 'object' && module.exports) module.exports = Model;
  else root.HOModel = Model;
})(this);
