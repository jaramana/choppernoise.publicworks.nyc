/* Chopper Noise (choppernoise.publicworks.nyc) / the map
   ------------------------------------------------------------------
   Two views of one recorded day, built to read the same way.

   Replay moves every helicopter along its path, one minute of the day every
   two seconds. Rings show where its modeled peak level reaches 50, 60, 70
   and 80 dBA on the ground. Blocks light up as 60 dBA or more reaches them
   and fade after the helicopter passes.

   Whole day answers who hears them again and again, from pipeline stage 5.
   Blocks that heard ten or more flights at 60 dBA or more are dots in the
   color of the loudest level they heard ten times, under the day's paths.
   Only Replay answers the pointer; Whole day is a picture to read.

   Both views fill one panel: residents set against people aboard, the same
   four level rows, then flights by category. On the map a block is one dot
   style, sized by residents. Orange shades mean 60, 70 and 80 dBA, faint
   gray means 50, and rose and blue mark the two flight groups.

   The basemap is OpenFreeMap's Positron, trimmed and recolored before the
   map first draws. Layer order, bottom to top:
     land, water, roads  ·  day blocks  ·  day paths  ·  sound rings  ·
     lit blocks  ·  trails  ·
     place labels  ·  helicopters */

(function () {
  'use strict';

  var STYLE = 'https://tiles.openfreemap.org/styles/positron';
  var ATTRIBUTION =
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ' +
    '<a href="https://openfreemap.org/">OpenFreeMap</a> · ' +
    'Flights: <a href="https://adsb.lol/">adsb.lol</a>';

  // Where most flights are: the Hudson, the harbor and the East River.
  var START_VIEW = [[-74.09, 40.64], [-73.89, 40.83]];
  var MAX_BOUNDS = [[-74.75, 40.25], [-73.25, 41.15]];

  var COLORS = {
    land: '#faf9f6', water: '#cfe2ee', waterText: '#5f7d8f', park: '#e7efdf',
    building: '#f0eee9', buildingEdge: '#e4e1da', airport: '#eeede8',
    place: '#3f454c', neighborhood: '#6a7178',
    'non-essential': '#c4387a', 'public service': '#2a78d6',
    band: { 50: '#8b95a7', 60: '#de6f25', 70: '#b7470f', 80: '#7a2a08' },
    backdrop: '#7d8696', ink: '#16181d'
  };

  var DROP = /^(landcover_|landuse_|aeroway-taxiway|railway|boundary_|highway_path|highway-name-path|highway-name-minor|highway-shield|road_shield|label_state|label_country)/;
  var roadFill = ['interpolate', ['linear'], ['zoom'], 10, '#f1f1ee', 13, '#ffffff'];
  var roadEdge = ['interpolate', ['linear'], ['zoom'], 10, '#e6e5e0', 13, '#d8d6d0'];

  var CATEGORY = {
    tour: 'Tour', charter: 'Charter', police: 'Police',
    medical: 'Medical', military: 'Military'
  };

  // Each 10 dB sounds about twice as loud, so the rows count up in
  // doublings from 50. 50 marks presence rather than harm.
  var LOUDER = { 50: 'audible', 60: '2× as loud', 70: '4× as loud', 80: '8× as loud' };

  // Everyday sounds at roughly each level, for the rows' tooltips.
  var LIKE = { 50: 'moderate rain', 60: 'a conversation', 70: 'a vacuum cleaner', 80: 'a garbage disposal' };

  // A face per level: 50 hears it, 60 is annoyed, 70 is angry, 80 has had
  // enough. Drawn in a 20-unit square on a disc of the level's color.
  var FACE = {
    50: '<circle cx="7" cy="8.6" r="1.15"/><circle cx="13" cy="8.6" r="1.15"/><path d="M7 13.3h6"/>',
    60: '<path d="M5.7 6.7h3M11.3 6.7h3"/><circle cx="7.2" cy="9.1" r="1.1"/><circle cx="12.8" cy="9.1" r="1.1"/>' +
        '<path d="M7.3 14l5.4-.9"/>',
    70: '<path d="M5.1 5.6l3.7 1.9M14.9 5.6l-3.7 1.9"/><circle cx="7.3" cy="9.6" r="1.1"/><circle cx="12.7" cy="9.6" r="1.1"/>' +
        '<path d="M6.6 14.7q3.4-3 6.8 0"/>',
    80: '<path d="M5.7 7.1l2.9 1.7-2.9 1.7M14.3 7.1l-2.9 1.7 2.9 1.7"/>' +
        '<path d="M6 14.1l1.6-1.3 1.6 1.3 1.6-1.3 1.6 1.3 1.6-1.3"/>'
  };

  function faceHTML(b) {
    return '<svg class="face b' + b + '" viewBox="0 0 20 20" aria-hidden="true">' +
      '<circle class="disc" cx="10" cy="10" r="9"/><g class="feat">' + FACE[b] + '</g></svg>';
  }

  var HEADLINE = 60;     // the level the big numbers count from
  var REPEAT = 10;       // flights in a day that put a block on the whole-day map
  var SPEED = 30;        // seconds of the day per second of replay
  var GLOW_TAU = 60;     // seconds of the day for a lit block to fade to a third
  var TRAIL_STEPS = 24;  // four minutes of path behind each helicopter
  var BIN = 600;         // the timeline's bars are ten minutes wide
  var READOUT_MS = 120;  // the panel redraws at most this often

  // One dot for a block in either view, sized by the square root of its
  // residents within limits, with a white hairline once dots separate.
  var DOT_RADIUS = ['interpolate', ['linear'], ['zoom'],
    10, ['*', ['get', 's'], 1.6], 13, ['*', ['get', 's'], 3.6], 16, ['*', ['get', 's'], 7]];
  var DOT_OPACITY = 0.9;

  function dotSize(pop) { return Math.min(Math.max(Math.sqrt(pop) / 18, 0.6), 1.5); }

  function dotPaint(color, opacity) {
    return {
      'circle-radius': DOT_RADIUS, 'circle-color': color, 'circle-opacity': opacity,
      'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': opacity,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0, 14, 0.6],
      'circle-pitch-alignment': 'map'
    };
  }

  // Meters per pixel at zoom 0, at the city's latitude, for 512 px tiles.
  var MPP0 = 78271.517 * Math.cos(40.7 * Math.PI / 180);

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wide = window.matchMedia('(min-width: 60rem)');

  var fmt, meta, model, map, ready = false, groupOf = {}, HI;
  var days = {};
  var day = null;
  var state = { day: null, view: 'replay', group: 'all', t: 0, playing: false };
  var dirty = true, lastFrame = null, lastReadout = 0, lastBin = -1, lastFlights = '';
  var current = { items: [], total: null };
  var glow = { level: null, band: null, shown: null, list: [], t: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return HO.escapeHtml(s); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function groupClass(g) { return g.replace(' ', '-'); }

  // ---- Boot ---------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    fmt = HO.fmt;
    message('Clearing the airspace…');
    Promise.all([HO.load('meta.json'), HO.load('blocks.json')]).then(function (got) {
      meta = got[0];
      model = new window.HOModel(meta, got[1]);
      HI = meta.bands.indexOf(HEADLINE);
      Object.keys(meta.groups).forEach(function (g) {
        meta.groups[g].forEach(function (c) { groupOf[c] = g; });
      });
      readParams();
      buildControls();
      buildReadout();
      return loadDay(state.day);
    }).then(function () {
      startView();
      createMap();
      requestAnimationFrame(tick);
    }).catch(function (err) {
      message('Could not load the flights. ' + err.message + ' Try reloading.');
      if (window.console) console.error(err);
    });
  });

  function message(text) { $('map-message').textContent = text || ''; }

  function readParams() {
    var p = HO.params();
    var known = meta.days.map(function (d) { return d.day; });
    state.day = known.indexOf(p.get('day')) > -1 ? p.get('day') : known[known.length - 1];
    if (p.get('view') === 'whole-day') state.view = 'whole-day';
    var g = (p.get('group') || '').replace('-', ' ');
    if (g === 'non-essential' || g === 'public service') state.group = g;
    var t = /^(\d{1,2}):(\d{2})$/.exec(p.get('t') || '');
    state.urlTime = t ? Math.min(+t[1] * 3600 + +t[2] * 60, 86390) : null;
  }

  function writeParams() {
    HO.setParams({
      day: state.day,
      view: state.view === 'whole-day' ? 'whole-day' : null,
      group: state.group === 'all' ? null : groupClass(state.group),
      t: state.view === 'replay' ? clock24(state.t) : null
    });
  }

  function clock24(s) {
    var m = Math.floor(s / 60);
    return Math.floor(m / 60) + ':' + ('0' + m % 60).slice(-2);
  }

  function loadDay(iso) {
    if (days[iso]) { day = days[iso]; return Promise.resolve(day); }
    return HO.load('day-' + iso + '.json').then(function (raw) {
      var d = model.decodeDay(raw);
      d.byId = {};
      d.flights.forEach(function (f) { f.group = groupOf[f.cat]; d.byId[f.id] = f; });
      d.end = (d.steps - 1) * meta.step;
      days[iso] = day = d;
      return d;
    });
  }

  // Flights heard per block, for the whole-day dots.
  function loadEvents() {
    var d = day;
    return HO.load('events-' + d.day + '.json').then(function (ev) { d.events = ev; return d; });
  }

  function inGroup(f) { return state.group === 'all' || f.group === state.group; }

  // The opening moment: the linked time, or the busiest ten minutes.
  function startView() {
    var bins = traffic();
    if (state.urlTime !== null) {
      state.t = state.urlTime;
    } else {
      var best = 0;
      bins.forEach(function (n, i) { if (n > bins[best]) best = i; });
      state.t = best * BIN;
      state.playing = !reduced && state.view === 'replay';
    }
    renderAll();
  }

  // ---- Controls -----------------------------------------------------

  function buildControls() {
    var select = $('day');
    select.innerHTML = meta.days.map(function (d) {
      return '<option value="' + d.day + '">' + esc(fmt.shortDate(d.day)) + ' ' + d.day.slice(0, 4) + '</option>';
    }).join('');
    select.addEventListener('change', function () {
      state.day = select.value;
      loadDay(state.day).then(function () {
        state.t = Math.min(state.t, day.end);
        renderAll();
        if (ready) { clearGlow(); setTracks(); setBlocks(); }
      });
    });

    $('views').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b && b.dataset.view !== state.view) setView(b.dataset.view);
    });

    $('groups').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.dataset.group === state.group) return;
      state.group = b.dataset.group;
      renderAll();
      if (ready) applyGroup();
    });

    // In Whole day, play opens Replay and starts the day moving.
    $('play').addEventListener('click', function () {
      if (state.view === 'whole-day') { setView('replay'); play(); return; }
      state.playing ? pause() : play();
    });
    var range = $('time');
    range.addEventListener('input', function () { state.t = +range.value; dirty = true; });
    range.addEventListener('change', writeParams);

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (e.key === ' ' && state.view === 'replay' && ['input', 'button', 'select', 'a', 'textarea'].indexOf(tag) < 0) {
        e.preventDefault();
        state.playing ? pause() : play();
      }
    });

    buildScrubTip();
  }

  function play() {
    if (state.t >= day.end) state.t = 0;
    state.playing = true; lastFrame = null;
    renderPlay();
  }

  function pause() {
    state.playing = false;
    renderPlay();
    writeParams();
  }

  function renderPlay() {
    var b = $('play');
    b.innerHTML = state.playing
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.2v11.6c0 .6.7 1 1.2.7l9-5.8c.5-.3.5-1.1 0-1.4l-9-5.8C4.7 1.2 4 1.6 4 2.2z"/></svg>';
    b.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }

  function pressed(container, attr, value) {
    container.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
    });
  }

  function setView(view) {
    state.view = view;
    if (view === 'whole-day') pause();
    if (ready) clearGlow();
    renderAll();
    if (!ready) return;
    applyView();
    $('map-tip').hidden = true;
  }

  function renderAll() {
    $('day').value = state.day;
    pressed($('views'), 'view', state.view);
    pressed($('groups'), 'group', state.group);

    // The bar stays in both views so the map never resizes. Whole day shows
    // the full curve with no playhead.
    var replay = state.view === 'replay';
    $('timeline').classList.toggle('whole', !replay);
    $('time').hidden = !replay;
    $('pace').textContent = replay ? '1 minute every 2 seconds' : 'Residents at ' + HEADLINE + '+ dBA';
    $('scope').textContent = replay ? 'Now' : 'Heard ' + REPEAT + '+ flights today';
    renderPlay();
    renderSpark();
    if (!replay) renderWholeDay();
    lastBin = -1;
    renderClock();
    dirty = true;
    writeParams();
  }

  // ---- Timeline -----------------------------------------------------

  // Helicopters aloft in each ten-minute bin, for the flights shown. It
  // picks the opening moment, before the residents curve is ready.
  function traffic() {
    var bins = new Array(Math.ceil(day.steps * meta.step / BIN)).fill(0);
    day.flights.forEach(function (f) {
      if (!inGroup(f)) return;
      for (var b = Math.floor(f.t0 / BIN); b <= Math.floor(f.t1 / BIN); b++) bins[b]++;
    });
    return bins;
  }

  // Residents at 60+ dBA through the day: the most at once in each bin,
  // sampled every minute with the same model as the live count. Built in
  // short slices so the page stays responsive, and kept per day and group.
  var CURVE_STEP = 60;

  function curve(d, group) {
    d.curves = d.curves || {};
    if (d.curves[group]) return d.curves[group];
    var flights = d.flights.filter(function (f) { return group === 'all' || f.group === group; });
    var bins = new Array(Math.ceil(d.steps * meta.step / BIN)).fill(0);
    d.curves[group] = new Promise(function (resolve) {
      var t = 0;
      (function slice() {
        var stop = performance.now() + 8;
        for (; t <= d.end && performance.now() < stop; t += CURVE_STEP) {
          var items = [];
          for (var i = 0; i < flights.length; i++) {
            var f = flights[i];
            if (t >= f.t0 && t <= f.t1) items.push({ f: f, pos: model.where(f, t) });
          }
          if (items.length) {
            var b = Math.floor(t / BIN);
            bins[b] = Math.max(bins[b], model.exposure(items).all[HI]);
          }
        }
        if (t <= d.end) setTimeout(slice, 0); else resolve(bins);
      })();
    });
    return d.curves[group];
  }

  function renderSpark() {
    var d = day, group = state.group, svg = $('spark');
    $('time').max = d.end;
    d.bins = null;
    svg.innerHTML = '';
    curve(d, group).then(function (bins) {
      if (day !== d || state.group !== group) return;
      d.bins = bins;
      var max = Math.max.apply(null, bins.concat([1]));
      svg.setAttribute('viewBox', '0 0 ' + bins.length + ' 100');
      svg.innerHTML = bins.map(function (n, i) {
        var h = n ? Math.max(4, n / max * 100) : 0;
        return '<rect x="' + (i + 0.1) + '" y="' + (100 - h) + '" width=".8" height="' + h + '"/>';
      }).join('');
      lastBin = -1;
      renderClock();
    });
  }

  function buildScrubTip() {
    var scrub = $('scrub');
    var tip = HO.el('div', { class: 'spark-tip', hidden: '' });
    scrub.appendChild(tip);
    scrub.addEventListener('pointermove', function (e) {
      if (!day || !day.bins || state.view !== 'replay') return;
      var r = scrub.getBoundingClientRect();
      var x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
      var i = Math.min(Math.floor(x / r.width * day.bins.length), day.bins.length - 1);
      tip.textContent = fmt.clock(i * BIN) + ' · up to ' + fmt.people(day.bins[i]) +
        ' residents at ' + HEADLINE + '+ dBA';
      tip.style.left = x + 'px';
      tip.hidden = false;
    });
    scrub.addEventListener('pointerleave', function () { tip.hidden = true; });
  }

  // Bars up to now are lit in Replay; Whole day lights them all.
  function renderClock() {
    var whole = state.view === 'whole-day';
    var bin = whole ? Infinity : Math.floor(state.t / BIN);
    if (bin !== lastBin) {
      lastBin = bin;
      var rects = $('spark').children;
      for (var i = 0; i < rects.length; i++) rects[i].classList.toggle('on', i <= bin);
    }
    $('clock').textContent = whole ? 'All day' : fmt.clock(state.t);
    var range = $('time');
    if (document.activeElement !== range) range.value = Math.round(state.t / 10) * 10;
  }

  // ---- The loop -----------------------------------------------------

  function tick(now) {
    if (state.playing && state.view === 'replay') {
      if (lastFrame !== null) {
        state.t = Math.min(state.t + (now - lastFrame) / 1000 * SPEED, day.end);
        dirty = true;
        if (state.t >= day.end) pause();
      }
      lastFrame = now;
    } else {
      lastFrame = null;
    }
    if (dirty && state.view === 'replay') {
      dirty = false;
      frame(now);
    }
    requestAnimationFrame(tick);
  }

  function frame(now) {
    var t = state.t, items = [], hits = [];
    day.flights.forEach(function (f) {
      if (t >= f.t0 && t <= f.t1 && inGroup(f)) items.push({ f: f, pos: model.where(f, t) });
    });
    current.items = items;
    current.total = model.exposure(items, function (b, L) {
      if (L >= HEADLINE) hits.push(b, L >= 80 ? 2 : L >= 70 ? 1 : 0);
    });

    if (ready) { drawMap(items, now); updateGlow(t, hits); }
    renderClock();
    if (now - lastReadout > READOUT_MS || !state.playing) {
      lastReadout = now;
      renderNow();
      renderFlights();
    }
  }

  // ---- Panel ------------------------------------------------------

  // One row style for both views: a face for the level, how loud it
  // sounds, a bar and the count. The most severe row comes first, the lead
  // row is bold, and 50 sits muted below a rule.
  function rowsHTML() {
    return '<ul class="rows" id="rows">' + meta.bands.slice().reverse().map(function (b) {
      var kind = b === HEADLINE ? 'lead' : b < HEADLINE ? 'presence' : '';
      return '<li' + (kind ? ' class="' + kind + '"' : '') +
        ' title="' + b + '+ dBA, about as loud as ' + LIKE[b] + '">' +
        '<span class="mark">' + faceHTML(b) + '</span>' +
        '<span class="label"><b>' + b + '+</b> ' + LOUDER[b] + '</span>' +
        '<span class="bar"><i style="background:' + COLORS.band[b] + '"></i></span>' +
        '<span class="v">—</span></li>';
    }).join('') + '</ul>';
  }

  // Bars stay to scale against the lead row, so 60+ fills its track and
  // 70+ and 80+ show their true share of it. Any count above zero keeps a
  // sliver. 50+ runs past the scale, so its bar fills the track and trails
  // off in dots.
  function fillRows(values) {
    var rows = $('rows').children, base = values[meta.bands.length - 1 - HI] || 1;
    for (var i = 0; i < rows.length; i++) {
      rows[i].querySelector('.v').textContent = fmt.people(values[i]);
      var bar = rows[i].querySelector('i'), over = values[i] > base;
      var pct = Math.min(values[i] / base * 100, 100).toFixed(1);
      bar.classList.toggle('more', over);
      bar.style.width = over ? 'calc(100% - 1.3rem)' : values[i] ? 'max(3px, ' + pct + '%)' : '0';
    }
  }

  // The lead number beside the people aboard. One scope line above them
  // is the only text that changes between views; the labels stay put.
  // Riders are an upper bound, so the label says "at most".
  function summaryHTML() {
    return '<h2 class="section-h" id="scope"></h2>' +
      '<div class="pair">' +
        '<div id="hero-box"><p class="hero-num" id="hero">—</p>' +
          '<p class="hero-label">residents at ' + HEADLINE + '+ dBA</p></div>' +
        '<div class="aboard"><p class="hero-num" id="aboard">—</p>' +
          '<p class="hero-label">aboard, at most</p></div>' +
      '</div>' + rowsHTML();
  }

  function aboard(flights) {
    return flights.reduce(function (s, f) { return s + (f.riders || 0); }, 0);
  }

  // A lead count with "million" set small, so it stays on one line.
  function heroNum(n) {
    return esc(fmt.people(n)).replace(' million', '<small> million</small>');
  }

  // Fills the summary in either view. The region split sits in a tooltip.
  function fillSummary(lead, riders, rows) {
    $('hero').innerHTML = heroNum(lead.all);
    $('hero-box').title = fmt.people(lead.nyc) + ' in New York City · ' + fmt.people(lead.nj) + ' in New Jersey';
    $('aboard').textContent = fmt.num(riders);
    fillRows(rows);
  }

  function buildReadout() {
    $('summary').innerHTML = summaryHTML();
  }

  function renderNow() {
    var tot = current.total;
    fillSummary({ all: tot.all[HI], nyc: tot.nyc[HI], nj: tot.nj[HI] },
      aboard(current.items.map(function (it) { return it.f; })), tot.all.slice().reverse());
  }

  // Leads with repetition: residents who heard ten or more flights, at each
  // level in the rows.
  function renderWholeDay() {
    var heard = day.heard[state.group];
    fillSummary(heard[String(HEADLINE)][String(REPEAT)], aboard(day.flights.filter(inGroup)),
      meta.bands.slice().reverse().map(function (b) { return heard[String(b)][String(REPEAT)].all; }));
    renderFlights();
  }

  // Flights by group and category, the same list in both views: the
  // helicopters in the air in Replay, every flight in Whole day.
  function renderFlights() {
    var replay = state.view === 'replay';
    var flights = replay ? current.items.map(function (it) { return it.f; }) : day.flights;
    var counts = {}, shown = flights.filter(inGroup).length;
    flights.forEach(function (f) { counts[f.cat] = (counts[f.cat] || 0) + 1; });
    var html =
      '<h2 class="section-h">' + shown + (shown === 1 ? ' flight' : ' flights') + (replay ? ' now' : ' today') + '</h2>' +
      '<ul class="groups-sum">' +
      Object.keys(meta.groups).map(function (g) {
        var cats = meta.groups[g].filter(function (c) { return counts[c]; });
        var total = meta.groups[g].reduce(function (s, c) { return s + (counts[c] || 0); }, 0);
        var dim = state.group !== 'all' && state.group !== g;
        return '<li' + (dim ? ' class="dim"' : '') + '><span class="dot ' + groupClass(g) + '"></span>' +
          '<span><b>' + esc(cap(g)) + '</b><small>' +
            (cats.map(function (c) { return esc(CATEGORY[c]) + ' ' + counts[c]; }).join(' · ') || 'none') +
          '</small></span><b>' + total + '</b></li>';
      }).join('') + '</ul>';
    if (html !== lastFlights) { $('flights').innerHTML = html; lastFlights = html; }
  }

  function altitude(ft) {
    return ft < 100 ? 'on the ground' : fmt.num(Math.round(ft / 50) * 50) + ' ft';
  }

  function typeName(code) {
    return code ? meta.names[code] || code : 'Type not broadcast';
  }

  // ---- Helicopter icons ---------------------------------------------

  // A top-down helicopter, nose to the north, drawn at twice its size. The
  // blades are a separate image so they can turn while the replay plays.
  function heliCanvas(color, blades) {
    var size = 30, ratio = 2, m = size / 2;
    var c = document.createElement('canvas');
    c.width = c.height = size * ratio;
    var x = c.getContext('2d');
    x.scale(ratio, ratio);
    x.lineCap = 'round';
    if (blades) {
      x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 3.4;
      line(x, m - 11, m, m + 11, m); line(x, m, m - 11, m, m + 11);
      x.strokeStyle = color; x.lineWidth = 1.6;
      line(x, m - 11, m, m + 11, m); line(x, m, m - 11, m, m + 11);
      return c;
    }
    x.strokeStyle = '#fff'; x.lineWidth = 4.4;
    line(x, m, m + 3, m, m + 12); line(x, m - 3.5, m + 12, m + 3.5, m + 12);
    x.strokeStyle = color; x.lineWidth = 2.2;
    line(x, m, m + 3, m, m + 12); line(x, m - 3.5, m + 12, m + 3.5, m + 12);
    x.beginPath(); x.ellipse(m, m - 1, 4.4, 6.8, 0, 0, 2 * Math.PI);
    x.fillStyle = color; x.fill();
    x.lineWidth = 1.8; x.strokeStyle = '#fff'; x.stroke();
    return c;
  }

  function line(x, x1, y1, x2, y2) { x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); }

  function addIcons() {
    ['non-essential', 'public service'].forEach(function (g) {
      [false, true].forEach(function (blades) {
        var c = heliCanvas(COLORS[g], blades);
        map.addImage((blades ? 'blades-' : 'heli-') + g,
          c.getContext('2d').getImageData(0, 0, c.width, c.height), { pixelRatio: 2 });
      });
    });
  }

  // ---- Basemap ------------------------------------------------------

  function restyle(style) {
    var paint = {
      background: { 'background-color': COLORS.land },
      water: { 'fill-color': COLORS.water },
      waterway: { 'line-color': COLORS.water },
      park: { 'fill-color': COLORS.park },
      building: { 'fill-color': COLORS.building, 'fill-outline-color': COLORS.buildingEdge },
      'aeroway-area': { 'fill-color': COLORS.airport },
      highway_minor: { 'line-color': roadFill },
      highway_major_inner: { 'line-color': roadFill },
      highway_motorway_inner: { 'line-color': roadFill },
      highway_motorway_bridge_inner: { 'line-color': roadFill },
      highway_major_casing: { 'line-color': roadEdge },
      highway_motorway_casing: { 'line-color': roadEdge },
      highway_motorway_bridge_casing: { 'line-color': roadEdge },
      water_name_point_label: { 'text-color': COLORS.waterText },
      water_name_line_label: { 'text-color': COLORS.waterText },
      waterway_line_label: { 'text-color': COLORS.waterText },
      label_other: { 'text-color': COLORS.neighborhood },
      label_village: { 'text-color': COLORS.place },
      label_town: { 'text-color': COLORS.place },
      label_city: { 'text-color': COLORS.place },
      label_city_capital: { 'text-color': COLORS.place }
    };
    style.layers = style.layers.filter(function (l) { return !DROP.test(l.id); });
    style.layers.forEach(function (l) {
      Object.assign(l.paint = l.paint || {}, paint[l.id] || {});
    });
    return style;
  }

  function basemap() {
    return fetch(STYLE)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(restyle)
      .catch(function () { return STYLE; });
  }

  // ---- Map ----------------------------------------------------------

  function createMap() {
    if (!window.maplibregl) {
      message('The map library did not load. The numbers in the panel still work.');
      return;
    }
    basemap().then(function (style) {
      try {
        map = new maplibregl.Map({
          container: 'map', style: style, bounds: START_VIEW,
          fitBoundsOptions: { padding: 12 },
          minZoom: 8.5, maxZoom: 17, maxBounds: MAX_BOUNDS,
          attributionControl: false, dragRotate: false, pitchWithRotate: false,
          scrollZoom: wide.matches
        });
      } catch (err) {
        message(String(err).indexOf('WebGL') > -1
          ? 'This browser has WebGL turned off, so it cannot draw the map. The numbers in the panel still work.'
          : 'This browser could not open the map. The numbers in the panel still work.');
        return;
      }
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      $('map').appendChild(HO.el('div', { class: 'map-attrib', html: ATTRIBUTION }));
      wide.addEventListener('change', function () {
        wide.matches ? map.scrollZoom.enable() : map.scrollZoom.disable();
      });
      map.on('load', function () {
        ready = true;
        addIcons();
        addLayers();
        setTracks();
        setBlocks();
        applyView();
        applyGroup();
        bindPointer();
        message('');
        dirty = true;
      });
      map.on('error', function (e) {
        if (window.console) console.warn(e && e.error);
      });
    });
  }

  function firstLabel() {
    var hit = map.getStyle().layers.filter(function (l) { return l.type === 'symbol'; })[0];
    return hit ? hit.id : undefined;
  }

  // A ring's radius in meters becomes pixels at every zoom.
  function metersToPixels(prop) {
    return ['interpolate', ['exponential', 2], ['zoom'],
      0, ['/', ['get', prop], MPP0],
      22, ['/', ['*', ['get', prop], Math.pow(2, 22)], MPP0]];
  }

  var EMPTY = { type: 'FeatureCollection', features: [] };
  var TRAIL_LAYERS = ['trails-non-essential', 'trails-public-service'];

  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  var BY_GROUP = ['match', ['get', 'g'], 'public service', COLORS['public service'], COLORS['non-essential']];

  function addLayers() {
    var below = firstLabel();
    ['aloft', 'tracks', 'blocks'].forEach(function (id) {
      map.addSource(id, { type: 'geojson', data: EMPTY });
    });
    map.addSource('trails', { type: 'geojson', data: EMPTY, lineMetrics: true });
    map.addSource('residents', { type: 'geojson', data: residentPoints() });

    // Whole day: color and filter are set per group in applyGroup.
    map.addLayer({ id: 'blocks', type: 'circle', source: 'blocks',
      paint: dotPaint(COLORS.band[60], DOT_OPACITY) }, below);

    map.addLayer({ id: 'tracks', type: 'line', source: 'tracks',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': BY_GROUP, 'line-width': 0.8, 'line-opacity': 0.07 } }, below);

    // The 50 ring is a faint neutral edge: presence, not loudness.
    var fill = { 50: 0.04, 60: 0.16, 70: 0.26, 80: 0.4 };
    var edge = { 50: 0.4, 60: 0.7, 70: 0.8, 80: 0.9 };
    meta.bands.forEach(function (b) {
      map.addLayer({ id: 'ring-' + b, type: 'circle', source: 'aloft',
        filter: ['>', ['get', 'r' + b], 0],
        paint: {
          'circle-radius': metersToPixels('r' + b),
          'circle-color': COLORS.band[b],
          'circle-opacity': fill[b],
          'circle-stroke-color': COLORS.band[b],
          'circle-stroke-width': b < HEADLINE ? 0.8 : 1,
          'circle-stroke-opacity': edge[b],
          'circle-pitch-alignment': 'map'
        } }, below);
    });

    // Replay: every block, invisible until sound reaches it. Feature state
    // carries the glow, so a fade is a state change rather than new data.
    map.addLayer({ id: 'lit', type: 'circle', source: 'residents',
      paint: dotPaint(
        ['match', ['coalesce', ['feature-state', 'band'], 0], 2, COLORS.band[80], 1, COLORS.band[70], COLORS.band[60]],
        ['*', ['coalesce', ['feature-state', 'o'], 0], DOT_OPACITY]) }, below);

    // Trails fade from clear at the tail to the group's color at the
    // helicopter. A gradient cannot vary by feature, so each group has a layer.
    TRAIL_LAYERS.forEach(function (id, i) {
      var g = ['non-essential', 'public service'][i];
      map.addLayer({ id: id, type: 'line', source: 'trails', filter: ['==', ['get', 'g'], g],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 1.6, 'line-gradient': ['interpolate', ['linear'], ['line-progress'],
          0, rgba(COLORS[g], 0), 1, rgba(COLORS[g], 0.65)] } }, below);
    });

    ['heli', 'blades'].forEach(function (kind) {
      map.addLayer({ id: kind, type: 'symbol', source: 'aloft',
        layout: {
          'icon-image': ['concat', kind + '-', ['get', 'g']],
          'icon-rotate': ['get', kind === 'heli' ? 'hdg' : 'spin'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true, 'icon-ignore-placement': true
        } });
    });
  }

  // Whole day colors each path by group, as the trails are in Replay, and
  // keeps them faint so the dots still read. Replay shows the same paths as
  // a gray backdrop behind the helicopters in the air.
  function applyView() {
    var replay = state.view === 'replay';
    meta.bands.map(function (b) { return 'ring-' + b; })
      .concat(['lit', 'heli', 'blades'], TRAIL_LAYERS)
      .forEach(function (id) { map.setLayoutProperty(id, 'visibility', replay ? 'visible' : 'none'); });
    map.setLayoutProperty('blocks', 'visibility', replay ? 'none' : 'visible');
    map.setPaintProperty('tracks', 'line-color', replay ? COLORS.backdrop : BY_GROUP);
    map.setPaintProperty('tracks', 'line-opacity', replay ? 0.045 : 0.12);
    map.setPaintProperty('tracks', 'line-width', replay ? 0.8 : 0.9);
  }

  // All blocks as points for the lit layer.
  function residentPoints() {
    var n = model.pop.length, features = new Array(n);
    for (var i = 0; i < n; i++) {
      features[i] = { type: 'Feature', id: i,
        geometry: { type: 'Point', coordinates: [model.lon[i], model.lat[i]] },
        properties: { s: dotSize(model.pop[i]) } };
    }
    glow.level = new Float32Array(n);
    glow.band = new Uint8Array(n);
    glow.shown = new Int16Array(n);
    return { type: 'FeatureCollection', features: features };
  }

  // A block hit this frame shines fully; the rest fade on the day's clock,
  // so a paused replay holds its glow. Opacity moves in eighths, so a block
  // touches the map only when its step changes.
  function updateGlow(t, hits) {
    var dt = glow.t === null ? 0 : t - glow.t;
    glow.t = t;
    if (dt < 0 || dt > 600) { clearGlow(); glow.t = t; dt = 0; }
    var decay = Math.exp(-dt / GLOW_TAU), list = glow.list, k;
    for (k = 0; k < list.length; k++) glow.level[list[k]] *= decay;
    for (k = 0; k < hits.length; k += 2) {
      if (!glow.level[hits[k]]) list.push(hits[k]);
      glow.level[hits[k]] = 1;
      glow.band[hits[k]] = hits[k + 1];
    }
    var keep = [];
    for (k = 0; k < list.length; k++) {
      var b = list[k], q = Math.round(glow.level[b] * 8);
      if (q) keep.push(b); else glow.level[b] = 0;
      var code = q * 4 + glow.band[b];
      if (code !== glow.shown[b]) {
        glow.shown[b] = code;
        map.setFeatureState({ source: 'residents', id: b }, { o: q / 8, band: glow.band[b] });
      }
    }
    glow.list = keep;
  }

  function clearGlow() {
    if (!glow.level) return;
    glow.list.forEach(function (b) { glow.level[b] = 0; glow.shown[b] = 0; });
    glow.list = [];
    glow.t = null;
    map.removeFeatureState({ source: 'residents' });
  }

  function drawMap(items, now) {
    var spin = state.playing && !reduced ? (now * 0.6) % 360 : 30;
    var points = [], trails = [];
    items.forEach(function (it) {
      var f = it.f, p = it.pos, r = model.rings(f, p.alt);
      var props = { id: f.id, g: f.group, hdg: p.hdg, spin: spin + p.hdg };
      meta.bands.forEach(function (b, i) { props['r' + b] = r[i] || 0; });
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: props });
    });
    var span = TRAIL_STEPS * meta.step;
    day.flights.forEach(function (f) {
      if (!inGroup(f) || state.t < f.t0 || state.t >= f.t1 + span) return;
      var coords = trail(f, state.t, span);
      if (coords) trails.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
        properties: { g: f.group } });
    });
    map.getSource('aloft').setData({ type: 'FeatureCollection', features: points });
    map.getSource('trails').setData({ type: 'FeatureCollection', features: trails });
  }

  // The path a flight flew in the last few minutes, from a tail that glides
  // between samples to the helicopter. After the flight ends, the trail
  // drains into its last point.
  function trail(f, t, span) {
    var head = Math.min(t, f.t1), tail = Math.max(t - span, f.t0);
    if (head - tail < meta.step / 2) return null;
    var coords = [pointAt(f, tail)];
    for (var k = Math.floor(tail / meta.step) + 1; k * meta.step < head; k++) {
      coords.push([f.lon[k - f.k0], f.lat[k - f.k0]]);
    }
    coords.push(pointAt(f, head));
    return coords;
  }

  // A flight's position at t, without the heading model.where also keeps.
  function pointAt(f, t) {
    var s = t / meta.step - f.k0, i = Math.min(Math.floor(s), f.lat.length - 2), u = s - i;
    return [f.lon[i] + u * (f.lon[i + 1] - f.lon[i]), f.lat[i] + u * (f.lat[i + 1] - f.lat[i])];
  }

  function pathOf(f) {
    var coords = [];
    for (var k = 0; k < f.lat.length; k++) coords.push([f.lon[k], f.lat[k]]);
    return coords;
  }

  function setTracks() {
    map.getSource('tracks').setData({ type: 'FeatureCollection',
      features: day.flights.map(function (f) {
        return { type: 'Feature', geometry: { type: 'LineString', coordinates: pathOf(f) },
                 properties: { id: f.id, g: f.group } };
      }) });
  }

  // Whole-day dots. Each group's level rides on the feature as 0 to 3 (none,
  // 60, 70, 80): the loudest level the block heard ten or more times. A
  // change of filter is then a paint change rather than new data.
  function setBlocks() {
    var iso = day.day;
    loadEvents().then(function (d) {
      if (state.day !== iso || !ready) return;
      var ev = d.events, features = [];
      function level(g, i) {
        var e = ev[g];
        return e['80'][i] >= REPEAT ? 3 : e['70'][i] >= REPEAT ? 2 : e['60'][i] >= REPEAT ? 1 : 0;
      }
      for (var i = 0; i < model.pop.length; i++) {
        var a = level('all', i);
        if (!a) continue;
        features.push({ type: 'Feature', id: i,
          geometry: { type: 'Point', coordinates: [model.lon[i], model.lat[i]] },
          properties: { s: dotSize(model.pop[i]), a: a, n: level('non-essential', i), p: level('public service', i) } });
      }
      map.getSource('blocks').setData({ type: 'FeatureCollection', features: features });
      applyGroup();
    }).catch(function (err) {
      message('Could not load the block counts. ' + err.message);
    });
  }

  function blockKey() {
    return { all: 'a', 'non-essential': 'n', 'public service': 'p' }[state.group];
  }

  function applyGroup() {
    map.setFilter('tracks', state.group === 'all' ? null : ['==', ['get', 'g'], state.group]);
    var n = ['get', blockKey()];
    map.setFilter('blocks', ['>=', n, 1]);
    map.setPaintProperty('blocks', 'circle-color',
      ['match', n, 3, COLORS.band[80], 2, COLORS.band[70], COLORS.band[60]]);
    map.setLayoutProperty('blocks', 'circle-sort-key', n);
    dirty = true;
  }

  // ---- Pointer ------------------------------------------------------

  // Replay only: hovering a helicopter names it, a small extra for the
  // curious. Nothing on the map opens a card, and Whole day is a picture to
  // read.
  function bindPointer() {
    var tip = $('map-tip');
    function heliAt(point) {
      var hit = map.queryRenderedFeatures([[point.x - 2, point.y - 2], [point.x + 2, point.y + 2]],
        { layers: ['heli'] })[0];
      return hit ? day.byId[hit.properties.id] : null;
    }

    map.on('mousemove', function (e) {
      var f = state.view === 'replay' ? heliAt(e.point) : null;
      if (!f) { tip.hidden = true; return; }
      var it = current.items.filter(function (x) { return x.f === f; })[0];
      tip.textContent = CATEGORY[f.cat] + ' · ' + typeName(f.type) + (it ? ' · ' + altitude(it.pos.alt) : '');
      tip.style.left = e.point.x + 'px';
      tip.style.top = e.point.y + 'px';
      tip.hidden = false;
    });
    map.getCanvas().addEventListener('mouseleave', function () { tip.hidden = true; });
  }
})();
