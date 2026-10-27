/* Chopper Noise (choppernoise.publicworks.nyc) / the Report page
   ------------------------------------------------------------------
   One recorded day in numbers, from report.json. A day picker, as on
   the map, opens on the same median day and follows ?day=. Summary
   gives four numbers; Owners, Aircraft and Heliports are short tables
   ranked by times heard; Flights lists the five most-heard flights in
   each group with a sketch of each path. One time heard is one resident
   hearing one flight at 60+ dBA. Loads after site.js. */

(function () {
  'use strict';

  var fmt, meta, report, day;

  var CATEGORY = {
    tour: 'Tour', charter: 'Charter', police: 'Police',
    medical: 'Medical', military: 'Military'
  };

  var OWNER = {
    withheld: 'Withheld at the owner’s request',
    military: 'Military, no owner listed',
    unlisted: 'No owner listed'
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return HO.escapeHtml(s); }
  function groupClass(g) { return g.replace(' ', '-'); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function typeName(code) {
    return code === 'unknown' || !code ? 'Type not broadcast' : meta.names[code] || code;
  }

  document.addEventListener('DOMContentLoaded', function () {
    fmt = HO.fmt;
    Promise.all([HO.load('meta.json'), HO.load('report.json')]).then(function (got) {
      meta = got[0];
      report = got[1];
      addLand();
      buildPicker();
      render();
    }).catch(function () {
      $('tiles').innerHTML = '<p>The report did not load. Try reloading the page.</p>';
    });
  });

  // ---- Day ----------------------------------------------------------

  // The map's opening day: the median by flights, rounding up.
  function medianDay() {
    var byFlights = meta.days.slice().sort(function (a, b) {
      return a.flights - b.flights || a.day.localeCompare(b.day);
    });
    return byFlights[Math.floor(byFlights.length / 2)].day;
  }

  function buildPicker() {
    var known = meta.days.map(function (d) { return d.day; });
    var asked = HO.params().get('day');
    day = known.indexOf(asked) > -1 ? asked : medianDay();
    var select = $('day');
    select.innerHTML = meta.days.map(function (d) {
      return '<option value="' + d.day + '">' + esc(fmt.shortDate(d.day)) + ' ' + d.day.slice(0, 4) + '</option>';
    }).join('');
    select.value = day;
    select.addEventListener('change', function () {
      day = select.value;
      HO.setParams({ day: day });
      render();
    });
  }

  function render() {
    var r = report.days[day];
    renderTiles(r.summary);
    renderOwners(r);
    renderAircraft(r);
    renderPads(r);
    renderRanked(r.ranked);
  }

  // ---- Shared pieces ------------------------------------------------

  function pct(part, whole) {
    if (!whole) return '0%';
    var p = part / whole * 100;
    return p > 0 && p < 1 ? '<1%' : Math.round(p) + '%';
  }

  // Categories by flights, most first: "Charter 83 · Tour 5".
  function cats(c) {
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).map(function (k) {
      return CATEGORY[k] + ' ' + c[k];
    }).join(' · ');
  }

  // A share of the day's times heard, as a number over a thin bar.
  function shareCell(part, whole) {
    var w = whole ? Math.max(part / whole * 100, part ? 1 : 0) : 0;
    return '<td class="share wide-only"><span class="share-num">' + pct(part, whole) + '</span>' +
      '<span class="share-bar" style="width:' + w.toFixed(1) + '%"></span></td>';
  }

  function table(id, head, rows) {
    $(id).innerHTML = '<thead><tr>' + head.map(function (h) {
      var cls = [h.num && 'num', h.wide && 'wide-only'].filter(Boolean).join(' ');
      return '<th scope="col"' + (cls ? ' class="' + cls + '"' : '') + '>' + h.label + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody>';
  }

  // ---- Summary ------------------------------------------------------

  // Whole millions from ten million up, so a tile number stays short.
  function big(n) {
    return n >= 1e7 ? Math.round(n / 1e6) + ' million' : fmt.people(n);
  }

  function renderTiles(s) {
    var tiles = [
      [fmt.num(s.flights), 'flights', pct(s.non_essential, s.flights) + ' tours and charters'],
      [big(s.heard), 'times heard at 60+ dBA', pct(s.heard_non_essential, s.heard) + ' from tours and charters'],
      [big(s.residents_10), 'residents heard 10+ flights', 'at 60+ dBA'],
      [fmt.num(s.aboard), 'aboard, at most', 'seats minus one pilot, all flights']
    ];
    $('tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile"><p class="tile-num">' + esc(t[0]) + '</p>' +
        '<p class="tile-label">' + esc(t[1]) + '</p><p class="tile-sub">' + esc(t[2]) + '</p></div>';
    }).join('');
  }

  // ---- Owners -------------------------------------------------------

  function renderOwners(r) {
    var total = r.summary.heard;
    table('owner-table', [
      { label: 'Owner' }, { label: 'Flights by category', wide: true }, { label: 'Flights', num: true },
      { label: 'Times heard', num: true }, { label: 'Share', wide: true }
    ], r.owners.map(function (o) {
      var name = o.owner === 'others' ? o.owners + ' other owners' : OWNER[o.owner] || o.owner;
      var plain = o.owner in OWNER || o.owner === 'others';
      return '<tr><td class="' + (plain ? 'owner-plain' : 'owner') + '">' + esc(name) + '</td>' +
        '<td class="cats wide-only">' + esc(cats(o.cats)) + '</td>' +
        '<td class="num">' + fmt.num(o.flights) + '</td>' +
        '<td class="num">' + esc(fmt.people(o.heard)) + '</td>' +
        shareCell(o.heard, total) + '</tr>';
    }));
  }

  // ---- Heliports ----------------------------------------------------

  function renderPads(r) {
    var total = r.summary.heard;
    $('pad-note').textContent = 'Flights that started or ended within ' + report.pad.km +
      ' km of each heliport, below ' + fmt.num(report.pad.ft) + ' ft. A flight between two heliports counts at both.';
    var pads = r.heliports.slice().sort(function (a, b) { return b.heard - a.heard; });
    table('pad-table', [
      { label: 'Heliport' }, { label: 'Flights by category', wide: true }, { label: 'Flights', num: true },
      { label: 'Times heard', num: true }, { label: 'Share', wide: true }
    ], pads.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td>' +
        '<td class="cats wide-only">' + esc(cats(p.cats) || 'none') + '</td>' +
        '<td class="num">' + fmt.num(p.flights) + '</td>' +
        '<td class="num">' + esc(fmt.people(p.heard)) + '</td>' +
        shareCell(p.heard, total) + '</tr>';
    }));
  }

  // ---- Flights ------------------------------------------------------

  // Populated cells drawn once, then reused by every sketch.
  function addLand() {
    var c = report.cells, w = +c.lon_scale.toFixed(3), d = [];
    for (var k = 0; k < c.land.length; k += 2) {
      var x = +(c.land[k + 1] * w).toFixed(2), y = c.rows - c.land[k] - 1;
      d.push('M' + x + ' ' + y + 'h' + w + 'v1h-' + w + 'z');
    }
    document.body.insertAdjacentHTML('beforeend',
      '<svg width="0" height="0" aria-hidden="true" style="position:absolute">' +
        '<defs><path id="land" d="' + d.join('') + '"/></defs></svg>');
  }

  function sketch(path) {
    var c = report.cells, pts = [];
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

  function who(f) {
    if (f.withheld) return OWNER.withheld;
    return [f.reg, f.owner].filter(Boolean).join(' · ');
  }

  function line(cls, parts) {
    return '<span class="' + cls + '">' + esc(parts.filter(Boolean).join(' · ')) + '</span>';
  }

  function flightRow(f) {
    return '<li class="flight">' +
      sketch(f.path) +
      '<span class="flight-num">' + esc(fmt.people(f.heard)) + '</span>' +
      '<span class="flight-col">' +
        line('flight-main', [CATEGORY[f.cat], typeName(f.type), f.year && 'built ' + f.year]) +
        line('flight-sub', [who(f)]) +
      '</span>' +
      '<span class="flight-col">' +
        line('flight-main', [fmt.clock(f.start), fmt.minutes(f.minutes * 60)]) +
        line('flight-sub', [fmt.num(f.miles) + ' mi', f.alt_ft && 'about ' + fmt.num(f.alt_ft) + ' ft',
          f.riders && 'up to ' + f.riders + ' aboard']) +
      '</span>' +
    '</li>';
  }

  function renderRanked(ranked) {
    $('ranked').innerHTML = Object.keys(meta.groups).map(function (g) {
      var rows = ranked[g];
      return '<div class="ranked-group ' + groupClass(g) + '">' +
        '<h3><span class="swatch"></span>' + esc(cap(g)) + '</h3>' +
        (rows.length ? '<ol>' + rows.map(flightRow).join('') + '</ol>' :
          '<p class="note">No flights this day.</p>') +
      '</div>';
    }).join('');
  }

  // ---- Aircraft -----------------------------------------------------

  function renderAircraft(r) {
    var total = r.summary.heard;
    table('aircraft-table', [
      { label: 'Registration' }, { label: 'Type' }, { label: 'Built', num: true },
      { label: 'Owner', wide: true }, { label: 'Flights by category', wide: true },
      { label: 'Flights', num: true }, { label: 'Times heard', num: true }, { label: 'Share', wide: true }
    ], r.aircraft.map(function (a) {
      var owner = a.withheld ? '' : a.owner || (a.cats.military ? OWNER.military : OWNER.unlisted);
      return '<tr><td class="' + (a.withheld ? 'owner-plain' : 'reg') + '">' +
          esc(a.withheld ? 'Withheld' : a.reg || '—') + '</td>' +
        '<td>' + esc(typeName(a.type)) + '</td>' +
        '<td class="num">' + (a.year || '—') + '</td>' +
        '<td class="owner wide-only">' + esc(owner) + '</td>' +
        '<td class="cats wide-only">' + esc(cats(a.cats)) + '</td>' +
        '<td class="num">' + fmt.num(a.flights) + '</td>' +
        '<td class="num">' + esc(fmt.people(a.heard)) + '</td>' +
        shareCell(a.heard, total) + '</tr>';
    }));
  }
})();
