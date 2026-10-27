/* Chopper Noise (choppernoise.publicworks.nyc) / the Flights page
   ------------------------------------------------------------------
   Two short answers from fleet.json. Most heard lists the five flights
   in each group that reached the most residents at 60+ dBA, each with a
   sketch of its path, the helicopter and the flight. Year built gives the
   median per flight in each category, with a row of dots by year. Loads
   after site.js. */

(function () {
  'use strict';

  var fmt, meta, fleet;

  var CATEGORY = {
    tour: 'Tour', charter: 'Charter', police: 'Police',
    medical: 'Medical', military: 'Military'
  };

  var FIRST_YEAR = 1970;

  function esc(s) { return HO.escapeHtml(s); }
  function groupClass(g) { return g.replace(' ', '-'); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function typeName(code) {
    return code ? meta.names[code] || code : 'Type not broadcast';
  }

  document.addEventListener('DOMContentLoaded', function () {
    fmt = HO.fmt;
    Promise.all([HO.load('meta.json'), HO.load('fleet.json')]).then(function (got) {
      meta = got[0];
      fleet = got[1];
      addLand();
      renderRanked();
      renderYears();
    }).catch(function () {
      document.getElementById('ranked').innerHTML =
        '<p>The flights did not load. Try reloading the page.</p>';
    });
  });

  // ---- Most heard -------------------------------------------------

  // Populated cells drawn once, then reused by every sketch.
  function addLand() {
    var c = fleet.cells, w = +c.lon_scale.toFixed(3), d = [];
    for (var k = 0; k < c.land.length; k += 2) {
      var x = +(c.land[k + 1] * w).toFixed(2), y = c.rows - c.land[k] - 1;
      d.push('M' + x + ' ' + y + 'h' + w + 'v1h-' + w + 'z');
    }
    document.body.insertAdjacentHTML('beforeend',
      '<svg width="0" height="0" aria-hidden="true" style="position:absolute">' +
        '<defs><path id="land" d="' + d.join('') + '"/></defs></svg>');
  }

  function sketch(path) {
    var c = fleet.cells, pts = [];
    for (var k = 0; k < path.length; k += 2) {
      pts.push((path[k + 1] * c.lon_scale).toFixed(1) + ',' + (c.rows - path[k]).toFixed(1));
    }
    var start = pts[0].split(',');
    return '<svg class="sketch" viewBox="0 0 ' + (c.cols * c.lon_scale).toFixed(1) + ' ' + c.rows +
        '" aria-hidden="true">' +
      '<use href="#land" class="sketch-land"/>' +
      '<polyline class="sketch-path" points="' + pts.join(' ') + '"/>' +
      '<circle class="sketch-start" cx="' + start[0] + '" cy="' + start[1] + '" r="1.6"/>' +
    '</svg>';
  }

  // Registration and owner as the FAA registry lists them. A withheld
  // aircraft shows neither.
  function who(f) {
    if (f.withheld) return 'Registration withheld at the owner’s request';
    return [f.reg, f.owner].filter(Boolean).join(' · ');
  }

  function line(cls, parts) {
    return '<span class="' + cls + '">' + esc(parts.filter(Boolean).join(' · ')) + '</span>';
  }

  function flightRow(f) {
    return '<li class="flight">' +
      sketch(f.path) +
      '<span class="flight-num">' + esc(fmt.people(f.residents)) + '</span>' +
      '<span class="flight-col">' +
        line('flight-main', [CATEGORY[f.cat], typeName(f.type), f.year && 'built ' + f.year]) +
        line('flight-sub', [who(f)]) +
      '</span>' +
      '<span class="flight-col">' +
        line('flight-main', [fmt.shortDate(f.day), fmt.clock(f.start), fmt.minutes(f.minutes * 60)]) +
        line('flight-sub', [fmt.num(f.miles) + ' mi', f.alt_ft && 'about ' + fmt.num(f.alt_ft) + ' ft',
          f.riders && 'up to ' + f.riders + ' aboard']) +
      '</span>' +
    '</li>';
  }

  function renderRanked() {
    document.getElementById('ranked').innerHTML = Object.keys(meta.groups).map(function (g) {
      return '<div class="ranked-group ' + groupClass(g) + '">' +
        '<h3><span class="swatch"></span>' + esc(cap(g)) + '</h3>' +
        '<ol>' + fleet.ranked[g].map(flightRow).join('') + '</ol>' +
      '</div>';
    }).join('');
  }

  // ---- Year built -------------------------------------------------

  function lastYear() {
    return +meta.days[meta.days.length - 1].day.slice(0, 4);
  }

  function pct(year) {
    return ((year - FIRST_YEAR) / (lastYear() - FIRST_YEAR) * 100).toFixed(2) + '%';
  }

  // A fixed-height row at any width. Circle area follows flights, on one
  // scale for every row.
  function strip(byYear, most) {
    var mid = 15;
    return '<svg class="strip" width="100%" height="30" role="img" ' +
        'aria-label="' + esc(byYear.map(function (y) { return y[1] + ' built ' + y[0]; }).join(', ')) + '">' +
      '<line class="strip-rule" x1="0" x2="100%" y1="' + mid + '" y2="' + mid + '"/>' +
      byYear.map(function (y) {
        var r = Math.max(Math.sqrt(y[1] / most) * (mid - 1), 1.5);
        return '<circle cx="' + pct(y[0]) + '" cy="' + mid + '" r="' + r.toFixed(1) + '">' +
          '<title>Built ' + y[0] + ' · ' + fmt.num(y[1]) + (y[1] === 1 ? ' flight' : ' flights') + '</title></circle>';
      }).join('') +
    '</svg>';
  }

  function axis() {
    var ticks = [];
    for (var y = FIRST_YEAR; y <= lastYear(); y += 10) ticks.push(y);
    return '<div class="years-axis" aria-hidden="true">' + ticks.map(function (y) {
      return '<span style="left:' + pct(y) + '">' + y + '</span>';
    }).join('') + '</div>';
  }

  function renderYears() {
    var cats = [];
    Object.keys(meta.groups).forEach(function (g) {
      meta.groups[g].forEach(function (c) { cats.push({ cat: c, group: g, y: fleet.years[c] }); });
    });
    var most = Math.max.apply(null, cats.map(function (c) {
      return Math.max.apply(null, c.y.by_year.map(function (y) { return y[1]; }).concat(1));
    }));
    document.getElementById('years').innerHTML = cats.map(function (c) {
      var known = c.y.median !== null;
      return '<div class="year-row ' + groupClass(c.group) + '">' +
        '<span class="year-cat">' + esc(CATEGORY[c.cat]) + '</span>' +
        '<span class="year-num">' + (known ? c.y.median : '—') + '</span>' +
        (known ? strip(c.y.by_year, most) :
          '<span class="year-none">Not in the FAA registry</span>') +
      '</div>';
    }).join('') + '<div class="year-row year-axis-row"><span></span><span></span>' + axis() + '</div>';

    var all = fleet.years.all;
    document.getElementById('year-note').textContent =
      'Year built from the FAA registry, known for ' + fmt.num(all.known) + ' of ' +
      fmt.num(all.flights) + ' flights. The median across all of them is ' + all.median + '.';
  }
})();
